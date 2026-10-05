# ============================================================================
# SCALEWAY — le stockage des médias, hors GCP (FRE-99, 25/08/2026)
#
# Premier morceau d'infrastructure posé AILLEURS que sur GCP. Décidé par William
# le 25/08 : la vie privée et l'hébergement européen priment, et la sortie de GCP
# ne peut pas se faire si chaque besoin neuf s'y ancre encore.
#
# DEUX SEAUX, DEUX RÉGIMES, ET C'EST LE CŒUR DU FICHIER. `docs/bilan-kine.md`
# §3.6 l'impose : un seul seau ferait basculer les médias de démonstration dans
# le régime des données de santé, et annulerait la compartimentation. Le nom de
# chaque seau DIT son régime, pour qu'on n'y dépose pas un jour ce qui n'y a pas
# sa place.
#
# ⚠️ LE SECRET DE LA CLÉ ATTERRIT DANS LE STATE, et le state vit dans un bucket
# GCS (`french-forge-600-tfstate`). Donc un identifiant Scaleway stocké chez GCP
# — exactement le couplage qu'on cherche à défaire. Assumé par William : « tant
# pis, on migrera petit à petit ». À revoir le jour où le state déménagera ; la
# clé se révoque et se recrée en deux minutes, elle n'est pas un point de
# non-retour.
#
# ⚠️ ŒUF ET POULE, comme pour le bucket de state : le provider a besoin d'une
# clé pour créer quoi que ce soit, y compris celle de brokkr. Une clé de
# BOOTSTRAP existe donc hors cycle Terraform.
#
# ⚠️ MAIS ELLE N'APPARAÎT NULLE PART ICI, ET C'EST VOLONTAIRE. Le provider lit
# `~/.config/scw/config.yaml` — le fichier qu'écrit `scw init`, partagé avec la
# CLI. La documentation le donne comme troisième niveau de priorité, après les
# variables d'environnement et la configuration statique.
#
# Trois bénéfices, et le dernier est le vrai : aucun secret dans le dépôt, rien
# à ré-exporter à chaque shell, et la même configuration sert à `scw` en ligne
# de commande — donc une seule chose à révoquer, pas deux.
# ============================================================================

provider "scaleway" {
  # Identifiants, projet, organisation ET région viennent tous de
  # `~/.config/scw/config.yaml`. `scw init` une fois, et ce fichier fonctionne.
  #
  # ⚠️ RIEN ICI, PAS MÊME LA RÉGION. La déclarer redondait avec le profil, et
  # Terraform le signalait — « Multiple variable sources detected ». Un
  # avertissement qu'on apprend à ignorer est un avertissement perdu pour le jour
  # où il dira quelque chose.
  #
  # ⚠️ MAIS LA RÉGION RESTE EXPLICITE SUR CHAQUE SEAU, et ce n'est pas une
  # inconséquence : `fr-par` est une DÉCISION — l'hébergement européen est le
  # critère qui a fait choisir Scaleway. La laisser au profil local reviendrait à
  # ce qu'une machine mal configurée crée les seaux à Amsterdam sans que rien ne
  # le dise. Ce qui relève du poste va au profil ; ce qui relève de
  # l'architecture reste dans le dépôt.
}

# Le projet courant, tel que le profil `scw` le désigne — plutôt qu'un
# identifiant recopié dans une variable, qui se désynchroniserait le jour d'un
# second projet.
data "scaleway_account_project" "courant" {}

# ----------------------------------------------------------------------------
# 1. LE SEAU PUBLIC — photos de coachs
#
# Reprend ce que `google_storage_bucket.public_media` sert aujourd'hui : la photo
# détourée de chaque coach, affichée à des visiteurs NON authentifiés du site
# vitrine. Lisible par n'importe qui, par construction, parce que c'est l'usage.
# ----------------------------------------------------------------------------

resource "scaleway_object_bucket" "coachs_public" {
  name   = "french-forge-coachs-public"
  region = var.scaleway_region

  # On ne détruit jamais un seau qui porte de la donnée par simple `apply` —
  # même règle que côté GCS.
  force_destroy = false
}

resource "scaleway_object_bucket_acl" "coachs_public" {
  bucket = scaleway_object_bucket.coachs_public.id
  region = var.scaleway_region
  acl    = "public-read"
}

# ----------------------------------------------------------------------------
# 2. LE SEAU PRIVÉ — médias du kiné
#
# ⚠️ PRIVÉ PAR CHOIX, PAS PAR OBLIGATION, et la nuance mérite d'être écrite. La
# spec classe les médias de DÉMONSTRATION comme non sensibles (§3.6) : un seau
# public aurait suffi. William a préféré le privé — une URL qui fuit finit par
# expirer.
#
# ✅ Effet de bord heureux : la lecture par URL signée devra être écrite
# maintenant, donc elle existera déjà le jour du lot C (vidéos d'athlète), où le
# privé n'est plus une préférence mais une obligation (FRE-58). On écrit une
# fois ce qui servira deux fois.
#
# PAS de `scaleway_object_bucket_acl` ici : privé est le défaut, et une ressource
# qui déclare l'état par défaut invite à la retoucher.
# ----------------------------------------------------------------------------

resource "scaleway_object_bucket" "kine_prive" {
  name   = "french-forge-kine-prive"
  region = var.scaleway_region

  force_destroy = false
}

# ----------------------------------------------------------------------------
# 3. L'IDENTITÉ DE BROKKR
#
# Une application IAM dédiée plutôt que la clé personnelle de William : une clé
# nominative se révoque avec la personne, et se retrouve dans les journaux sous
# son nom pour des actions qui sont celles d'un service.
# ----------------------------------------------------------------------------

resource "scaleway_iam_application" "brokkr" {
  name        = "brokkr"
  description = "Backend applicatif — lecture/écriture des médias"
}

resource "scaleway_iam_policy" "brokkr_medias" {
  # ⚠️ NOM SANS ACCENT NI TIRET CADRATIN : Scaleway contraint les noms de
  # politique à `^[\w().\-]+( +[\w().\-]+)*$`, et `\w` s'y limite à
  # `[0-9A-Za-z_]`. « brokkr — médias » était refusé. La DESCRIPTION, elle,
  # accepte le français — c'est là que va la phrase lisible.
  name           = "brokkr-medias"
  description    = "Objets des seaux medias, sur le seul projet French Forge"
  application_id = scaleway_iam_application.brokkr.id

  rule {
    project_ids          = [data.scaleway_account_project.courant.id]
    permission_set_names = var.scaleway_permission_sets
  }
}

# ⚠️ CETTE CLÉ EXPIRE, ET CE N'EST PAS NÉGOCIABLE : les réglages de sécurité de
# l'organisation Scaleway REFUSENT une clé sans date d'expiration. Découvert à
# l'apply, pas choisi.
#
# ⚠️ ET C'EST UNE ÉCHÉANCE RÉELLE, PAS UNE FORMALITÉ. Le jour venu, brokkr perd
# l'accès aux médias — les photos cessent de s'afficher et les téléversements
# échouent, sans que rien n'ait changé dans le code. C'est exactement le genre de
# panne qui coûte une demi-journée parce qu'on cherche du côté du déploiement.
#
# La date est donc EXPLICITE dans une variable plutôt que calculée : `timestamp()`
# rendrait le plan instable (une nouvelle date à chaque exécution, donc un diff
# perpétuel), et une date en dur se voit dans le dépôt, se cherche, et se
# renouvelle sciemment.
resource "scaleway_iam_api_key" "brokkr" {
  application_id     = scaleway_iam_application.brokkr.id
  description        = "brokkr - medias (creee par Terraform)"
  default_project_id = data.scaleway_account_project.courant.id
  expires_at         = var.scaleway_cle_expire_le
}

# ----------------------------------------------------------------------------
# 4. LA CLÉ ATTEINT BROKKR — par Secret Manager, comme le mot de passe Neon
#
# Même chemin que `brokkr-db-password` (neon.tf), et c'est délibéré : brokkr
# reçoit déjà ses secrets par là, il n'y a aucune raison d'en inventer un second.
# Un projet où chaque secret arrive par une voie différente est un projet où
# personne ne sait plus lesquels existent.
#
# ⚠️ LA VALEUR TRANSITE PAR TERRAFORM, donc par le state — mais elle y était
# déjà (`scaleway_iam_api_key.brokkr.secret_key`). Ce bloc n'ajoute aucune
# exposition ; il évite en revanche un copier-coller manuel, qui lui en
# ajouterait une : le presse-papier, l'historique du shell, et une valeur qu'on
# ne sait plus si elle est à jour.
#
# ⚠️ L'ACCESS KEY N'EST PAS UN SECRET, et elle voyage en clair dans l'env, comme
# `DB_USER`. C'est un identifiant, pas une preuve — la traiter en secret
# banaliserait ceux qui le sont vraiment.
# ----------------------------------------------------------------------------

resource "google_secret_manager_secret" "scaleway_secret_key" {
  secret_id = "brokkr-scaleway-secret-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "scaleway_secret_key" {
  secret      = google_secret_manager_secret.scaleway_secret_key.id
  secret_data = scaleway_iam_api_key.brokkr.secret_key
}

resource "google_secret_manager_secret_iam_member" "brokkr_scaleway" {
  secret_id = google_secret_manager_secret.scaleway_secret_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.brokkr.email}"
}

# ----------------------------------------------------------------------------
# Sorties
#
# ⚠️ LE SECRET N'EST LISIBLE QU'À LA CRÉATION. La documentation du provider est
# explicite : `secret_key` devient `null` sur une ressource importée. Si on le
# perd, on ne le relit pas — on recrée la clé.
# ----------------------------------------------------------------------------

output "scaleway_brokkr_access_key" {
  description = "Access key de l'application brokkr — à passer à brokkr avec le secret."
  value       = scaleway_iam_api_key.brokkr.access_key
}

output "scaleway_brokkr_secret_key" {
  description = "Secret key de brokkr. `terraform output -raw scaleway_brokkr_secret_key` pour la lire."
  value       = scaleway_iam_api_key.brokkr.secret_key
  sensitive   = true
}

output "scaleway_buckets" {
  description = "Les deux seaux médias, avec leur régime d'accès."
  value = {
    coachs_public = scaleway_object_bucket.coachs_public.name
    kine_prive    = scaleway_object_bucket.kine_prive.name
    endpoint      = "https://s3.${var.scaleway_region}.scw.cloud"
  }
}
