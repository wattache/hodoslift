# Postgres serverless Neon (free tier), entièrement géré en Terraform.
#
# Clé API : dans GCP Secret Manager (secret `neon-api-key`, conteneur possédé par
# TF, valeur déposée à la main). ⚠️ Doit être une clé ACCOUNT-WIDE (pas scoppée
# projet) : créer un projet requiert ce niveau. Lue via data source.

resource "google_secret_manager_secret" "neon_api_key" {
  secret_id = "neon-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

data "google_secret_manager_secret_version" "neon_api_key" {
  secret     = google_secret_manager_secret.neon_api_key.secret_id
  depends_on = [google_secret_manager_secret.neon_api_key]
}

provider "neon" {
  api_key = data.google_secret_manager_secret_version.neon_api_key.secret_data
}

resource "neon_project" "ff" {
  name       = "french-forge-trainer"
  region_id  = "aws-eu-central-1" # Frankfurt, au plus près de brokkr
  pg_version = 16
  # Free tier : max 6h de rétention d'historique (le défaut provider = 24h dépasse).
  history_retention_seconds = 21600

  # ⚠️ CE PROJET CONTIENT LA TOTALITÉ DE LA DONNÉE (FRE-135). Deux à trois ans
  #    d'entraînement d'athlètes réels, et la restauration éprouvée le 27/08 part
  #    d'un dump — pas de ce projet-ci. Un `terraform destroy` malheureux, ou un
  #    renommage d'attribut qui force le remplacement de la ressource, effacerait
  #    tout en une commande qui ne demande rien à personne.
  #
  #    `prevent_destroy` fait échouer le plan AVANT d'agir. Pour détruire
  #    volontairement, il faut retirer ce bloc — c'est-à-dire un commit, donc une
  #    trace et une intention.
  lifecycle {
    prevent_destroy = true
  }
}

resource "neon_role" "brokkr" {
  project_id = neon_project.ff.id
  branch_id  = neon_project.ff.default_branch_id
  name       = "brokkr"
}

resource "neon_database" "app" {
  project_id = neon_project.ff.id
  branch_id  = neon_project.ff.default_branch_id
  name       = "french_forge_trainer"
  owner_name = neon_role.brokkr.name

  # Même raison que le projet : c'est LA base. Voir `neon_project.ff`.
  lifecycle {
    prevent_destroy = true
  }
}

# ⚠️ LE RÔLE `analytics_ro` A ÉTÉ RETIRÉ (2026-08-27, FRE-112). Il est resté ici
# quatre semaines en annonçant une garantie qu'il n'a JAMAIS eue :
#
#   « un outil BI branché dessus ne PEUT PAS écrire, même en cas de fausse manip »
#
# Mesuré le 27/08 : il pouvait INSERT, UPDATE et DELETE sur `training_exercises`,
# soit l'historique d'entraînement de vrais athlètes. Pas à cause d'un GRANT de
# trop — il n'y en avait AUCUN — mais parce que `neon_role` rend tout rôle membre
# de `neon_superuser`, dont il héritait tout. La lecture seule n'avait pas été
# perdue : elle n'avait jamais existé, et le commentaire tenait lieu de contrôle.
#
# ⚠️ ET ON NE POUVAIT PAS LA RÉPARER PAR UN REVOKE : l'appartenance est posée par
# `cloud_admin` sans `admin_option`, donc `brokkr` se voit refuser
# `REVOKE neon_superuser FROM analytics_ro` (essayé, refusé). Retirer le rôle est
# la seule voie qui passe par du code plutôt que par la console.
#
# Ce qui a tranché : Metabase avait été essayé fin juillet pour lire des schémas
# SQL, sans convaincre, et ne servait plus. Un rôle privilégié qui ne sert à
# personne ne se sécurise pas, il se supprime.
#
# ⚠️ SI UN OUTIL BI REVIENT UN JOUR, ne pas recréer ceci tel quel. Tout `neon_role`
# héritera de `neon_superuser` de la même façon : la propriété « lecture seule »
# doit être VÉRIFIÉE contre la base (`has_table_privilege(…,'DELETE')` doit rendre
# faux), jamais affirmée en commentaire.

# --- Mot de passe (seul élément sensible) → GCP Secret Manager, rempli auto --- #
resource "google_secret_manager_secret" "db_password" {
  secret_id = "brokkr-db-password"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = neon_role.brokkr.password
}

resource "google_secret_manager_secret_iam_member" "brokkr_db_password" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.brokkr.email}"
}

# --- LE RÔLE APPLICATIF (FRE-151) : son mot de passe et son secret ----------- #
#
# `brokkr` est le rôle que l'APPLICATION utilise à chaque requête, et il peut
# créer des rôles, créer des bases, ignorer la RLS et supprimer n'importe quelle
# table. `brokkr_app` ne sait que lire et écrire des lignes ; `brokkr` reste
# propriétaire des objets et sert aux migrations.
#
# ⚠️ LE RÔLE LUI-MÊME N'EST PAS ICI, ET C'EST TOUT LE SUJET. Un `neon_role`
# deviendrait membre de `neon_superuser` — appartenance que `brokkr` ne peut pas
# révoquer, faute d'`admin_option` — donc un rôle « sans pouvoir » qui pourrait
# tout supprimer. C'est mot pour mot ce qui a tué `analytics_ro` (voir plus haut).
# Le rôle se crée donc EN SQL : `sql/brokkr_app.sql`, qui vérifie lui-même, en
# levant, qu'il n'hérite de rien.
#
# Terraform ne fabrique donc que le mot de passe et le secret qui le porte. Le
# script SQL le lit par `terraform output -raw brokkr_app_password`.
locals {
  # Nommé UNE fois : le service et le job nocturne le lisent tous les deux, et
  # une bascule à moitié faite ne se verrait qu'à 3 h 30 le lendemain.
  # ⚠️ Une chaîne, pas une référence : ce rôle est créé EN SQL, Terraform ne le
  # connaît pas (voir `sql/brokkr_app.sql`).
  role_applicatif = "brokkr_app"
}

resource "random_password" "brokkr_app" {
  length = 40
  # Neon accepte les caractères spéciaux, mais le mot de passe traverse une URL
  # (`app/db.py` l'assemble) et une ligne de commande psql : on s'épargne
  # l'encodage, pour 40 caractères qui valent déjà mieux que n'importe quel
  # jeu réduit sur 16.
  special = false
}

resource "google_secret_manager_secret" "brokkr_app_db_password" {
  secret_id = "brokkr-app-db-password"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "brokkr_app_db_password" {
  secret      = google_secret_manager_secret.brokkr_app_db_password.id
  secret_data = random_password.brokkr_app.result
}

# Le même compte de service porte le SERVICE et le JOB nocturne : un seul binding
# couvre les deux (cf. `brokkr.tf` et `analytics.tf`).
resource "google_secret_manager_secret_iam_member" "brokkr_app_db_password" {
  secret_id = google_secret_manager_secret.brokkr_app_db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.brokkr.email}"
}

# ⚠️ RIEN NE CONSOMME ENCORE CE SECRET, et c'est délibéré. Basculer `DB_USER` et
# `DB_PASSWORD` du service et du job AVANT que le rôle n'existe en base mettrait
# la production dehors au premier `apply`. La séquence est écrite en tête de
# `sql/brokkr_app.sql` ; le câblage est le geste d'après, une fois le script joué
# et une lecture ET une écriture éprouvées.

output "brokkr_app_password" {
  description = "Mot de passe du rôle applicatif — à passer à sql/brokkr_app.sql."
  sensitive   = true
  value       = random_password.brokkr_app.result
}

output "brokkr_app_password_secret" {
  description = "Secret GCP où le service lira le mot de passe applicatif."
  value       = google_secret_manager_secret.brokkr_app_db_password.secret_id
}

# --- Config NON sensible (env Cloud Run de brokkr, au câblage) --------------- #
# ⚠️ LE RUNTIME VISE LE DIRECT DEPUIS FRE-135 : le pooler ne propage ni le
# paramètre `options` (il refuse la connexion) ni les défauts de rôle, donc
# aucune borne de session n'atteignait le serveur. Mesuré : 901 connexions
# disponibles pour 28 demandées au pire — le pooler ne servait plus à rien.
output "db_host" { value = neon_project.ff.database_host }               # runtime ET migrations
output "db_host_pooler" { value = neon_project.ff.database_host_pooler } # inutilisé
output "db_name" { value = neon_database.app.name }
output "db_user" { value = neon_role.brokkr.name }
output "db_password_secret" {
  description = "Secret GCP où brokkr lira le mot de passe."
  value       = google_secret_manager_secret.db_password.secret_id
}

# URI directe complète — sensible, pour appliquer le schéma UNE fois (local).
output "neon_migration_uri" {
  description = "URI directe pour appliquer le schéma one-shot."
  sensitive   = true
  value       = "postgresql://${neon_role.brokkr.name}:${neon_role.brokkr.password}@${neon_project.ff.database_host}/${neon_database.app.name}?sslmode=require"
}
