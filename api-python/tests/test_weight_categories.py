"""Référentiel des catégories de poids — GET /weight-categories.

Table fixe (éditée à la main), juste lue par cet endpoint pour alimenter le
sélecteur front (filtré par genre). Ordre logique via la colonne `position` — pas
alphabétique (sinon -101 avant -66).

⚠️ SUR LE VRAI POSTGRES, plus sur un stub SQLite (FRE-80). Le stub redéclarait la
table à sa façon, donc il ne pouvait par construction jamais contredire le schéma
de production — c'est le mécanisme même qui a laissé `docs/postgres-schema.sql`
diverger sans que rien ne rougisse. La fixture `pg` monte un Postgres 16, LA
version de Neon, dont le schéma est appliqué DEPUIS ce fichier : sa dérive
devient un test rouge au lieu d'un angle mort.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import semer_un_membre


@pytest.fixture
def sql(pg):
    """⚠️ RIEN À SEMER, ET C'EST LE POINT. Le stub SQLite recopiait les douze
    catégories dans le fichier de test ; le vrai schéma les PORTE (elles sont un
    référentiel de la fédération, pas de la donnée d'application, et
    `docs/postgres-schema.sql` les insère). Les redéclarer ici, c'était se donner
    la liberté de tester un référentiel qui n'est pas celui de la production —
    exactement le mensonge que FRE-80 traque."""
    return pg


_AUTH = {"Authorization": "Bearer x"}


def test_contenu_et_ordre_logique(auth_as, sql):
    semer_un_membre(sql, "un-membre")
    r = auth_as(uid="un-membre").get("/weight-categories", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {
        "M": ["-66", "-73", "-80", "-87", "-94", "-101", "+101"],  # -XX croissants puis +XX
        "F": ["-52", "-57", "-63", "-70", "+70"],
    }


def test_401_sans_token_valide(sql):
    # pas d'override auth_as → verify_token s'exécute pour de vrai ; token bidon → 401
    r = TestClient(app).get("/weight-categories", headers={"Authorization": "Bearer invalide"})
    assert r.status_code == 401


def test_refusé_à_un_compte_SANS_LIEN_avec_le_club(auth_as, sql):
    """Douze codes n'apprennent rien à personne — mais laisser UNE lecture ouverte
    à tout compte Google pendant qu'on ferme les deux autres, c'est se garantir de
    ne plus savoir laquelle est ouverte et pourquoi (22/08)."""
    r = auth_as(uid="inconnu-du-club").get("/weight-categories", headers=_AUTH)
    assert r.status_code == 403
    assert r.json()["code"] == "reserve_aux_membres"
