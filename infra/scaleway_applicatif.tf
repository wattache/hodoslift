# ============================================================================
# HODOS SUR SCALEWAY — la pile du DÉMÉNAGEMENT, en sommeil (`var.pile_scaleway`)
#
# ⚠️ AUJOURD'HUI HODOS TOURNE SUR CLOUD RUN (`brokkr.tf`, `api.tf`) et son front
# sur Firebase Hosting. Cette pile est écrite et éprouvée pour le jour où l'on
# quitte GCP ; tant que `pile_scaleway` est faux, aucun `apply` ne la crée. Seul
# le registre existe déjà (vide, sans coût).
#
# Trois conteneurs : `web` (Caddy : le front, et le routage de tout le reste),
# `api-python` (FastAPI) et `api` (Go, Connect). Tout passe par une seule origine :
#
#   /                  → le front (fichiers de `web/dist`)
#   /api/…             → api-python, préfixe retiré
#   /hodos.…           → api (les services Connect)
#   /__/auth/…         → Firebase, pour le repli de connexion par popup
#
# Pas de CORS entre eux : le navigateur ne voit qu'une origine.
#
# L'ancienne app (Cloud Run + Firebase Hosting) tourne À CÔTÉ et n'est pas
# touchée ici ; les gens passent de l'une à l'autre, et les deux lisent Neon.
#
# ⚠️ LA BASE QUE LISENT LES CONTENEURS EST UN CHOIX, `var.base_scaleway` :
#
#   "neon"     — Neon, comme l'ancienne app : mêmes comptes, mêmes données, le
#                temps que tout le monde passe.
#   "scaleway" — la base Postgres managée (`scaleway_postgres.tf`), par le
#                réseau privé, une fois la donnée recopiée
#                (`scripts/copier_la_base_vers_scaleway.sh`).
#                Le job nocturne des analyses n'existe que dans ce cas : sur
#                Neon, celui de GCP tourne déjà.
#
# ⚠️ LE DOMAINE NE S'ACTIVE QU'UNE FOIS ACHETÉ, `var.domaine_hodos` : vide, les
# conteneurs vivent sur leurs adresses Scaleway ; posé, un ALIAS au nu du domaine
# vise `web`, puis le conteneur reçoit le domaine et son certificat.
#
# ⚠️ L'ORDRE DU PREMIER APPLY — un conteneur ne se crée pas sur une image absente :
#
#   1. terraform apply -target=scaleway_registry_namespace.hodos
#   2. make -C ../api-python build ; make -C ../api build ; make -C ../web image
#   3. terraform apply
#
# Ensuite Terraform possède la COQUILLE des conteneurs et `make deploy` leur
# image (`ignore_changes`).
# ============================================================================

variable "pile_scaleway" {
  description = "Crée la pile Scaleway (base, réseau, conteneurs, domaine). Faux tant que Hodos tourne sur Cloud Run."
  type        = bool
  default     = false
}

variable "base_scaleway" {
  description = "La base que lisent api-python et api sur Scaleway : \"neon\" (la production, pendant les tests) ou \"scaleway\" (la base managée, après la recopie)."
  type        = string
  default     = "neon"
  validation {
    condition     = contains(["neon", "scaleway"], var.base_scaleway)
    error_message = "base_scaleway vaut \"neon\" ou \"scaleway\"."
  }
}

variable "origines_de_recette" {
  description = "Origines ajoutées au CORS de la pile Scaleway pendant les tests (un front local qui la vise). Vide le jour où elle sert la production."
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "environnement_scaleway" {
  description = "SENTRY_ENVIRONMENT de la pile Scaleway : distinct de \"production\" tant qu'elle ne sert pas les athlètes, pour ne pas mêler ses erreurs aux leurs."
  type        = string
  default     = "scaleway"
}

variable "domaine_hodos" {
  description = "Le domaine de l'app, une fois acheté chez Scaleway (zone DNS gérée ici) — \"hodos-trainer.com\". Vide : pas de domaine, les adresses Scaleway seules."
  type        = string
  default     = ""
}

variable "api_python_scw" {
  description = "Taille d'api-python. Toujours chaud (min_scale 1) : un Python qui démarre à froid fait attendre plusieurs secondes."
  type        = object({ cpu = number, memoire_mo = number, min_scale = number, max_scale = number })
  default     = { cpu = 560, memoire_mo = 512, min_scale = 1, max_scale = 4 }
}

variable "api_scw" {
  description = "Taille d'api (Go). Il dort sans requête (min_scale 0) : un binaire Go démarre en moins d'une seconde."
  type        = object({ cpu = number, memoire_mo = number, min_scale = number, max_scale = number })
  default     = { cpu = 140, memoire_mo = 256, min_scale = 0, max_scale = 4 }
}

variable "web_scw" {
  description = "Taille de web (Caddy). Toujours chaud : c'est la porte de l'app, un réveil se verrait à chaque première visite."
  type        = object({ cpu = number, memoire_mo = number, min_scale = number, max_scale = number })
  default     = { cpu = 140, memoire_mo = 128, min_scale = 1, max_scale = 4 }
}

locals {
  scw_region = var.scaleway_region
  sur_scw    = var.pile_scaleway && var.base_scaleway == "scaleway"

  # La connexion des conteneurs. Sur la base managée, par le RÉSEAU PRIVÉ : elle
  # n'y est jamais exposée à internet pour eux.
  base_conteneurs = local.sur_scw ? {
    host     = try(scaleway_rdb_instance.hodos.private_network[0].ip, null)
    port     = try(scaleway_rdb_instance.hodos.private_network[0].port, null)
    name     = scaleway_rdb_database.hodos.name
    password = random_password.scaleway_brokkr_app.result
    } : {
    host     = neon_project.ff.database_host
    port     = 5432
    name     = neon_database.app.name
    password = random_password.brokkr_app.result
  }

  env_commun = {
    PROJECT_ID         = var.project_id
    SENTRY_DSN         = var.sentry_dsn
    SENTRY_ENVIRONMENT = var.environnement_scaleway
    DB_HOST            = local.base_conteneurs.host
    DB_PORT            = tostring(local.base_conteneurs.port)
    DB_NAME            = local.base_conteneurs.name
    # Le rôle APPLICATIF, sur les deux bases : DML seulement, et les bornes de
    # session posées sur lui (`ALTER ROLE … SET`, FRE-135).
    DB_USER = local.role_applicatif
    # Même origine que le front sur le domaine : le CORS ne sert qu'aux appels
    # directs (front local de test, ancienne app pendant le passage).
    ALLOWED_ORIGINS = jsonencode(concat(
      ["https://trainer.french-forge.com", "https://french-forge.com"],
      var.domaine_hodos != "" ? ["https://${var.domaine_hodos}"] : [],
      var.origines_de_recette,
    ))
  }
}

# ----------------------------------------------------------------------------
# 1. LE REGISTRE — les images des deux services, privées
# ----------------------------------------------------------------------------

resource "scaleway_registry_namespace" "hodos" {
  name        = "hodos"
  description = "Images de web, api-python et api, taguées par le SHA du dernier commit de leur dossier"
  region      = local.scw_region
  is_public   = false
}

# ----------------------------------------------------------------------------
# 2. LE RÉSEAU PRIVÉ — entre les conteneurs et la base
# ----------------------------------------------------------------------------

resource "scaleway_vpc_private_network" "hodos" {
  count  = var.pile_scaleway ? 1 : 0
  name   = "hodos"
  region = local.scw_region
}

# ----------------------------------------------------------------------------
# 3. LA BASE — `scaleway_postgres.tf`, qui existe déjà : la pile s'y branche par
# le réseau privé (bloc `private_network` dynamique de l'instance).
# ----------------------------------------------------------------------------

# ----------------------------------------------------------------------------
# 4. LES CONTENEURS — web, api-python, api
# ----------------------------------------------------------------------------

resource "scaleway_container_namespace" "hodos" {
  count       = var.pile_scaleway ? 1 : 0
  name        = "hodos"
  region      = local.scw_region
  description = "Hodos : web (Caddy), api-python (FastAPI), api (Go, Connect)"
}

resource "scaleway_container" "api_python" {
  count              = var.pile_scaleway ? 1 : 0
  namespace_id       = scaleway_container_namespace.hodos[0].id
  name               = "api-python"
  image              = "${scaleway_registry_namespace.hodos.endpoint}/api-python:latest"
  port               = 8080
  protocol           = "http1"
  privacy            = "public"
  cpu_limit          = var.api_python_scw.cpu
  memory_limit_bytes = var.api_python_scw.memoire_mo * 1024 * 1024
  min_scale          = var.api_python_scw.min_scale
  max_scale          = var.api_python_scw.max_scale
  timeout            = 300

  https_connections_only = true
  private_network_id     = local.sur_scw ? scaleway_vpc_private_network.hodos[0].id : null

  environment_variables = merge(local.env_commun, {
    VAPID_PUBLIC_KEY       = local.vapid_public_key
    SCALEWAY_ACCESS_KEY    = scaleway_iam_api_key.brokkr.access_key
    SCALEWAY_ENDPOINT      = "https://s3.${var.scaleway_region}.scw.cloud"
    SCALEWAY_REGION        = var.scaleway_region
    SCALEWAY_BUCKET_PUBLIC = scaleway_object_bucket.coachs_public.name
    SCALEWAY_BUCKET_PRIVE  = scaleway_object_bucket.kine_prive.name
    SMTP_HOST              = scaleway_tem_domain.expediteur.smtp_host
    SMTP_PORT              = tostring(scaleway_tem_domain.expediteur.smtps_port)
    SMTP_USER              = scaleway_tem_domain.expediteur.smtps_auth_user
    MAIL_FROM              = "no-reply@${scaleway_tem_domain.expediteur.name}"
  })

  secret_environment_variables = {
    DB_PASSWORD         = local.base_conteneurs.password
    SCALEWAY_SECRET_KEY = scaleway_iam_api_key.brokkr.secret_key
    VAPID_PRIVATE_KEY   = data.google_secret_manager_secret_version.vapid_private_key.secret_data
  }

  # `/health` ne touche pas la base : un réveil de Neon ou une base lente ne
  # fait pas redémarrer le conteneur. Le démarrage a sa propre patience.
  startup_probe {
    http {
      path = "/health"
    }
    failure_threshold = 30
    interval          = "2s"
    timeout           = "2s"
  }

  liveness_probe {
    http {
      path = "/health"
    }
    failure_threshold = 3
    interval          = "30s"
    timeout           = "5s"
  }

  lifecycle {
    ignore_changes = [image, registry_sha256]
  }
}

resource "scaleway_container" "api" {
  count              = var.pile_scaleway ? 1 : 0
  namespace_id       = scaleway_container_namespace.hodos[0].id
  name               = "api"
  image              = "${scaleway_registry_namespace.hodos.endpoint}/api:latest"
  port               = 8080
  protocol           = "http1"
  privacy            = "public"
  cpu_limit          = var.api_scw.cpu
  memory_limit_bytes = var.api_scw.memoire_mo * 1024 * 1024
  min_scale          = var.api_scw.min_scale
  max_scale          = var.api_scw.max_scale
  timeout            = 60

  https_connections_only = true
  private_network_id     = local.sur_scw ? scaleway_vpc_private_network.hodos[0].id : null

  environment_variables = local.env_commun

  secret_environment_variables = {
    DB_PASSWORD = local.base_conteneurs.password
  }

  # `/health` ne touche pas la base : un réveil de Neon ou une base lente ne
  # fait pas redémarrer le conteneur. Le démarrage a sa propre patience.
  startup_probe {
    http {
      path = "/health"
    }
    failure_threshold = 30
    interval          = "2s"
    timeout           = "2s"
  }

  liveness_probe {
    http {
      path = "/health"
    }
    failure_threshold = 3
    interval          = "30s"
    timeout           = "5s"
  }

  lifecycle {
    ignore_changes = [image, registry_sha256]
  }
}

resource "scaleway_container" "web" {
  count              = var.pile_scaleway ? 1 : 0
  namespace_id       = scaleway_container_namespace.hodos[0].id
  name               = "web"
  image              = "${scaleway_registry_namespace.hodos.endpoint}/web:latest"
  port               = 8080
  protocol           = "http1"
  privacy            = "public"
  cpu_limit          = var.web_scw.cpu
  memory_limit_bytes = var.web_scw.memoire_mo * 1024 * 1024
  min_scale          = var.web_scw.min_scale
  max_scale          = var.web_scw.max_scale
  timeout            = 300

  https_connections_only = true

  # Où Caddy renvoie ce qui n'est pas le front (`web/Caddyfile`).
  environment_variables = {
    API_PYTHON_URL = scaleway_container.api_python[0].public_endpoint
    API_URL        = scaleway_container.api[0].public_endpoint
    FIREBASE_AUTH  = "https://${var.project_id}.firebaseapp.com"
  }

  startup_probe {
    http {
      path = "/health"
    }
    failure_threshold = 30
    interval          = "2s"
    timeout           = "2s"
  }

  liveness_probe {
    http {
      path = "/health"
    }
    failure_threshold = 3
    interval          = "30s"
    timeout           = "5s"
  }

  lifecycle {
    ignore_changes = [image, registry_sha256]
  }
}

# ----------------------------------------------------------------------------
# 5. LE DOMAINE — une fois acheté (`var.domaine_hodos`)
#
# Le DNS de Scaleway accepte un ALIAS au nu du domaine : `hodos-trainer.com` vise
# directement le conteneur `web`. Le domaine ne se lie au conteneur qu'APRÈS
# l'enregistrement, parce que Scaleway prouve la possession par HTTP-01 dans les
# trois minutes : sans l'ALIAS, le certificat échoue et le domaine reste en
# erreur.
# ----------------------------------------------------------------------------

resource "scaleway_domain_record" "hodos" {
  count    = var.pile_scaleway && var.domaine_hodos != "" ? 1 : 0
  dns_zone = var.domaine_hodos
  name     = ""
  type     = "ALIAS"
  data     = "${trimprefix(scaleway_container.web[0].public_endpoint, "https://")}."
  ttl      = 300
}

resource "scaleway_container_domain" "hodos" {
  count        = var.pile_scaleway && var.domaine_hodos != "" ? 1 : 0
  container_id = scaleway_container.web[0].id
  hostname     = var.domaine_hodos
  region       = local.scw_region
  depends_on   = [scaleway_domain_record.hodos]
}

# ----------------------------------------------------------------------------
# 6. LE JOB NOCTURNE DES ANALYSES — seulement quand la base est chez Scaleway
#
# Même commande que le job Cloud Run (`analytics.tf`), même heure. Il passe par
# le point PUBLIC de la base : Serverless Jobs n'ont pas de réseau privé.
# ----------------------------------------------------------------------------

resource "scaleway_secret" "brokkr_app_db_password" {
  count       = local.sur_scw ? 1 : 0
  name        = "brokkr-app-db-password"
  description = "Mot de passe de brokkr_app sur la base Scaleway — lu par le job des analyses"
  region      = local.scw_region
}

resource "scaleway_secret_version" "brokkr_app_db_password" {
  count     = local.sur_scw ? 1 : 0
  secret_id = scaleway_secret.brokkr_app_db_password[0].id
  region    = local.scw_region
  data      = random_password.scaleway_brokkr_app.result
}

resource "scaleway_job_definition" "analytics" {
  count                  = local.sur_scw ? 1 : 0
  name                   = "training-analytics-refresh"
  region                 = local.scw_region
  image_uri              = "${scaleway_registry_namespace.hodos.endpoint}/api-python:latest"
  startup_command        = ["uv", "run", "--no-sync", "python", "-m", "scripts.etl_training_sets"]
  args                   = ["--apply"]
  cpu_limit              = 1000
  memory_limit           = 512
  local_storage_capacity = 1000
  timeout                = "15m"

  env = merge(local.env_commun, {
    DB_HOST = scaleway_rdb_instance.hodos.load_balancer[0].ip
    DB_PORT = tostring(scaleway_rdb_instance.hodos.load_balancer[0].port)
  })

  secret_reference {
    secret_id   = scaleway_secret.brokkr_app_db_password[0].id
    environment = "DB_PASSWORD"
  }

  cron {
    schedule = "30 3 * * *"
    timezone = "Europe/Paris"
  }

  retry_policy {
    max_retries = 1
  }
}

# ----------------------------------------------------------------------------
# 7. CE QUE LES MAKEFILES ET LES SCRIPTS LISENT
# ----------------------------------------------------------------------------

output "scaleway_registre" {
  description = "Le registre des images (`make build` et `make image` y poussent)."
  value       = scaleway_registry_namespace.hodos.endpoint
}

output "hodos_url" {
  description = "L'adresse de l'app : le domaine s'il est posé, sinon celle du conteneur web."
  value       = var.pile_scaleway ? (var.domaine_hodos != "" ? "https://${var.domaine_hodos}" : scaleway_container.web[0].public_endpoint) : null
}

output "api_python_scaleway_url" {
  description = "api-python, en direct (sans passer par web) — tests et front local."
  value       = var.pile_scaleway ? (scaleway_container.api_python[0].public_endpoint) : null
}

output "api_scaleway_url" {
  description = "api (Go), en direct (sans passer par web) — tests et front local."
  value       = var.pile_scaleway ? (scaleway_container.api[0].public_endpoint) : null
}
