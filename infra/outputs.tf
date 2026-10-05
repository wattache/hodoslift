output "artifact_registry_url" {
  description = "Docker registry URL for pushing images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}

# `firebase_storage_bucket` retiré avec le bucket des avatars (FRE-88, cf.
# storage.tf). Il alimentait `VITE_FIREBASE_STORAGE_BUCKET` — une variable dont
# le front n'a plus l'usage depuis que les photos d'athlètes ont disparu.

output "public_media_bucket" {
  description = "Bucket GCS public du site vitrine (photos coachs + témoignages). URL de lecture : https://storage.googleapis.com/<bucket>/coachs/<slug>/profil.png"
  value       = google_storage_bucket.public_media.name
}

output "brokkr_service_account" {
  description = "Service account email du backend brokkr (à passer à `gcloud run deploy --service-account`)."
  value       = google_service_account.brokkr.email
}

output "brokkr_url" {
  description = "URL publique du service Cloud Run brokkr."
  value       = google_cloud_run_v2_service.brokkr.uri
}

output "brokkr_key_path" {
  description = "Chemin de la clé SA brokkr écrite localement pour le dev (gitignorée dans le repo brokkr)."
  value       = local_sensitive_file.brokkr_key.filename
}
