# brokkr — backend applicatif (Cloud Run).
# Le code applicatif vit dans un repo séparé (external/french-forge/brokkr) ;
# seule l'infra (SA + service) est décrite ici, avec le reste de l'infra projet.
#
# CE N'EST PLUS UN MÉDIATEUR D'ÉCRITURES FIRESTORE. Il l'a été le temps des
# bascules ; depuis celle de l'arbre d'entraînement (FRE-12, 16/08/2026), TOUS
# les domaines vivent en Postgres (Neon) et brokkr en est le backend de plein
# exercice — lecture comprise.

# Service account dédié, au privilège minimal.
resource "google_service_account" "brokkr" {
  account_id   = "brokkr"
  display_name = "brokkr — backend applicatif"
}

# ⚠️ `roles/datastore.user` A ÉTÉ RETIRÉ (2026-08-27, FRE-88).
#
# Le commentaire qui vivait ici affirmait que l'AUTHENTIFICATION en dépendait.
# C'est faux, et vérifié dans le code plutôt que raisonné : aucun client
# Firestore n'est construit nulle part dans `app/` ; `identifiants.py` a remplacé
# le dernier appel par `secrets` (la ligne Firestore qu'on y lit est une citation
# de l'ancien code, dans sa docstring) ; et `verify_id_token` est appelé SANS
# `check_revoked`, donc il valide une signature contre les clés publiques de
# Google sans passer un seul appel d'API autorisé.
#
# ⚠️ CE QUI DÉPENDAIT RÉELLEMENT DE CE RÔLE — et que le ticket n'avait pas vu :
# les DIX scripts de `french-forge-trainer/scripts/` (audits, traces PITR,
# migration) lisent Firestore avec la clé de ce SA. Les retirer du rôle les casse.
#
# Retiré quand même, pour deux raisons :
#  1. `datastore.user` donne la LECTURE ET L'ÉCRITURE. Un droit d'écriture
#     permanent sur une base gelée qui contient la seule copie d'avant bascule,
#     que personne n'utilise, est exactement le motif de FRE-112 (`analytics_ro`) ;
#  2. le re-donner prend dix secondes le jour où l'un de ces scripts doit servir,
#     et ce jour-là on saura pourquoi on le fait.
#
# La base reste GELÉE ET PROTÉGÉE : PITR coupé, suppression verrouillée. Elle
# n'est pas gérée par ce Terraform — antérieure, réglée par `gcloud`.
#
# ⚠️ SI UNE CONNEXION CASSE APRÈS L'APPLY, c'est que l'analyse ci-dessus est
# fausse : remettre le bloc et `terraform apply`. La panne serait immédiate et
# totale (plus personne ne se connecte), donc impossible à manquer.

# --- Identité de déploiement -------------------------------------------------
# Compromis solo-dev assumé : le SA brokkr sert AUSSI d'identité pour `make
# build`/`make deploy` (via sa clé), en plus d'être le runtime du service. Les
# rôles ci-dessous lui donnent push d'image + déploiement Cloud Run.
# Durcissement possible plus tard : déplacer ces 3 rôles vers un SA `brokkr-deployer`
# séparé et générer SA clé à lui, en gardant le runtime brokkr sur Firestore seul.

# Pousser l'image dans Artifact Registry.
resource "google_project_iam_member" "brokkr_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.brokkr.email}"
}

# Déployer / mettre à jour le service Cloud Run.
resource "google_project_iam_member" "brokkr_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.brokkr.email}"
}

# Déployer un service qui tourne SOUS lui-même → le SA doit pouvoir actAs lui-même.
resource "google_service_account_iam_member" "brokkr_act_as_self" {
  service_account_id = google_service_account.brokkr.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.brokkr.email}"
}

locals {
  # Vraie image brokkr dans le dépôt Artifact Registry `french-forge-trainer`.
  # `brokkr_image_override` permet d'injecter l'image `hello` de Cloud Run pour
  # un tout premier apply sur un environnement vierge (où brokkr:tag n'existe pas).
  brokkr_image = coalesce(
    var.brokkr_image_override != "" ? var.brokkr_image_override : null,
    "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/brokkr:${var.brokkr_image_tag}"
  )
}

resource "google_cloud_run_v2_service" "brokkr" {
  name     = "brokkr"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.brokkr.email

    # min = 1 → une instance toujours chaude, pas de cold start (une saisie de
    # forme du jour ne doit pas attendre un démarrage à froid). max = garde-fou coût.
    scaling {
      min_instance_count = var.brokkr_min_instances
      max_instance_count = var.brokkr_max_instances
    }

    # ⚠️ LE PLAFOND RÉEL N'EST PAS CELUI DE CLOUD RUN, C'EST LE POOL (FRE-135).
    # Le défaut de Cloud Run est 80 requêtes simultanées par instance. brokkr,
    # lui, tient au plus SEPT connexions à la fois (`pool_size=5` +
    # `max_overflow=2`, `app/db.py`), et chaque requête en ouvre DEUX en séquence
    # — celle de l'autorisation, puis celle de la route. Un coach qui ouvre
    # l'écran Entraînement en tire cinq en parallèle.
    #
    # Conséquence du défaut : la huitième requête attend une connexion, pendant
    # que Cloud Run considère l'instance à 10 % de sa charge et ne monte JAMAIS.
    # Le service s'engorge sans jamais déclencher ce qui existe pour l'éviter.
    #
    # Dix est un plafond aligné sur le pool, pas un chiffre rond : au-delà, la
    # file d'attente serait dans le pool (invisible, 5 s puis échec) plutôt que
    # dans Cloud Run (visible, et qui déclenche une instance de plus).
    max_instance_request_concurrency = 10

    containers {
      # Image déclarée à la création/recréation du service. Les rollouts de
      # routine se font hors-Terraform via `make deploy` (gcloud) ; le service
      # tourne donc la dernière image poussée, pas forcément ce tag exact.
      # `ignore_changes` ci-dessous → TF ne touche jamais l'image après création.
      image = local.brokkr_image

      ports {
        container_port = 8080
      }

      env {
        name  = "PROJECT_ID"
        value = var.project_id
      }

      # ⚠️ LE DSN SENTRY N'EST PAS UN SECRET, et n'a donc rien à faire dans
      # Secret Manager. Un DSN est public par nature — celui du front est
      # embarqué en clair dans le bundle du navigateur. Secret Manager garde ce
      # que le service lit à l'exécution ET qui doit rester confidentiel : le
      # mot de passe de la base, la clé API Neon.
      #
      # ⚠️ ET IL VIT ICI PLUTÔT QUE DANS LE MAKEFILE, comme les variables DB.
      # `make deploy` utilise `--update-env-vars` (merge) précisément pour ne pas
      # écraser ce que Terraform pose ; y ajouter des variables ferait dépendre
      # la configuration du service de QUI déploie, et non de l'infrastructure
      # déclarée.
      #
      # Vide, brokkr n'envoie rien — c'est l'interrupteur côté application.
      env {
        name  = "SENTRY_DSN"
        value = var.sentry_dsn
      }
      env {
        name  = "SENTRY_ENVIRONMENT"
        value = "production"
      }

      # --- Postgres (Neon) : parties non sensibles en clair, password depuis le
      # secret `brokkr-db-password`. brokkr assemble DATABASE_URL (app/db.py). --- #

      # ⚠️ L'ENDPOINT DIRECT, ET PLUS LE POOLER (FRE-135, 08/09). Le pooler était
      # choisi « adapté au serverless / connexions courtes », avec pour motif écrit
      # que « le free tier Neon plafonne les connexions ». MESURÉ le 08/09 :
      #
      #     max_connections = 901 · ouvertes = 25 · sur notre base = 11
      #
      # brokkr en demande SEPT par instance (`pool_size=5` + `max_overflow=2`),
      # donc 28 au plafond de quatre instances. Le motif ne tient plus — s'il a
      # jamais tenu.
      #
      # ⚠️ ET CE QUE LE POOLER COÛTAIT ÉTAIT RÉEL : PgBouncer, en mode transaction,
      # refuse le paramètre `options` à l'ouverture — ce qui a fait TOMBER la
      # production le 08/09 — et ne propage pas les défauts de rôle. Mesuré, par
      # les deux chemins, la même seconde :
      #
      #     DIRECT   → statement_timeout=15s  lock_timeout=5s  TimeZone=Europe/Paris
      #     POOLER   → statement_timeout=0    lock_timeout=0   TimeZone=GMT
      #
      # Aucune borne de session n'atteignait donc le serveur. En direct, les trois
      # arrivent — c'est le seul mécanisme qui marche sans coût par requête.
      #
      # ⚠️ CE QU'ON PERD, ET QUAND ÇA COMPTERAIT : le pooler mutualise les
      # connexions serveur entre instances. À 28 connexions contre 901, ça ne
      # compte pas. Ça recommencerait à compter si `brokkr_max_instances` montait
      # d'un ordre de grandeur — le chiffre à surveiller est
      # `max_instances × 7`, pas le nombre d'utilisateurs.
      env {
        name  = "DB_HOST"
        value = neon_project.ff.database_host
      }
      env {
        name  = "DB_NAME"
        value = neon_database.app.name
      }
      # ⚠️ LE RÔLE APPLICATIF, PAS `brokkr` (FRE-151). `brokkr` peut créer des
      # rôles, créer des bases, ignorer la RLS et supprimer n'importe quelle
      # table : c'est le rôle d'ADMINISTRATION, et il reste au `.env` du poste,
      # qui joue les migrations. Le service, lui, ne sait que lire et écrire des
      # lignes sur les tables nommées dans `sql/brokkr_app.sql`.
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

      # --- Scaleway : le stockage des médias (FRE-99). Parties non sensibles en
      # clair — l'access key est un IDENTIFIANT, pas une preuve, au même titre
      # que `DB_USER`. Seul le secret passe par Secret Manager. --- #
      env {
        name  = "SCALEWAY_ACCESS_KEY"
        value = scaleway_iam_api_key.brokkr.access_key
      }
      env {
        name = "SCALEWAY_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.scaleway_secret_key.secret_id
            version = "latest"
          }
        }
      }

      # --- Notifications push (28/09) : la paire VAPID, cf. push.tf. La clé
      # publique est donnée aux navigateurs ; seule la privée est un secret. --- #
      env {
        name  = "VAPID_PUBLIC_KEY"
        value = local.vapid_public_key
      }
      env {
        name = "VAPID_PRIVATE_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.vapid_private_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "SCALEWAY_ENDPOINT"
        value = "https://s3.${var.scaleway_region}.scw.cloud"
      }
      env {
        name  = "SCALEWAY_REGION"
        value = var.scaleway_region
      }
      # Les deux seaux, dont les régimes d'accès diffèrent — cf. scaleway.tf.
      env {
        name  = "SCALEWAY_BUCKET_PUBLIC"
        value = scaleway_object_bucket.coachs_public.name
      }
      env {
        name  = "SCALEWAY_BUCKET_PRIVE"
        value = scaleway_object_bucket.kine_prive.name
      }

      # --- Le courrier transactionnel (FRE-166, cf. scaleway_email.tf) ------
      #
      # ⚠️ AUCUN CODE NE LIT ENCORE CES VARIABLES, et c'est assumé. Elles suivent
      # la convention du dépôt — vide/absent = interrupteur ouvert, `config.py`
      # est en `extra="ignore"` — donc elles sont INERTES jusqu'au jour où
      # FRE-131 écrira l'envoi. Ce qu'elles achètent d'ici là : le déploiement
      # PROUVE la plomberie (le domaine existe, ses coordonnées SMTP sont
      # résolues, le service les reçoit) au lieu de la découvrir en même temps
      # que le premier message.
      #
      # ⚠️ PAS DE `SMTP_PASSWORD` : le mot de passe SMTP de Scaleway EST la
      # secret key de l'application `brokkr`, déjà servie ci-dessus sous
      # `SCALEWAY_SECRET_KEY`. La déposer une seconde fois sous un autre nom
      # ferait croire à deux secrets — donc à deux rotations, alors qu'il n'y en
      # a qu'une (`var.scaleway_cle_expire_le`).
      env {
        name  = "SMTP_HOST"
        value = scaleway_tem_domain.expediteur.smtp_host
      }
      # Le port TLS implicite (`smtps`), pas le 587 en STARTTLS : sur Cloud Run
      # une session chiffrée d'emblée évite de dépendre d'une négociation qu'on
      # ne verra pas échouer.
      env {
        name  = "SMTP_PORT"
        value = scaleway_tem_domain.expediteur.smtps_port
      }
      # ⚠️ L'IDENTIFIANT SMTP EST L'ID DU PROJET SCALEWAY, pas une adresse. Rendu
      # par l'API plutôt que recopié : il change avec le projet.
      env {
        name  = "SMTP_USER"
        value = scaleway_tem_domain.expediteur.smtps_auth_user
      }
      # ⚠️ L'EXPÉDITEUR DOIT APPARTENIR AU DOMAINE VÉRIFIÉ — Scaleway refuse tout
      # autre `From`. Composé depuis la ressource, pour qu'un changement de
      # domaine expéditeur ne laisse pas une adresse morte derrière lui.
      env {
        name  = "MAIL_FROM"
        value = "no-reply@${scaleway_tem_domain.expediteur.name}"
      }

      # ⚠️ UNE SONDE DE DÉMARRAGE, PAS DE VIVACITÉ (FRE-135). Cloud Run considère
      # sinon une instance prête dès qu'elle écoute sur le port : avec
      # `min_instance_count = 1`, une révision qui démarre mal reçoit du trafic
      # avant d'être en état de répondre, et les premières requêtes échouent.
      #
      # `/health` interroge l'application ET rend la version servie — c'est déjà
      # lui que `make verifier` lit après un déploiement pour vérifier le SHA.
      #
      # ⚠️ ET DÉLIBÉRÉMENT PAS DE `liveness_probe`. Une sonde de vivacité
      # REDÉMARRE le conteneur quand elle échoue : si Neon devient injoignable,
      # elle transformerait une panne de base en boucle de redémarrage, ce qui
      # est strictement pire — l'application sait déjà répondre proprement à une
      # base absente (`base_injoignable`), et redémarrer ne la ramène pas.
      startup_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 2
        period_seconds        = 3
        timeout_seconds       = 3
        failure_threshold     = 10 # ~30 s pour démarrer, large pour un cold start
      }
    }
  }

  # L'image réelle est (re)déployée hors-Terraform par `make build && make deploy`.
  # On ignore donc l'image et les métadonnées de déploiement client.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.apis]
}

# Service public au niveau Cloud Run : l'auth est appliquée applicativement
# (vérification de l'ID token Firebase dans chaque route). Même modèle que le front.
resource "google_cloud_run_v2_service_iam_member" "brokkr_public" {
  location = google_cloud_run_v2_service.brokkr.location
  name     = google_cloud_run_v2_service.brokkr.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Clé du SA pour le DEV LOCAL uniquement (la prod utilise le SA attaché au
# service, sans clé). Gérée par Terraform pour tout centraliser ici.
# Note : la clé privée transite par le state Terraform (local + gitignoré).
resource "google_service_account_key" "brokkr_dev" {
  service_account_id = google_service_account.brokkr.name
}

# Écrit la clé directement dans le repo brokkr (`.secrets/`, gitignoré là-bas).
# `local_sensitive_file` ne divulgue pas le contenu dans les plans.
resource "local_sensitive_file" "brokkr_key" {
  content         = base64decode(google_service_account_key.brokkr_dev.private_key)
  filename        = var.brokkr_key_path
  file_permission = "0600"
}
