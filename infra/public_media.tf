locals {
  public_media_bucket_name = coalesce(var.public_media_bucket_name, "${var.project_id}-public-media")
}

# Bucket des médias PUBLICS du site vitrine (french-forge.com) : photo détourée
# de chaque coach + photos des athlètes qui témoignent. Servis à des visiteurs
# NON authentifiés via de simples <img src="https://storage.googleapis.com/…">.
#
# ⚠️ Bucket DISTINCT de google_storage_bucket.avatars (storage.tf), qui reste
# strictement privé (public_access_prevention=enforced) : ce dernier contient les
# photos de profil de vrais athlètes, potentiellement mineurs, qui n'ont jamais
# consenti à une diffusion publique. On n'y touche pas. Le contenu public vit
# ici, dans un bucket séparé, pour qu'aucun relâchement d'IAM n'expose l'autre.
resource "google_storage_bucket" "public_media" {
  name                        = local.public_media_bucket_name
  project                     = var.project_id
  location                    = var.storage_location
  uniform_bucket_level_access = true

  # PAS "enforced" : ce bucket est fait pour être lu publiquement. "enforced"
  # bloquerait au niveau du bucket toute IAM accordée à allUsers/allAuthenticated
  # → le binding objectViewer ci-dessous serait refusé et les <img> renverraient
  # du 403. "inherited" laisse l'IAM explicite décider (org policy en amont si
  # besoin). Le pendant privé (avatars) garde "enforced", justement pour interdire
  # toute exposition publique — les deux buckets appliquent la politique opposée
  # parce qu'ils ont des usages opposés.
  public_access_prevention = "inherited"

  # On ne détruit jamais un bucket qui contient de la donnée par simple `apply`.
  force_destroy = false

  labels = {
    app     = var.app_name
    purpose = "public-site-media"
  }

  # Pas de bloc cors : un <img src> est une requête simple, sans preflight. Ajouter
  # du CORS « au cas où » n'ouvrirait que de la surface d'attaque sans usage. Si un
  # jour une image doit passer par un <canvas> (lecture pixel cross-origin), on
  # posera le CORS à ce moment-là, pour les origines concernées uniquement.

  depends_on = [google_project_service.apis]
}

# Lecture publique : tout le monde (allUsers, non authentifiés compris) peut lire
# les objets. objectViewer = lecture des objets, PAS listing/écriture du bucket.
# On passe par un IAM member (binding additif) et non un policy/binding
# authoritatif, pour ne pas écraser d'autres bindings éventuels du bucket.
resource "google_storage_bucket_iam_member" "public_media_read" {
  bucket = google_storage_bucket.public_media.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Écriture par brokkr : un coach téléverse sa photo depuis l'app, brokkr la dépose
# ici (FRE-30). L'upload passe par Cloud Run plutôt que par une URL signée — signer
# une V4 depuis un ADC sans clé privée exigerait en plus roles/iam.serviceAccount
# TokenCreator sur soi-même et l'API IAM SignBlob, pour une photo de quelques
# centaines de ko.
#
# objectAdmin et NON objectCreator : ce dernier crée mais ne REMPLACE pas
# ("does not give permission to view, delete, or replace objects"). Un coach qui
# change sa photo réécrit `<slug>/profil.png` — donc la 1re fois passerait et
# toutes les suivantes tomberaient en 403, un défaut qui n'apparaîtrait qu'après
# la mise en service. Écraser un objet demande create ET delete.
#
# Le surplus d'objectAdmin (get/list) n'expose rien de plus : tout le contenu de ce
# bucket est déjà lisible par allUsers. Portée limitée à CE bucket — le bucket privé
# des avatars d'athlètes reste hors d'atteinte.
resource "google_storage_bucket_iam_member" "public_media_write_brokkr" {
  bucket = google_storage_bucket.public_media.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.brokkr.email}"
}

# Pas de google_firebase_storage_bucket ici : ce bucket n'est pas servi par le SDK
# Firebase depuis l'app. Les objets y sont déposés à la main (gcloud storage cp).
# L'attacher à Firebase n'ajouterait que des storage.rules à maintenir pour rien.

# ─────────────────────────────────────────────────────────────────────────────
# Convention de nommage des objets (déposés À LA MAIN, pas gérés par Terraform)
# ─────────────────────────────────────────────────────────────────────────────
#   <slug>/profil.png                → photo détourée du coach
#   <slug>/temoignages/<athlete>.jpg → photo d'un athlète qui témoigne
#
# <slug> : nom du coach en minuscules, tirets à la place des espaces/accents.
# Exemple avec les trois coachs actuels :
#   aubin-chevillard/profil.png
#   aubin-chevillard/temoignages/dylan.jpg
#   maxime-nowak/profil.png
#   maxime-nowak/temoignages/…
#   theo-goutte-toquet/profil.png
#
# Upload avec un cache long (ces images ne changent qu'exceptionnellement) :
#   gcloud storage cp profil.png gs://<bucket>/<slug>/profil.png \
#       --cache-control="public, max-age=86400"
