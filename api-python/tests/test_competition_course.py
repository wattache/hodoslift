"""Deux PATCH de compétition EN MÊME TEMPS (FRE-162, 02/10).

`test_competitions.py` joue les deux coachs l'un APRÈS l'autre : le second
présente une version périmée et il est refusé. Ici ils écrivent ENSEMBLE, sur
deux connexions réelles — ce que la fixture `pg` (une seule connexion, une
transaction annulée) ne peut pas jouer.

⚠️ DES LIGNES RÉELLEMENT VALIDÉES, donc retirées à la main en sortie : le
conteneur est partagé par toute la session, et les autres tests le supposent
vide hors schéma.
"""

import copy
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

import app.socle.db as db_mod
from app.competitions import metier_competitions as metier
from app.main import app
from app.socle.auth import verify_token

_AUTH = {"Authorization": "Bearer x"}
_LIFTS = ["MUSCLE UP", "PULL UP", "DIPS", "SQUAT"]
_COACH = "course-coach"
_COMP = "course-c1"


def _essais(*charges):
    return [{"weight": c, "result": ""} for c in charges]


_DOC = {
    "name": "Course", "date": "2026-10-02", "movementNames": ["SQUAT"],
    "participants": [
        {"name": "Aubin", "movements": [{"name": "SQUAT", "attempts": _essais(210, 0, 0)}]},
        {"name": "Lionel", "movements": [{"name": "SQUAT", "attempts": _essais(207.5, 0, 0)}]},
    ],
}


@pytest.fixture
def base_reelle(pg_engine, monkeypatch):
    """Le vrai moteur : chaque requête ouvre SA connexion et valide pour de bon."""
    monkeypatch.setattr(db_mod, "get_engine", lambda: pg_engine)
    app.dependency_overrides[verify_token] = lambda: {"uid": _COACH, "email": "c@x.fr"}
    with pg_engine.begin() as conn:
        conn.execute(text("INSERT INTO users (uid, email) VALUES (:u, 'c@x.fr')"), {"u": _COACH})
        conn.execute(text("INSERT INTO coaches (uid) VALUES (:u)"), {"u": _COACH})
        conn.execute(text("INSERT INTO library_entries (category, name, competition) "
                          "SELECT 'exercices', x, true FROM unnest(CAST(:n AS text[])) AS x"), {"n": _LIFTS})
    try:
        yield pg_engine
    finally:
        with pg_engine.begin() as conn:
            conn.execute(text("DELETE FROM competitions WHERE legacy_id = :c"), {"c": _COMP})
            conn.execute(text("DELETE FROM library_entries WHERE name = ANY(CAST(:n AS text[]))"), {"n": _LIFTS})
            conn.execute(text("DELETE FROM coaches WHERE uid = :u"), {"u": _COACH})
            conn.execute(text("DELETE FROM users WHERE uid = :u"), {"u": _COACH})


def test_deux_PATCH_simultanes_un_seul_passe_et_rien_ne_s_efface(base_reelle, monkeypatch):
    """Aubin et Théo jugent dans la même seconde, depuis la même version lue.

    ⚠️ SANS VERROU, LES DEUX PASSENT LA COMPARAISON DE VERSION avant que l'un
    n'ait écrit : deux 200, et la barre du premier disparaît sous le
    remplacement en bloc du second — ce que la version promet d'empêcher.
    Mesuré le 02/10 sur le bac à sable : 40 paires, 40 pertes.

    Le rendez-vous est FABRIQUÉ : chaque requête attend l'autre juste après
    avoir passé la comparaison. Avec le verrou, la seconde n'y arrive jamais —
    elle attend la ligne de la compétition, puis lit la nouvelle version.

    MUTATION QUI ROUGIT : retirer `FOR NO KEY UPDATE` de `SELECT_COMP_SQL`."""
    client = TestClient(app)
    assert client.put(f"/competitions/{_COMP}", json=_DOC, headers=_AUTH).status_code == 200
    lue = next(c["version"] for c in client.get("/competitions", headers=_AUTH).json() if c["id"] == _COMP)

    rendez_vous = threading.Barrier(2)
    garde = metier.valider_essais_conserves

    def apres_la_comparaison(*a, **k):
        garde(*a, **k)
        try:
            rendez_vous.wait(timeout=2)
        except threading.BrokenBarrierError:
            pass  # l'autre attend le verrou : on écrit seul

    monkeypatch.setattr(metier, "valider_essais_conserves", apres_la_comparaison)

    def juger(qui: int, statuts: dict):
        participants = copy.deepcopy(_DOC["participants"])
        participants[qui]["movements"][0]["attempts"][0]["result"] = "rep"
        statuts[qui] = TestClient(app).patch(
            f"/competitions/{_COMP}", json={"version": lue, "participants": participants}, headers=_AUTH).status_code

    statuts: dict = {}
    fils = [threading.Thread(target=juger, args=(qui, statuts)) for qui in (0, 1)]
    for f in fils:
        f.start()
    for f in fils:
        f.join(timeout=20)

    assert sorted(statuts.values()) == [200, 409]
    gagnant = next(qui for qui, s in statuts.items() if s == 200)
    lus = next(c for c in client.get("/competitions", headers=_AUTH).json() if c["id"] == _COMP)["participants"]
    verdicts = {p["name"]: p["movements"][0]["attempts"][0]["result"] for p in lus}
    assert verdicts == {"Aubin": "rep" if gagnant == 0 else "", "Lionel": "rep" if gagnant == 1 else ""}
