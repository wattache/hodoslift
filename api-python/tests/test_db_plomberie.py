"""LES BORNES DE SESSION, ET LE CHEMIN QUI LES A REFUSÉES — FRE-135.

⚠️ CE FICHIER A ATTESTÉ D'UNE PANNE. Sa première version prouvait que Postgres
ACCEPTE `connect_args={"options": "-c statement_timeout=…"}` et les applique. Les
trois specs étaient vertes, la production est tombée le 08/09 : le POOLER de Neon
(PgBouncer) refuse ce paramètre à l'ouverture, plus aucune connexion ne
s'établissait, et le front affichait « Serveur injoignable ».

⚠️ ET ELLES NE POUVAIENT PAS LE VOIR. pytest monte un Postgres DIRECT
(testcontainers), le bac à sable est DIRECT, le `.env` local vise l'hôte DIRECT.
La production est le seul chemin qui passe par le pooler — celui qu'aucun harnais
n'emprunte. La spec prouvait une vérité hors sujet.

Ce que ce fichier garde désormais :

  1. que le code ne repasse PAS par `connect_args` — la seule chose vérifiable
     ici, et la seule qui aurait empêché la panne ;
  2. que les bornes valent bien ce que la migration pose, sans recopie ;
  3. le CORS, plus bas, qui n'a rien à voir avec le pooler.

⚠️ CE QUI RESTE INVÉRIFIABLE SANS LA PRODUCTION : que le pooler les serve. C'est
l'invariant `bornes_de_session` qui le fait, sur la vraie base, dans
`make invariants`. Une spec locale ne peut pas remplacer ça — c'est précisément
l'erreur qu'on vient de payer.
"""

import inspect

import app.socle.db
from app.socle.db import BORNES_DU_ROLE, get_engine


def test_le_moteur_ne_passe_AUCUNE_option_de_connexion():
    """⚠️ LA SPEC QUI AURAIT ÉVITÉ LA PANNE, et elle est bête à écrire : elle
    regarde ce que le code fait, pas ce que Postgres accepte.

    `connect_args={"options": …}` est refusé par le pooler à l'OUVERTURE — donc
    l'échec n'est pas dégradé, il est total, et il ne se voit sur aucun Postgres
    direct. Aucun harnais du projet ne peut le reproduire ; la seule garde
    possible est de refuser le mécanisme."""
    source = inspect.getsource(get_engine)
    assert "connect_args" not in source, (
        "le pooler de Neon refuse le paramètre `options` à l'ouverture — "
        "les bornes se posent sur le RÔLE (ALTER ROLE … SET), voir app/socle/db.py")


def test_les_bornes_disent_ce_que_la_migration_pose():
    """Les trois réglages, et leurs noms TELS QUE POSTGRES LES STOCKE. La première
    rédaction de l'invariant cherchait `timezone=…` : Postgres écrit `TimeZone`,
    donc elle ne trouvait jamais rien et l'invariant serait resté rouge sans
    qu'on comprenne pourquoi."""
    assert BORNES_DU_ROLE == {
        "statement_timeout": "15s",
        "lock_timeout": "5s",
        "TimeZone": "Europe/Paris",
    }


def test_la_constante_refusee_reste_documentee():
    """⚠️ ELLE EST GARDÉE EXPRÈS, et cette spec dit pourquoi. La chaîne qui a fait
    tomber la production vit toujours dans `app/socle/db.py`, sous un nom qui la
    condamne — sans quoi le prochain qui lira « il faut poser statement_timeout »
    réécrira exactement le même `connect_args`."""
    assert "statement_timeout" in app.socle.db._OPTIONS_QUE_LE_POOLER_REFUSE
    assert "POOLER" in inspect.getsource(app.socle.db)


# --------------------------------------------------------------------------- #
# LE CORS NE PARLE PLUS DE LOCALHOST EN PRODUCTION (FRE-135)
# --------------------------------------------------------------------------- #

from app.socle.config import Settings  # noqa: E402


def test_la_production_n_annonce_PAS_localhost():
    """⚠️ CE N'EST PAS UNE FAILLE, ET ÇA VAUT QUAND MÊME D'ÊTRE FERMÉ. Toutes les
    routes exigent un Bearer, et CORS n'attache ici ni cookie ni credential : la
    permission ne donnait rien à personne. Elle élargissait la surface pour rien,
    et surtout la même configuration servait le poste de développement et la
    production — impossible de lire, depuis le service, ce qu'il autorise."""
    assert Settings(sentry_environment="production").regex_d_origines is None


def test_le_DEV_garde_son_localhost_a_port_libre():
    """⚠️ L'AUTRE MOITIÉ, ET ELLE COMPTE AUTANT. Vite prend n'importe quel port
    libre (5173, 5177, 5200 pour le harnais réel…) : figer un port ou tout
    fermer casserait le développement, et on l'apprendrait au premier `npm run
    dev`, pas ici."""
    for environnement in ("local", ""):
        regex = Settings(sentry_environment=environnement).regex_d_origines
        assert regex == r"http://localhost:\d+", environnement


def test_un_drapeau_INCONNU_ferme_plutot_que_d_ouvrir():
    """⚠️ LA SPEC QUI PORTE LE RETOURNEMENT DE LA CONDITION, et elle disait
    l'inverse il y a une heure — j'avais écrit « staging garde localhost » en
    décrivant le code au lieu de décider du comportement voulu.

    La première rédaction demandait « est-ce la production ? » et ouvrait dans
    tous les autres cas. Un `SENTRY_ENVIRONMENT` perdu au déploiement — le piège
    du `--set-env-vars` que le Makefile documente déjà — aurait donc rouvert
    localhost en production, en silence : très exactement le défaut qu'on ferme.

    Retournée, la question est « est-ce un poste de développement ? ». Tout le
    reste ferme, y compris ce qu'on n'a pas prévu."""
    for environnement in ("staging", "PRODUCTION", "prod", "cloud-run", "inconnu"):
        assert Settings(sentry_environment=environnement).regex_d_origines is None, environnement


def test_le_port_de_la_base_entre_dans_l_url(monkeypatch):
    """Le point PUBLIC de la base Scaleway ne sert pas sur 5432 : sans le port,
    le job nocturne et le poste visent une porte fermée."""
    from app.socle import db
    from app.socle.config import settings
    monkeypatch.setattr(settings, "database_url", "")
    for champ, valeur in (("db_host", "51.15.0.1"), ("db_user", "brokkr_app"), ("db_password", "x"),
                          ("db_name", "ff"), ("db_port", 15432)):
        monkeypatch.setattr(settings, champ, valeur)
    # MUTATION QUI ROUGIT : retirer `port=settings.db_port` de `_resolve_url`.
    assert db._resolve_url().port == 15432
    monkeypatch.setattr(settings, "db_port", None)
    assert db._resolve_url().port is None  # absent = le 5432 du pilote
