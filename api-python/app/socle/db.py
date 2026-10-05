"""Connexion Postgres (Neon serverless) via SQLAlchemy 2.0 — SYNC.

brokkr est synchrone (routes `def`, firebase_admin sync) : engine SYNC + psycopg
(v3), pas d'async. Le pool est réglé pour Neon, qui met en veille les connexions
idle : `pool_pre_ping`, `pool_recycle`, et sept sockets au plus par instance.

⚠️ L'ENDPOINT DIRECT, PAS LE POOLER (FRE-135). PgBouncer refuse le paramètre
`options` à l'ouverture et ne propage pas les défauts de rôle : par lui, aucune
borne de session (`BORNES_DU_ROLE`) n'atteint le serveur.

L'engine est construit PARESSEUSEMENT (au 1er appel), pas à l'import : l'app
démarre, et les tests sans base tournent, sans `DATABASE_URL` ni Postgres.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import Engine, URL, create_engine
from sqlalchemy.orm import Session

from app.socle.config import settings


def _normalize_url(url: str) -> str:
    """Force le dialecte `+psycopg` (v3) sur une URL `postgresql://` ou `postgres://`.

    SQLAlchemy mappe ces préfixes sur psycopg2 par défaut, qui n'est pas installé.
    """
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def _resolve_url() -> str | URL:
    """L'URL de connexion : `DATABASE_URL` en local, les parties `DB_*` en production.

    `URL.create` encode le mot de passe (caractères spéciaux) — pas de
    concaténation de chaîne. L'hôte est l'endpoint DIRECT (cf. l'en-tête du module).
    """
    if settings.database_url:
        return _normalize_url(settings.database_url)
    return URL.create(
        "postgresql+psycopg",
        username=settings.db_user,
        password=settings.db_password,
        host=settings.db_host,
        port=settings.db_port,
        database=settings.db_name,
        query={"sslmode": "require"},
    )


#: ⚠️ NE PAS PASSER CECI EN `connect_args={"options": …}`. Le pooler de Neon
#: (PgBouncer) refuse le paramètre `options` à l'ouverture :
#:
#:     unsupported startup parameter in options: statement_timeout
#:
#: Plus aucune connexion ne s'établit, pendant que `/health` reste vert puisqu'il
#: ne touche pas la base. La constante reste ici pour que personne ne la refasse ;
#: `test_db_plomberie` grave le refus.
#:
#: ⚠️ Aucun harnais ne le voit : pytest (testcontainers), le bac à sable et le
#: `.env` local visent tous un Postgres DIRECT. Seul le chemin de la production
#: dit ce que la production reçoit — d'où `/health/db` et `make verifier`.
#:
#: ⚠️ Par le pooler, rien d'autre ne marche non plus. Un `SET` à la connexion ne
#: suit pas : en mode TRANSACTION, la connexion serveur change d'un appel à
#: l'autre. Et `ALTER ROLE … SET` n'arrive pas : PgBouncer ne propage pas les
#: défauts de rôle jusqu'au client.
#:
#:     DIRECT   → 15s / 5s / Europe/Paris
#:     POOLER   →  0  /  0 / GMT
#:
#: D'où l'endpoint DIRECT (`nidavellir/brokkr.tf`), et les bornes posées sur le
#: rôle (`BORNES_DU_ROLE`).
#:
#: ⚠️ L'invariant lit `current_setting`, PAS le catalogue : `pg_roles.rolconfig`
#: porte les bornes même quand la SESSION ne les reçoit pas, et sortirait vert
#: pour la mauvaise raison.
_OPTIONS_QUE_LE_POOLER_REFUSE = (
    "-c statement_timeout=15000"
    " -c lock_timeout=5000"
    " -c timezone=Europe/Paris"
)

#: Ce que les bornes VALENT, et pourquoi — la migration les pose, ceci les
#: documente et l'invariant les vérifie (FRE-135).
#:
#: Les défauts de Postgres ne conviennent pas ici : `statement_timeout` et
#: `lock_timeout` à ZÉRO (« attendre indéfiniment »), fuseau GMT.
#:
#: · `statement_timeout=15s` — sans lui, une requête partie en vrille tient sa
#:   connexion POUR TOUJOURS. Sept requêtes bloquées (le pool entier) figent
#:   l'instance, et Cloud Run ne monte pas en charge pour autant : son seuil de
#:   concurrence n'est pas atteint. Aucune requête légitime n'approche la borne.
#:
#: · `lock_timeout=5s` — un `ALTER TABLE` lancé à la main pendant qu'une requête
#:   lit prend la file d'attente entière avec lui. L'échec devient lisible au
#:   lieu de se propager.
#:
#: · `TimeZone=Europe/Paris` — un CORRECTIF, pas un confort. `current_date` borne
#:   le suivi et les records (« ce qui est fait à ce jour ») : en GMT, une séance
#:   faite entre minuit et 2 h à Paris n'entre ni dans l'un ni dans les autres.
#:
#: ⚠️ Les MIGRATIONS passent par le MÊME engine (`scripts/migrer.py`,
#: `scripts/_cible.py`) : une reprise de données dépasse quinze secondes sans
#: rien avoir d'anormal. `migrer.py` remet donc les deux délais à zéro par un
#: `SET`, qui l'emporte sur le défaut du rôle le temps de sa session.
#:
#: ⚠️ Les clés sont celles que `SHOW` rend, `TimeZone` avec sa casse : c'est ce
#: que l'invariant et la migration comparent.
BORNES_DU_ROLE: dict[str, str] = {
    "statement_timeout": "15s",
    "lock_timeout": "5s",
    "TimeZone": "Europe/Paris",
}


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """L'engine, singleton, construit au 1er appel.

    `pool_pre_ping` : Neon met en veille les connexions idle, et sans ping la 1re
    requête sur une connexion réveillée échoue. `pool_recycle=300` : renouveler
    avant que Neon (ou un proxy) ne coupe en silence.

    ⚠️ `pool_timeout=5`, pas les 30 secondes par défaut (FRE-135) : quand les sept
    connexions sont prises, la suivante doit échouer VITE. Au-delà de cinq
    secondes ce n'est plus de la contention, c'est une panne, et elle doit se
    voir au lieu d'empiler des requêtes en attente.
    """
    return create_engine(
        _resolve_url(),
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=5,
        max_overflow=2,
        pool_timeout=5,
    )


@contextmanager
def get_session() -> Iterator[Session]:
    """Session transactionnelle : commit si le bloc réussit, rollback sinon.

    Fermeture systématique. Usage : `with get_session() as s: ...`.
    """
    session = Session(get_engine())
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
