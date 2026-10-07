# ============================================================================
# LE POSTGRES MANAGÉ DE SCALEWAY — la base qui remplacera Neon
#
# L'instance existe et reçoit la recopie de la base
# (`scripts/copier_la_base_vers_scaleway.sh`) ; aucune API ne la lit tant
# qu'elles visent Neon. La bascule est un autre geste.
#
# ⚠️ CE N'EST PAS DU HDS : le périmètre HDS de Scaleway couvre les Instances et
# le stockage, pas le Postgres managé. Neon ne l'est pas non plus ; rien ne
# régresse. Voir FRE-213 et FRE-58.
#
# ⚠️ LA BASE PORTE TOUTE LA DONNÉE, comme `neon_project.ff` : `prevent_destroy`.
# Pour détruire volontairement, il faut retirer le bloc — un commit, donc une
# trace et une intention.
#
# Deux rôles, les mêmes que chez Neon, pour que le dump se restaure sans rien
# réattribuer :
#
#   brokkr      propriétaire des objets, joue les migrations et la recopie ;
#               mot de passe dans Secret Manager (`hodos-db-password`) ;
#   brokkr_app  le rôle de l'application, DML seulement ; mot de passe dans
#               Secret Manager (`hodos-app-db-password`). Pas celui de Neon :
#               il n'a aucun caractère spécial, que Scaleway exige.
# ============================================================================

# ⚠️ Scaleway exige majuscule, minuscule, chiffre et caractère spécial : un mot
# de passe qui n'en a pas fait échouer la création de l'instance, pas le plan.
# Les spéciaux sont restreints à ce qui passe dans une URL sans encodage.
resource "random_password" "scaleway_brokkr" {
  length           = 32
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  min_special      = 2
  override_special = "-_.~"
}

resource "random_password" "scaleway_brokkr_app" {
  length           = 32
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  min_special      = 2
  override_special = "-_.~"
}

resource "scaleway_rdb_instance" "hodos" {
  name   = "hodos"
  region = var.scaleway_region

  node_type = "DB-DEV-S"
  engine    = "PostgreSQL-16" # la version de Neon : le dump se restaure à l'identique

  # Un seul nœud : la haute disponibilité doublerait le prix pour une base qui
  # se restaure en moins d'une minute (RESTAURATION.md).
  is_ha_cluster = false

  # Block Storage plutôt que le disque local : il s'agrandit sans recréer
  # l'instance.
  volume_type        = "sbs_5k"
  volume_size_in_gb  = 5
  encryption_at_rest = true

  user_name = "brokkr"
  password  = random_password.scaleway_brokkr.result

  # La perte maximale est l'intervalle entre deux sauvegardes : une heure, comme
  # les dumps de Neon vers GCS (`backup.tf`), qui ne visent QUE Neon.
  disable_backup            = false
  backup_schedule_frequency = 1
  backup_schedule_retention = 90

  # Le point public, filtré par l'ACL ci-dessous. Déclaré, pour qu'un réseau
  # privé ajouté plus tard ne le retire pas.
  load_balancer {}

  # Le réseau privé des conteneurs Scaleway, quand la pile s'éveille
  # (`scaleway_applicatif.tf`).
  dynamic "private_network" {
    for_each = var.pile_scaleway ? [scaleway_vpc_private_network.hodos[0].id] : []
    content {
      pn_id       = private_network.value
      enable_ipam = true
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "scaleway_rdb_database" "hodos" {
  instance_id = scaleway_rdb_instance.hodos.id
  region      = var.scaleway_region
  name        = "hodos"

  lifecycle {
    prevent_destroy = true
  }
}

resource "scaleway_rdb_privilege" "brokkr" {
  instance_id   = scaleway_rdb_instance.hodos.id
  region        = var.scaleway_region
  user_name     = scaleway_rdb_instance.hodos.user_name
  database_name = scaleway_rdb_database.hodos.name
  permission    = "all"
}

# Créé AVANT la recopie : le dump lui rend ses droits table par table, mais ne
# crée pas de rôle. Ses bornes de session (`ALTER ROLE … SET`) se posent dans la
# recopie, connecté en `brokkr_app` lui-même.
resource "scaleway_rdb_user" "brokkr_app" {
  instance_id = scaleway_rdb_instance.hodos.id
  region      = var.scaleway_region
  name        = local.role_applicatif
  password    = random_password.scaleway_brokkr_app.result
  is_admin    = false
}

resource "scaleway_rdb_privilege" "brokkr_app" {
  instance_id   = scaleway_rdb_instance.hodos.id
  region        = var.scaleway_region
  user_name     = scaleway_rdb_user.brokkr_app.name
  database_name = scaleway_rdb_database.hodos.name
  permission    = "readwrite"
}

# ⚠️ L'ACCÈS PUBLIC EST BORNÉ AUX ADRESSES LISTÉES. Tant que les API lisent Neon,
# seul le poste de William entre (recopie, console, psql). Le jour où Cloud Run
# la lira, il n'a pas d'adresse de sortie fixe : soit ouvrir à 0.0.0.0/0 (comme
# Neon aujourd'hui), soit sortir par une adresse fixe — décision de ce jour-là.
# La pile Scaleway éveillée l'ouvre pour son job nocturne, qui n'a pas de
# réseau privé.
resource "scaleway_rdb_acl" "hodos" {
  instance_id = scaleway_rdb_instance.hodos.id
  region      = var.scaleway_region

  dynamic "acl_rules" {
    for_each = concat(var.scaleway_postgres_ips_autorisees, var.pile_scaleway ? ["0.0.0.0/0"] : [])
    content {
      ip          = acl_rules.value
      description = acl_rules.value == "0.0.0.0/0" ? "job nocturne de la pile Scaleway (sans réseau privé)" : "autorisée par infra/ (FRE-213)"
    }
  }
}

# Les deux mots de passe, là où vivent déjà ceux de Neon : lus par les scripts
# (`gcloud secrets versions access latest --secret=…`), jamais en sortie
# Terraform ni recopiés à la main.
#
# Le propriétaire n'est lu par aucun service. Le rôle applicatif le sera par
# Cloud Run le jour où les API liront cette base : d'où l'accès de `brokkr`.
resource "google_secret_manager_secret" "scaleway_db_password" {
  secret_id = "hodos-db-password"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "scaleway_db_password" {
  secret      = google_secret_manager_secret.scaleway_db_password.id
  secret_data = random_password.scaleway_brokkr.result
}

resource "google_secret_manager_secret" "scaleway_app_db_password" {
  secret_id = "hodos-app-db-password"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "scaleway_app_db_password" {
  secret      = google_secret_manager_secret.scaleway_app_db_password.id
  secret_data = random_password.scaleway_brokkr_app.result
}

resource "google_secret_manager_secret_iam_member" "brokkr_scaleway_app_db_password" {
  secret_id = google_secret_manager_secret.scaleway_app_db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.brokkr.email}"
}

output "scaleway_postgres_endpoint" {
  description = "Hôte:port public du Postgres Scaleway, base `hodos`."
  value       = "${scaleway_rdb_instance.hodos.load_balancer[0].ip}:${scaleway_rdb_instance.hodos.load_balancer[0].port}"
}
