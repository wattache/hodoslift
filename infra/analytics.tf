# --------------------------------------------------------------------------- #
# Rafraîchissement de la projection analytics `training_sets`.
#
# POURQUOI : la table qui alimente l'onglet Tracking est DÉRIVÉE de l'arbre
# d'entraînement. Sans ce job, elle fige à la dernière exécution manuelle de
# l'ETL — un coach verrait des chiffres périmés sans forcément le remarquer.
#
# ⚠️ CORRECTION DU 17/08 — CE JOB RESTE, ce fichier disait le contraire.
# Il avait cessé de servir après la bascule de l'arbre (FRE-12, 16/08) : il lisait
# encore Firestore, désormais figé, et reconstruisait chaque nuit une table
# arrêtée au 15/08. La réponse envisagée était de le SUPPRIMER en faisant de
# `training_sets` une vue. La source et la cible vivant maintenant dans la même
# base, c'est un `INSERT … SELECT` qui l'a remplacé (FRE-48) : le script existe
# toujours, ce job le lance toujours, et une projection matérialisée garde
# l'avantage de ne rien coûter à la lecture. Ne cherchez pas la vue, il n'y en a
# pas — et `refresh_coach_one_rm` (FRE-30) reste donc greffée ici.
#
# COMMENT : Cloud Scheduler → Cloud Run Job → l'IMAGE BROKKR elle-même, dont on
# écrase la commande pour lancer `scripts.etl_training_sets --apply`. Pas
# d'image dédiée à maintenir : le script vit dans le dépôt brokkr et part avec
# chaque déploiement.
#
# Le rebuild est un DELETE + INSERT dans UNE transaction : les lecteurs voient
# l'ancienne version jusqu'au commit, personne n'est bloqué. (C'est aussi
# pourquoi l'ETL n'utilise PAS TRUNCATE, qui verrouillerait la table.)
#
# SA : celui de brokkr. ⚠️ CE PARAGRAPHE A MENTI JUSQU'AU 06/09 : il disait que
# `datastore.user` « reste attaché pour le service (l'authentification en
# dépend) ». Le rôle a été RETIRÉ le 2026-08-27 (FRE-88), et l'authentification
# n'en dépendait pas — `verify_id_token` valide une signature contre les clés
# publiques de Google, sans appel d'API autorisé. Le raisonnement complet est
# dans `brokkr.tf`, qui est la source de vérité pour les rôles de ce SA.
# --------------------------------------------------------------------------- #

resource "google_cloud_run_v2_job" "training_analytics_refresh" {
  name     = "training-analytics-refresh"
  project  = var.project_id
  location = var.region

  template {
    template {
      service_account = google_service_account.brokkr.email
      max_retries     = 1
      timeout         = "900s" # ~12 s en pratique ; large pour un réveil Neon

      containers {
        image = local.brokkr_image
        # `uv run --no-sync` : même invocation que le CMD de l'image (les deps
        # sont dans le venv uv, pas dans le python système).
        command = ["uv", "run", "--no-sync", "python", "-m", "scripts.etl_training_sets"]
        args    = ["--apply"]

        # ⚠️ SANS DSN, LE CHECK-IN SENTRY EST UN NO-OP SILENCIEUX (FRE-81). Le job
        # déclare son propre monitor au premier check-in (`monitor_config` dans
        # `scripts/etl_training_sets.py`), mais `sentry_sdk` ne parle à personne
        # tant que `installer()` n'a pas de DSN — le code dégrade proprement, et
        # ne surveille donc rien. C'est la variable qui ARME la surveillance.
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

        # Mêmes variables DB que le service (cf. brokkr.tf) : app/db.py
        # reconstruit DATABASE_URL à partir de DB_*.
        #
        # ⚠️ LE POOLER, PAS L'ENDPOINT DIRECT DU SERVICE — et ce n'est plus ce qui
        # tient le job en vie (FRE-155). Le pooler ne propage pas les défauts du
        # rôle `brokkr`, dont `statement_timeout = 15s` ; le rebuild prend ~12 s
        # sur une table qui grossit. Il y échappait donc par accident. Depuis,
        # `scripts/etl_training_sets.py` lève cette borne lui-même (`SET LOCAL`)
        # : basculer sur `database_host` est sans danger pour lui.
        env {
          name  = "DB_HOST"
          value = neon_project.ff.database_host_pooler
        }
        env {
          name  = "DB_NAME"
          value = neon_database.app.name
        }
        # ⚠️ MÊME RÔLE APPLICATIF QUE LE SERVICE (FRE-151), et il faut les
        # basculer ENSEMBLE : une moitié oubliée ne se verrait qu'à 3 h 30 le
        # lendemain, quand le job tourne. L'ETL ne fait que `DELETE` puis
        # `INSERT … SELECT` sur `training_sets` — les droits suffisent.
        #
        # ⚠️ ET IL PASSE PAR LE POOLER, contrairement au service — délibérément :
        # c'est ce qui lui fait échapper au `statement_timeout` de 15 s porté par
        # le rôle, sans quoi l'ETL serait tué en route (FRE-155). La question
        # était donc de savoir si Neon authentifie par ce chemin un rôle créé en
        # SQL plutôt que par son API : ÉPROUVÉ le 09/09, il le fait — connexion
        # établie et lecture rendue, sur le pooler comme sur le direct.
        env {
          name  = "DB_USER"
          value = local.role_applicatif
        }
        env {
          name = "DB_PASSWORD"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.brokkr_app_db_password.secret_id
              version = "latest"
            }
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }
    }
  }

  # Cloud Run valide l'accès au secret à la CRÉATION du job : le binding IAM
  # doit exister avant (cf. le même piège sur le job de backup).
  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.brokkr_db_password,
    google_secret_manager_secret_iam_member.brokkr_app_db_password,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invokes_analytics" {
  project  = var.project_id
  location = google_cloud_run_v2_job.training_analytics_refresh.location
  name     = google_cloud_run_v2_job.training_analytics_refresh.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.brokkr.email}"
}

resource "google_cloud_scheduler_job" "training_analytics_refresh" {
  name    = "training-analytics-refresh"
  project = var.project_id
  region  = "europe-west1" # Cloud Scheduler n'est pas dans toutes les régions
  # Une fois par nuit, 20 min après le backup Neon (03h10) : pas deux réveils du
  # compute à la même minute. Les courbes sont hebdomadaires, une séance saisie
  # aujourd'hui apparaît demain matin — et le front affiche jusqu'où va la donnée.
  # Pour un rafraîchissement immédiat : `gcloud run jobs execute
  # training-analytics-refresh --region europe-west4`.
  schedule  = "30 3 * * *"
  time_zone = "Europe/Paris"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.training_analytics_refresh.name}:run"

    oauth_token {
      service_account_email = google_service_account.brokkr.email
    }
  }

  retry_config {
    retry_count = 1
  }

  depends_on = [google_project_service.apis]
}
