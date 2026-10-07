variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "french-forge-600"
}

variable "region" {
  description = "GCP region for Artifact Registry"
  type        = string
  default     = "europe-west4"
}

variable "app_name" {
  description = "Application name used for resource naming"
  type        = string
  default     = "french-forge-trainer"
}

variable "brokkr_image_tag" {
  description = "Tag de l'image brokkr déclarée à la création/recréation du service. Les rollouts de routine passent par `make deploy` (image ignorée par TF — cf. ignore_changes). Pour un bootstrap from-scratch où l'image n'existe pas encore, surcharger temporairement brokkr_image_override avec l'image hello de Cloud Run."
  type        = string
  default     = "latest"
}

variable "brokkr_image_override" {
  description = "Si non vide, remplace l'image déclarée (utile pour un 1er apply sur un nouvel environnement où brokkr:tag n'existe pas encore — y mettre 'us-docker.pkg.dev/cloudrun/container/hello')."
  type        = string
  default     = ""
}

variable "brokkr_key_path" {
  description = "Chemin où Terraform écrit la clé SA brokkr pour le dev local (relatif au dossier nidavellir). Dans le repo brokkr, gitignoré."
  type        = string
  default     = "../api-python/.secrets/brokkr-sa.json"
}

variable "brokkr_min_instances" {
  description = "Instances Cloud Run toujours chaudes. 1 = pas de cold start (coût : 1 instance idle 24/7, CPU throttlée hors requête). 0 = cold start possible."
  type        = number
  default     = 1
}

variable "brokkr_max_instances" {
  description = "Plafond d'instances Cloud Run (garde-fou coût)."
  type        = number
  default     = 4
}

variable "storage_location" {
  description = "Cloud Storage location for Firebase Storage assets"
  type        = string
  default     = "EUROPE-WEST9"
}

variable "public_media_bucket_name" {
  description = "Bucket GCS des médias PUBLICS du site vitrine (photos coachs + témoignages). Par défaut, nom projet-scopé sans points. Distinct du bucket avatars, qui reste privé (public_access_prevention=enforced)."
  type        = string
  default     = null
}

# `avatar_storage_bucket_name` et `avatar_cors_origins` retirées avec le bucket
# des avatars (FRE-88, cf. storage.tf). La seconde portait douze origines
# autorisées à téléverser — dont deux domaines de la v2, éteinte depuis le 16/08.

# ⚠️ PAS UN SECRET — donc une variable ordinaire, avec sa valeur en clair ici.
# Un DSN Sentry est public par nature : celui du front est embarqué dans le
# bundle du navigateur. Le mettre en `sensitive` ou dans Secret Manager
# suggérerait une confidentialité qu'il n'a pas, et compliquerait la lecture du
# plan pour rien.
#
# Vide, brokkr n'envoie rien : c'est l'interrupteur, et il permet de couper les
# envois sans redéployer le code.
variable "sentry_dsn" {
  description = "DSN Sentry du projet brokkr (hébergement UE). Public, pas un secret."
  type        = string
  default     = "https://631f3dc4e1e053a3452abc8b40268e68@o4511943869333504.ingest.de.sentry.io/4511943894696016"
}

# ============================================================================
# SCALEWAY (FRE-99) — le stockage des médias, hors GCP
# ============================================================================

variable "scaleway_region" {
  description = "Région Scaleway des seaux médias. Paris par défaut — l'hébergement européen est un critère explicite."
  type        = string
  default     = "fr-par"
}

# Les jeux de permissions accordés à brokkr — CONFIRMÉS le 25/08 par
# `scw iam permission-set list`, pas devinés. Scaleway en expose neuf pour
# Object Storage ; on en prend deux.
#
# ⚠️ `ObjectStorageObjectsWrite` COUVRE LE REMPLACEMENT — « create and edit
# objects » — et c'est ce qui compte. Côté GCS, `app/storage.py` a dû prendre
# `objectAdmin` plutôt qu'`objectCreator` précisément parce que ce dernier
# autorisait la création mais pas le remplacement : la première photo d'un coach
# passait, toutes les suivantes tombaient en 403. Or changer sa photo est le cas
# nominal, pas l'exception. Ici le piège n'existe pas.
#
# ⚠️ `ObjectStorageObjectsDelete` EST VOLONTAIREMENT ABSENT. Aucune route ne
# supprime de média aujourd'hui. Le jour où l'une le fera, elle échouera —
# bruyamment, au moment où on l'écrit, ce qui est le bon moment pour décider
# d'élargir. Accorder d'avance un droit destructeur « au cas où », c'est le
# perdre de vue.
#
# ⚠️ Et RIEN sur les seaux (`ObjectStorageBuckets*`) : brokkr écrit des objets,
# il ne crée ni ne détruit de seau. C'est le travail de Terraform, avec la clé
# de bootstrap.
variable "scaleway_permission_sets" {
  description = "Jeux de permissions de l'application brokkr — objets seulement, sans suppression ni gestion de seaux."
  type        = list(string)
  default     = ["ObjectStorageObjectsRead", "ObjectStorageObjectsWrite"]
}

# ⚠️ L'ORGANISATION SCALEWAY IMPOSE UNE EXPIRATION aux clés d'API — refus à
# l'apply sinon. Ce n'est donc pas un choix de prudence, c'est une contrainte.
#
# ⚠️ CE QUI SE PASSE À CETTE DATE : brokkr perd l'accès aux médias. Les photos
# cessent de s'afficher, les téléversements échouent, et rien n'aura changé dans
# le code — la panne ressemblera à un problème de déploiement. À renouveler AVANT,
# en avançant cette date puis `terraform apply`, ce qui recrée la clé.
variable "scaleway_cle_expire_le" {
  description = "Expiration de la clé d'API de brokkr (ISO 8601). Imposée par l'organisation. La faire avancer AVANT l'échéance : passée, les médias tombent."
  type        = string
  default     = "2027-08-25T00:00:00Z"
}

# ============================================================================
# L'ENVOI D'EMAIL (FRE-166) — cf. `scaleway_email.tf`
# ============================================================================

# ⚠️ L'APEX, ET IL N'Y A RIEN À ISOLER. Un sous-domaine d'envoi
# (`mail.french-forge.com`) protège la réputation d'une messagerie existante ;
# `french-forge.com` n'a AUCUN MX au 10/09, donc pas de messagerie. Reste ce que
# l'athlète lit dans sa boîte, et `french-forge.com` se reconnaît.
#
# ⚠️ LE CHANGER N'EST PAS GRATUIT : le domaine TEM est recréé, et les quatre
# enregistrements DNS sont à reposer dans Cloudflare (dont la clé DKIM, qui est
# propre au domaine).
variable "scaleway_tem_domaine" {
  description = "Domaine expéditeur du courrier transactionnel. Le changer oblige à reposer les enregistrements DNS."
  type        = string
  default     = "french-forge.com"
}

# ⚠️ CE DRAPEAU DIT L'ÉTAT DU MONDE, pas une préférence. La zone DNS est chez
# Cloudflare : Terraform ne peut pas y écrire, il ne peut que VÉRIFIER. Tant
# qu'il est à `false`, la vérification n'existe pas et le domaine n'envoie rien
# — un domaine TEM non vérifié est refusé à l'envoi.
#
# La séquence, en trois temps :
#
#   1. `terraform apply` (drapeau à false) → lire `scaleway_tem_dns_a_poser`
#   2. poser les 4 enregistrements dans Cloudflare
#   3. passer à `true`, `terraform apply` → Terraform vérifie, et ÉCHOUE si la
#      zone ne répond pas ce que Scaleway attend
variable "scaleway_tem_dns_pose" {
  description = "Les enregistrements SPF/DKIM/DMARC/MX sont posés dans Cloudflare. À true, Terraform vérifie le domaine — et échoue s'il n'est pas validé."
  type        = bool
  default     = false
}

# ⚠️ LE SEUL JEU QUI DONNE L'ENVOI SMTP ET RIEN D'AUTRE — confirmé le 10/09 par
# `scw iam permission-set list`, qui en expose dix-sept pour le transactionnel.
# Pas `TransactionalEmailFullAccess` (qui révoquerait le domaine), pas
# `TransactionalEmailEmailFullAccess` (qui relirait les messages partis vers un
# athlète), pas `…EmailApiCreate` (brokkr postera par SMTP).
variable "scaleway_tem_permission_sets" {
  description = "Jeux de permissions d'envoi de brokkr — poster par SMTP, sans lecture des messages ni gestion du domaine."
  type        = list(string)
  default     = ["TransactionalEmailEmailSmtpCreate"]
}

# Les adresses qui entrent dans le Postgres Scaleway (FRE-213), en CIDR. Pas de
# défaut : une base ouverte par oubli serait le pire défaut à avoir. Le poste de
# William d'abord (`curl -s https://api.ipify.org`), suffixé `/32`.
variable "scaleway_postgres_ips_autorisees" {
  description = "CIDR autorisés à joindre le Postgres Scaleway (ex. [\"203.0.113.7/32\"])."
  type        = list(string)

  validation {
    condition     = length(var.scaleway_postgres_ips_autorisees) > 0 && alltrue([for c in var.scaleway_postgres_ips_autorisees : can(cidrhost(c, 0))])
    error_message = "Au moins un CIDR valide (ex. 203.0.113.7/32) : une base sans adresse autorisée est injoignable."
  }
}
