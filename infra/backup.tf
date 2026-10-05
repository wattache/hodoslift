# --------------------------------------------------------------------------- #
# Backup périodique de Neon (Postgres) → GCS.
#
# POURQUOI : depuis les bascules sèches (identité, athlètes, biblio, logs,
# goals, events) PUIS celle de l'ARBRE D'ENTRAÎNEMENT (FRE-12, 16/08/2026),
# Postgres est la SOURCE VIVANTE de tout — or le free tier Neon ne garde que
# quelques heures d'historique, contre le PITR 7 jours de Firestore qu'on a
# quitté. Ce dump redonne un filet de 90 jours à tous les domaines migrés.
#
# CE QUE CE FILET DONNE, ET CE QU'IL NE DONNE PAS. Il assure la DURABILITÉ
# (90 jours hors de Neon, mieux que les 7 jours de Firestore pour l'ancien), pas
# la GRANULARITÉ : au-delà de la fenêtre d'historique Neon, on ne peut revenir
# qu'à un dump. La perte maximale est donc l'INTERVALLE ENTRE DUMPS — c'est le
# seul chiffre qui compte ici, et il ne faut pas le confondre avec la rétention
# Neon, que le planning suivait autrefois.
#
# Le scénario qui le mobilise est celui d'une corruption qu'on ne remarque PAS
# tout de suite : c'est l'incident de la bibliothèque (juin 2026), découvert
# après coup et rattrapé au PITR Firestore. Restaurer un dump fait alors perdre
# à TOUT LE MONDE le travail postérieur — d'où l'intervalle d'une heure.
#
# ⚠️ POURQUOI PAS LE PITR PAYANT DE NEON. Il achèterait la seconde près ; resserrer
# l'intervalle achète l'heure pour ~5 centimes par mois, sans changer de plan ni
# dépendre du fournisseur. Mesuré le 17/08 : base 26 Mo (dont 16 pour l'arbre
# d'entraînement, 25 000 lignes), dump `-Fc` de 1,1 Mo. À l'heure sur 90 jours :
# ~2 160 dumps, ~2,4 Go. Le tier payant reste la piste SI la seconde près devient
# nécessaire — ce n'est pas le cas aujourd'hui.
#
# COMMENT : Cloud Scheduler (4×/jour, heures Paris) → Cloud Run Job `neon-backup` →
# image postgres:16 officielle (pg_dump, AUCUNE image maison), bucket GCS
# monté en volume (Cloud Storage FUSE). Dump au format custom `-Fc`
# (compressé, pg_restore sélectif). Connexion via le host DIRECT Neon — pas
# le pooler : pgbouncer en mode transaction casse les sessions pg_dump.
#
# RESTAURATION (manuelle, en connaissance de cause) :
#   gcloud storage cp gs://french-forge-600-db-backups/<fichier>.dump /tmp/
#   pg_restore -d "$DATABASE_URL_DIRECT" --clean --if-exists /tmp/<fichier>.dump
# --------------------------------------------------------------------------- #

resource "google_storage_bucket" "db_backups" {
  name                        = "${var.project_id}-db-backups"
  project                     = var.project_id
  location                    = var.storage_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  # ⚠️ LE VERSIONING PROTÈGE DE L'ÉCRIVAIN, PAS DE LA PANNE (FRE-135). Le SA de
  # sauvegarde est `objectAdmin` sur ce seau, et il doit l'être : le montage GCS
  # FUSE crée et SUPPRIME des fichiers temporaires, `objectCreator` ne suffit pas
  # (constaté). Il peut donc effacer les dumps — c'est-à-dire que la seule copie
  # de la donnée est à la merci du processus qui l'écrit.
  #
  # Avec le versioning, une suppression ou un écrasement ne détruit plus rien
  # tout de suite : l'objet devient une version non courante, récupérable. C'est
  # la seule protection qui ne demande pas de retirer un droit dont le job a
  # besoin.
  versioning {
    enabled = true
  }

  # Mesuré le 17/08 : dump `-Fc` de 1,1 Mo pour une base de 26 Mo.
  # ~2 160 dumps (24/j × 90 j) ≈ 2,4 Go, soit quelques centimes par mois.
  lifecycle_rule {
    condition { age = 90 }
    action { type = "Delete" }
  }

  # ⚠️ ET SANS CETTE SECONDE RÈGLE, LE VERSIONING NE S'ARRÊTE JAMAIS. La règle
  # ci-dessus ne fait plus disparaître un objet : elle le rend NON COURANT, et
  # une version non courante n'a pas d'âge au sens de `age`. Sans purge, les
  # 2 160 dumps annuels s'empileraient indéfiniment.
  #
  # Trente jours : de quoi s'apercevoir d'une suppression et revenir en arrière,
  # sans garder deux fois l'historique complet.
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
      with_state                 = "ARCHIVED"
    }
    action { type = "Delete" }
  }

  labels = {
    app     = var.app_name
    purpose = "neon-db-backups"
  }

  depends_on = [google_project_service.apis]
}

# SA dédié, droits minimaux : écrire dans le bucket + lire le mot de passe DB.
resource "google_service_account" "neon_backup" {
  project      = var.project_id
  account_id   = "neon-backup"
  display_name = "Periodic Neon pg_dump to GCS"
}

# objectAdmin (scopé au bucket) : l'écriture via GCS FUSE a besoin de
# create/delete (fichiers temporaires du montage), objectCreator ne suffit pas.
resource "google_storage_bucket_iam_member" "neon_backup_writer" {
  bucket = google_storage_bucket.db_backups.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.neon_backup.email}"
}

resource "google_secret_manager_secret_iam_member" "neon_backup_db_password" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.neon_backup.email}"
}

resource "google_cloud_run_v2_job" "neon_backup" {
  # google-beta : les volumes GCS (FUSE) sur les jobs v2 ne sont pas encore
  # exposés par le provider GA en 5.x.
  provider = google-beta
  name     = "neon-backup"
  project  = var.project_id
  location = var.region

  template {
    template {
      service_account = google_service_account.neon_backup.email
      max_retries     = 1
      timeout         = "600s"

      containers {
        image   = "postgres:16-alpine"
        command = ["/bin/sh", "-c"]
        # ⚠️ LES `$${...}` SONT ÉCHAPPÉS POUR TERRAFORM, pas pour le shell. Dans un
        # heredoc HCL, `${x}` est une interpolation Terraform : écrite nue, elle
        # ferait échouer le `plan` sur une variable inconnue. `$$` la rend au
        # shell. Le `$(date …)` du script d'origine, lui, n'a jamais eu besoin
        # d'être échappé — HCL n'interpole que la forme accolade.
        args = [
          <<-EOT
            set -eu

            # --- Check-in Sentry (FRE-81) -------------------------------------
            # Pas de SDK ici : ce job tourne sur l'image postgres OFFICIELLE, à
            # dessein — une sauvegarde ne doit pas dépendre de la santé de ce
            # qu'elle sauvegarde (cf. FRE-82, qui reverra cette exception). On
            # recompose donc l'URL de check-in depuis le DSN
            # (https://CLE@HOTE/PROJET), avec le wget de busybox (`--post-data`
            # et `--header` vérifiés présents en 1.37).
            ci=""
            if [ -n "$${SENTRY_DSN:-}" ]; then
              reste="$${SENTRY_DSN#https://}"
              cle="$${reste%%@*}"
              hp="$${reste#*@}"
              ci="https://$${hp%%/*}/api/$${hp##*/}/cron/neon-backup/$${cle}/"
            fi

            # ⚠️ UN SEUL CHECK-IN, À LA FIN, et c'est un choix.
            #
            # Le découpage `in_progress` puis `ok` — ce que fait le SDK côté
            # Python — suppose de garder l'identifiant rendu par le premier appel
            # pour clore le second. Le trimballer jusque dans un `trap`, en shell
            # POSIX, coûte plus de lignes que ça n'apporte : pour une sauvegarde,
            # la question est « a-t-elle tourné et réussi », pas « combien de
            # temps ». On perd la durée, on garde la vérité.
            #
            # ⚠️ ET LE `monitor_config` VOYAGE AVEC, sans quoi rien ne créerait le
            # monitor : contrairement au SDK, l'URL nue ne sait pas déclarer ce
            # qu'elle surveille. La planification est donc écrite ici — et doit
            # rester en phase avec `google_cloud_scheduler_job.neon_backup_nightly`
            # quinze lignes plus bas.
            config='{"schedule":{"type":"crontab","value":"10 * * * *"},"timezone":"Europe/Paris","checkin_margin":5,"max_runtime":20}'
            # ⚠️ UN ÉCHEC DE SENTRY NE DOIT JAMAIS FAIRE ÉCHOUER LA SAUVEGARDE :
            # d'où le `|| true` et le délai court. Un check-in perdu se voit de
            # toute façon — le monitor le comptera comme manquant.
            pointer() {
              [ -n "$ci" ] || return 0
              wget -q -T 10 -O /dev/null --header='Content-Type: application/json' \
                --post-data="{\"status\":\"$1\",\"monitor_config\":$config}" "$ci" || true
            }

            # ⚠️ `set -eu` SORT SANS PRÉVENIR. Sans ce trap, un pg_dump qui échoue
            # ne signalerait rien : Sentry finirait par voir un check-in manquant,
            # une heure plus tard et sans cause. Le trap transforme un silence en
            # échec daté.
            trap 'pointer error' EXIT

            f="/backup/french_forge_trainer_$(date +%Y%m%d_%H%M%S).dump"
            pg_dump --format=custom --no-owner --no-privileges --file="$f"
            echo "backup OK : $f ($(du -h "$f" | cut -f1))"

            trap - EXIT
            pointer ok
          EOT
        ]

        # ⚠️ SANS DSN, LE CHECK-IN SENTRY EST UN NO-OP SILENCIEUX (FRE-81). Le script
        # ci-dessus pointe au début et à la fin ; sans DSN il n'a personne à qui
        # parler, et le dump horaire redevient invisible. C'est la variable qui
        # ARME la surveillance.
        #
        # Pas un secret : un DSN est public par nature (cf. brokkr.tf).
        env {
          name  = "SENTRY_DSN"
          value = var.sentry_dsn
        }
        env {
          name  = "SENTRY_ENVIRONMENT"
          value = "production"
        }

        # Connexion par variables PG* standard (pas d'URL à assembler).
        env {
          name  = "PGHOST"
          value = neon_project.ff.database_host # DIRECT (pas le pooler)
        }
        env {
          name  = "PGDATABASE"
          value = neon_database.app.name
        }
        env {
          name  = "PGUSER"
          value = neon_role.brokkr.name
        }
        env {
          name  = "PGSSLMODE"
          value = "require"
        }
        env {
          name = "PGPASSWORD"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.db_password.secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "backup"
          mount_path = "/backup"
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }

      volumes {
        name = "backup"
        gcs {
          bucket = google_storage_bucket.db_backups.name
        }
      }
    }
  }

  # Cloud Run valide l'accès au secret À LA CRÉATION du job → les bindings IAM
  # du SA doivent exister avant (sinon : Permission denied en course avec l'IAM).
  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.neon_backup_db_password,
    google_storage_bucket_iam_member.neon_backup_writer,
  ]
}

# Le scheduler déclenche le job via l'API Cloud Run (OAuth du SA → run.invoker
# sur le job). Région scheduler = europe-west1 (Cloud Scheduler n'est pas
# disponible partout ; le job, lui, reste en ${var.region}).
resource "google_cloud_run_v2_job_iam_member" "scheduler_invokes_backup" {
  project  = var.project_id
  location = google_cloud_run_v2_job.neon_backup.location
  name     = google_cloud_run_v2_job.neon_backup.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.neon_backup.email}"
}

resource "google_cloud_scheduler_job" "neon_backup_nightly" {
  name    = "neon-backup-nightly"
  project = var.project_id
  region  = "europe-west1"
  # TOUTES LES HEURES. Le planning ne suit plus la fenêtre d'historique Neon : il
  # fixe directement la PERTE MAXIMALE, qui est l'intervalle entre deux dumps
  # (cf. l'en-tête). Passé de 6 h à 1 h le 17/08, après la bascule de l'arbre
  # d'entraînement — le domaine le plus écrit, et celui dont une perte coûterait
  # le plus cher à reconstituer.
  #
  # ⚠️ Le nom de la ressource et du job dit encore « nightly ». Le corriger force
  # un remplacement du Cloud Scheduler (le `name` est immuable) : à faire au
  # prochain passage qui touche déjà cette ressource, pas pour un libellé.
  #
  # ⚠️ SURVEILLER LES COMPUTE-HOURS NEON. Chaque dump réveille le compute, qui
  # s'auto-suspend ensuite. En journée c'est sans effet — brokkr le tient déjà
  # éveillé — mais la nuit ça ajoute une dizaine de réveils. Si le quota du free
  # tier devient juste, la première chose à relâcher est la cadence NOCTURNE
  # (ex. `0 * * * *` en journée, moins la nuit), pas la rétention.
  schedule  = "10 * * * *"
  time_zone = "Europe/Paris"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.neon_backup.name}:run"

    oauth_token {
      service_account_email = google_service_account.neon_backup.email
    }
  }

  retry_config {
    retry_count = 1
  }

  depends_on = [google_project_service.apis]
}

output "db_backups_bucket" {
  value       = google_storage_bucket.db_backups.name
  description = "Bucket des dumps Neon (4/jour, rétention 90 j)."
}
