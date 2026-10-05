"""Plomberie Postgres : route /health/db + helpers app/socle/db.py.

Le mock Firestore de conftest est hermétique mais ne couvre PAS Postgres. Ici on
reste tout aussi hermétique en branchant un engine SQLite in-memory (SELECT 1 y
tourne réellement) via `get_engine`, sans jamais toucher au réseau.

⚠️ IL Y AVAIT ICI UN TEST « VRAIE NEON », retiré (FRE-142) : skippé sans
`DATABASE_URL`, il était le SEUL de la suite à sortir du conteneur — et depuis
que la route rend `bornes`, il aurait été rouge sur un poste configuré. Ce qu'il
vérifiait vit ailleurs : `make verifier` lit `/health/db` sur la production.

⚠️ SQLITE EST LÉGITIME POUR LES HELPERS DE `app/socle/db.py`, contrairement à partout
ailleurs (FRE-80) : `get_session` ne modélise aucune table, et un engine jetable
est le seul moyen de fabriquer une panne à volonté.

⚠️ MAIS PLUS POUR `/health/db` (FRE-154). La route rend désormais les BORNES DE
SESSION telles que le processus les reçoit (`current_setting`), parce que c'est
la seule lecture qui dise ce que la PRODUCTION reçoit — un invariant joué depuis
un poste lit la connexion qu'on lui donne, pas celle de Cloud Run. SQLite n'a
pas de `current_setting` ; ces tests passent donc par le vrai conteneur, dont le
rôle porte les bornes (cf. conftest), et vérifient qu'elles ressortent.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

import app.socle.db as db_mod
import app.socle.routes_health as health_mod
from app.socle.db import BORNES_DU_ROLE, get_engine
from app.main import app


def _sqlite_engine():
    return create_engine("sqlite://")


# --------------------------------------------------------------------------- #
# Route /health/db
# --------------------------------------------------------------------------- #


def test_health_db_ok_et_rend_les_bornes_que_la_session_recoit(pg):
    """⚠️ `bornes` EST CE QUE `make verifier` COMPARE APRÈS CHAQUE DÉPLOIEMENT.
    C'est le couple qui garde le choix d'endpoint de Cloud Run : le 08/09 la
    production a tourné sans `statement_timeout` en croyant en avoir un, parce
    que le pooler ne propage pas les défauts de rôle et que rien ne lisait ce
    que brokkr recevait vraiment."""
    client = TestClient(app)
    response = client.get("/health/db")
    assert response.status_code == 200
    corps = response.json()
    assert corps["ok"] is True
    assert corps["bornes"] == BORNES_DU_ROLE


def test_health_db_503_si_connexion_echoue(monkeypatch):
    def _boom():
        raise RuntimeError("neon injoignable")

    monkeypatch.setattr(health_mod, "get_session", _boom)
    client = TestClient(app)
    response = client.get("/health/db")
    assert response.status_code == 503


def test_health_db_est_public(pg):
    """Pas d'auth : Cloud Run doit pouvoir sonder sans token (comme /health)."""
    client = TestClient(app)  # aucun override verify_token
    assert client.get("/health/db").status_code == 200


# --------------------------------------------------------------------------- #
# app/socle/db.py
# --------------------------------------------------------------------------- #


def test_get_engine_construit_avec_driver_psycopg(monkeypatch):
    """get_engine mappe l'URL Neon sur le dialecte psycopg (v3). create_engine ne
    se connecte pas : purement hermétique.

    `get_engine` est le nom IMPORTÉ, pas `db_mod.get_engine` : sur le module, la
    garde de `conftest.py` a pris la place de la vraie fonction (elle refuse la
    base de `.env`). Le nom lié à l'import est resté la vraie."""
    monkeypatch.setattr(db_mod.settings, "database_url", "postgresql://u:p@localhost:5432/db")
    get_engine.cache_clear()
    try:
        engine = get_engine()
        assert "psycopg" in engine.dialect.driver
        assert engine.pool._pre_ping is True
    finally:
        get_engine.cache_clear()  # ne pas polluer le cache pour les autres tests


def test_resolve_url_priorise_database_url(monkeypatch):
    monkeypatch.setattr(db_mod.settings, "database_url", "postgresql://u:p@h/db")
    assert db_mod._resolve_url() == "postgresql+psycopg://u:p@h/db"


def test_resolve_url_assemble_depuis_les_parties(monkeypatch):
    """En prod : URL construite depuis DB_* (password encodé sûrement)."""
    monkeypatch.setattr(db_mod.settings, "database_url", "")
    monkeypatch.setattr(db_mod.settings, "db_host", "ep-x-pooler.eu-central-1.aws.neon.tech")
    monkeypatch.setattr(db_mod.settings, "db_user", "brokkr")
    monkeypatch.setattr(db_mod.settings, "db_password", "p@ss/w:rd")  # caractères spéciaux
    monkeypatch.setattr(db_mod.settings, "db_name", "french_forge_trainer")
    url = db_mod._resolve_url()
    rendered = url.render_as_string(hide_password=False)
    assert rendered.startswith("postgresql+psycopg://brokkr:")
    assert "ep-x-pooler.eu-central-1.aws.neon.tech" in rendered
    assert "/french_forge_trainer" in rendered
    assert "sslmode=require" in rendered
    assert "p%40ss" in rendered  # @ encodé → pas de concaténation fragile


def test_normalize_url_force_le_driver():
    assert db_mod._normalize_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert db_mod._normalize_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    # déjà explicite ou autre dialecte → inchangé
    assert db_mod._normalize_url("postgresql+psycopg://x") == "postgresql+psycopg://x"
    assert db_mod._normalize_url("sqlite://") == "sqlite://"


def test_get_session_commit_et_ferme(monkeypatch):
    monkeypatch.setattr(db_mod, "get_engine", _sqlite_engine)
    with db_mod.get_session() as session:
        assert session.execute(text("SELECT 1")).scalar() == 1


def test_get_session_rollback_sur_erreur(monkeypatch):
    monkeypatch.setattr(db_mod, "get_engine", _sqlite_engine)
    with pytest.raises(ValueError):
        with db_mod.get_session() as session:
            session.execute(text("SELECT 1"))
            raise ValueError("boom")
