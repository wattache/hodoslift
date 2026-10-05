# ============================================================================
# NOTIFICATIONS PUSH (28/09) — la paire VAPID de brokkr
#
# Web Push standard : brokkr signe ses envois avec une clé privée qui est à
# NOUS, et donne la clé publique aux navigateurs. Pas FCM — la sortie de GCP
# est décidée, et ces deux valeurs suivent brokkr chez n'importe quel hébergeur.
#
# La paire se génère UNE fois (`cd brokkr && uv run python -m
# scripts.generer_cles_vapid`) et ne change plus : la changer invalide tous les
# abonnements, chaque navigateur devrait se réabonner.
#
# Ni l'une ni l'autre ne se tape à l'`apply` : la publique est une constante, la
# privée vit dans Secret Manager et Terraform l'y LIT.
# ============================================================================

# La clé PUBLIQUE est une constante, pas une variable : elle n'est pas secrète,
# et la changer couperait les notifications de tous les abonnés. La moitié
# publique de la clé privée de `brokkr-vapid-private-key`.
locals {
  vapid_public_key = "BDLj1DaZIDsyOShU1oABrR1Zb7b7vA3gmzMQiifYVnepOCZEuDbEsSWpexxKWZ3TFzEKEwMrGXclKvMLT8-OhiY"
}

resource "google_secret_manager_secret" "vapid_private_key" {
  secret_id = "brokkr-vapid-private-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

# ⚠️ LA VERSION N'EST PLUS GÉRÉE PAR TERRAFORM, ELLE EST LUE. `destroy = false`
# fait OUBLIER la ressource sans détruire la version : sans ce bloc, retirer la
# ressource de la configuration la détruirait, et la clé privée avec — donc tous
# les abonnements.
removed {
  from = google_secret_manager_secret_version.vapid_private_key
  lifecycle {
    destroy = false
  }
}

# La dernière version du secret. Une rotation (à ne faire qu'en connaissance de
# cause) passe par `gcloud secrets versions add`, puis un `apply`. Même modèle
# que `neon_api_key` (neon.tf). Le jour où le secret quittera GCP, seul ce bloc
# changera.
data "google_secret_manager_secret_version" "vapid_private_key" {
  secret = google_secret_manager_secret.vapid_private_key.secret_id
}

resource "google_secret_manager_secret_iam_member" "brokkr_vapid" {
  secret_id = google_secret_manager_secret.vapid_private_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.brokkr.email}"
}
