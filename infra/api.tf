# api — l'API en Go (Connect), sur Cloud Run, à côté de brokkr (api-python).
# Même compte de service, même base, mêmes secrets : rien de neuf à ouvrir.
#
# Comme brokkr, Terraform possède la COQUILLE du service ; les déploiements
# d'image passent par `make -C ../api deploy` (image ignorée ici).
#
# ⚠️ L'IMAGE N'EXISTE PAS AU PREMIER APPLY : `make -C ../api build` d'abord, qui
# pousse `api:latest` — ou `api_image_override` vers l'image `hello` de Cloud Run.

variable "api_image_tag" {
  description = "Tag de l'image api déclarée à la création du service. Les déploiements passent par `make -C ../api deploy` (image ignorée par Terraform)."
  type        = string
  default     = "latest"
}

variable "api_image_override" {
  description = "Si non vide, remplace l'image déclarée (premier apply, quand api:tag n'existe pas encore : 'us-docker.pkg.dev/cloudrun/container/hello')."
  type        = string
  default     = ""
}

variable "api_sentry_dsn" {
  description = "DSN Sentry de l'api Go (projet à créer dans Sentry). Vide : aucun envoi."
  type        = string
  default     = ""
  sensitive   = true
}

locals {
  api_image = coalesce(
    var.api_image_override != "" ? var.api_image_override : null,
    "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/api:${var.api_image_tag}"
  )
}

resource "google_cloud_run_v2_service" "api" {
  name     = "api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.brokkr.email
    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }
    max_instance_request_concurrency = 80

    containers {
      image = local.api_image
      ports {
        container_port = 8080
      }
      env {
        name  = "PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "SENTRY_DSN"
        value = var.api_sentry_dsn
      }
      env {
        name  = "SENTRY_ENVIRONMENT"
        value = "production"
      }
      # ⚠️ L'ENDPOINT DIRECT, pas le pooler : les bornes de session vivent sur
      # le rôle et le pooler ne les propage pas (FRE-135) — même règle que brokkr.
      env {
        name  = "DB_HOST"
        value = neon_project.ff.database_host
      }
      env {
        name  = "DB_NAME"
        value = neon_database.app.name
      }
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
      startup_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 1
        period_seconds        = 2
        timeout_seconds       = 2
        failure_threshold     = 10
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "api_url" {
  description = "URL publique de l'api Go — VITE_SINDRI_URL du front (`make -C ../web hosting` la lit seul)."
  value       = google_cloud_run_v2_service.api.uri
}
