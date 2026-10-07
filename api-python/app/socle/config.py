from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    project_id: str = "french-forge-600"

    # ⚠️ VIDE par défaut, et c'est l'INTERRUPTEUR : sans DSN, le SDK Sentry ne
    # s'initialise pas. Les tests, `make dev` et le harnais e2e n'émettent rien,
    # sans qu'aucun code n'ait à tester l'environnement. Seul Cloud Run le reçoit.
    #
    # Un DSN n'est PAS un secret — le front l'embarque en clair dans son bundle.
    # Il n'a rien à faire dans Secret Manager.
    sentry_dsn: str = ""
    # Web Push (28/09) : la paire VAPID, générée une fois (`python -m scripts.generer_cles_vapid`).
    # Vides = pas de notification, et le front ne propose pas le réglage. La
    # clé PRIVÉE est un secret ; la publique se donne au navigateur.
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    vapid_contact: str = "mailto:attachew974@gmail.com"
    # `production` sur Cloud Run. Sépare les flux dans Sentry, et décide de
    # `regex_d_origines` plus bas.
    sentry_environment: str = "local"
    # ⚠️ La VERSION du code : le SHA court, injecté au build (cf. Dockerfile). À
    # défaut, `K_REVISION` — que Cloud Run pose sur chaque révision — change quand
    # même à chaque déploiement.
    git_sha: str = ""
    k_revision: str = ""

    @property
    def version_deployee(self) -> str | None:
        return self.git_sha or self.k_revision or None

    # Postgres (Neon serverless). EN LOCAL : la connection string Neon (endpoint
    # POOLER, sslmode=require) déposée dans `.env` (gitignoré). EN PROD : vide,
    # l'URL est assemblée depuis les `db_*` ci-dessous. Vide par défaut → l'engine
    # n'est construit qu'à la 1re utilisation (cf. `app/socle/db.py`), donc l'app
    # démarre sans Postgres configuré.
    database_url: str = ""

    # Les parties de l'URL, en env Cloud Run. Le mot de passe vient du secret
    # `brokkr-db-password` ; host/db/user sont non sensibles. `db.py` assemble
    # l'URL (encodage sûr) à partir de ces morceaux.
    db_host: str = ""
    db_user: str = ""
    db_password: str = ""
    db_name: str = ""
    # Absent = 5432. Le point PUBLIC de la base Scaleway sert sur un autre port.
    db_port: int | None = None

    # Bucket GCS des médias PUBLICS du site vitrine (photos de coachs — FRE-30).
    # Distinct du bucket privé des avatars d'athlètes (public_access_prevention
    # enforced) — cf. nidavellir/public_media.tf.
    public_media_bucket: str = "french-forge-600-public-media"

    # --- Scaleway : le stockage des médias, hors GCP (FRE-99) ---------------
    # ⚠️ VIDES PAR DÉFAUT, ET C'EST L'INTERRUPTEUR — même convention que le DSN
    # Sentry. Sans clé, `mediatheque` refuse de servir : en local et dans les
    # tests, rien ne part chez Scaleway par accident.
    scaleway_access_key: str = ""
    scaleway_secret_key: str = ""
    scaleway_endpoint: str = "https://s3.fr-par.scw.cloud"
    scaleway_region: str = "fr-par"
    # ⚠️ DEUX SEAUX, DEUX RÉGIMES (spec §3.6) : le nom vient de
    # l'infrastructure, jamais d'une constante ici — c'est ce qui rend
    # l'hébergeur remplaçable sans réécrire de lignes.
    scaleway_bucket_public: str = ""
    scaleway_bucket_prive: str = ""
    # ⚠️ Lu par `scripts/purger_photos_athletes.py` SEUL, jamais par l'application :
    # elle ne sert aucune photo d'athlète, ce bucket n'existe que pour être purgé.
    athlete_photos_bucket: str = "french-forge-600-athlete-avatars"

    # Origines autorisées (CORS). Surchargeable via ALLOWED_ORIGINS (JSON list).
    allowed_origins: list[str] = [
        "https://trainer.french-forge.com",
        # Site vitrine (apex) : la landing appelle la route publique coach_profiles
        # en fetch cross-origin (contrairement à un <img>, qui n'a pas besoin de CORS).
        "https://french-forge.com",
    ]
    # ⚠️ AUCUNE adresse par défaut de Firebase ici (FRE-146) : `*.web.app` et
    # `*.firebaseapp.com` servent la MÊME prod que `trainer.french-forge.com`, et
    # deux origines font diverger le cache, la file hors ligne et la session.
    # Firebase continue de SERVIR ces adresses — elles ne se suppriment pas —, le
    # front en rapatrie (`eitri/src/lib/rapatriement.ts`), et brokkr ne leur répond
    # pas. `test_forme_erreur.py` garde le refus ; `make anciennes-origines` dit
    # qui s'y cogne encore.

    # En dev, Vite peut prendre n'importe quel port libre (5173, 5177, …).
    # On autorise donc tout localhost par regex plutôt qu'un port figé.
    allowed_origin_regex: str = r"http://localhost:\d+"

    @property
    def regex_d_origines(self) -> str | None:
        """La regex d'origines EFFECTIVE — `None` en production (FRE-135).

        Autoriser `localhost` en production n'est pas une faille — toutes les
        routes exigent un Bearer — mais c'est une permission accordée à personne
        d'utile.

        ⚠️ FERMÉ PAR DÉFAUT : la question est « est-ce un poste de
        développement ? », pas « est-ce la production ? ». Un `SENTRY_ENVIRONMENT`
        perdu au déploiement (`--set-env-vars` au lieu de `--update-env-vars`)
        FERME au lieu de rouvrir localhost en silence ; ça casse au premier
        `npm run dev`, sans conséquence.

        ⚠️ Pas sur la présence du DSN Sentry : poser un DSN dans le `.env` local
        pour éprouver une alerte couperait le CORS du front local, sans lien
        trouvable.

        ⚠️ Un front local pointé sur le brokkr de PRODUCTION est donc refusé, et
        c'est voulu. Le harnais réel lance son propre brokkr (`SENTRY_ENVIRONMENT`
        absent, donc `local`) et garde son localhost.
        """
        return self.allowed_origin_regex if self.sentry_environment in ("local", "") else None


settings = Settings()
