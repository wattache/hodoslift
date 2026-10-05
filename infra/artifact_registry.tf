resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = var.app_name
  format        = "DOCKER"
  description   = "Docker repository for ${var.app_name}"

  depends_on = [google_project_service.apis]
}
