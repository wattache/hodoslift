"""LE PARCOURS D'UN COACH, de bout en bout (FRE-12).

Pourquoi ce fichier existe. Le 2026-08-15, William a ouvert l'app sur ses vraies
données et a programmé comme il le fait d'habitude : créer une semaine, créer une
séance, la remonter, la renommer, y ajouter un exercice, régler la trame du bloc,
générer. En vingt minutes, il a trouvé CINQ défauts que six cents tests n'avaient
pas vus.

Aucun n'était exotique. Tous venaient du même angle mort : mes tests envoyaient
des corps que J'AVAIS écrits, dans la forme que j'avais en tête, alors que
l'application, elle, renvoie ce qu'elle vient de LIRE. Les tests unitaires
vérifiaient chaque route ; personne ne vérifiait qu'elles s'enchaînent.

Ce fichier teste donc la SUITE, pas les briques :

    créer un macro → renommer → ajouter une séance → la réordonner
      → ajouter une ligne VIDE → la nommer → la garnir
      → poser la trame du bloc → générer une semaine depuis cette trame
      → relire l'arbre et vérifier que tout s'y retrouve

Chaque étape repart de ce que le serveur a répondu à la précédente — jamais d'un
identifiant fabriqué pour les besoins du test. C'est ce chaînage qui attrape ce
qu'une route isolée ne peut pas montrer.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app

_AUTH = {"Authorization": "Bearer x"}


@pytest.fixture
def coach(pg):
    """Un programme VIDE : le parcours construit tout lui-même, comme un coach qui
    ouvre un nouvel athlète."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('c1','c@x.fr'), ('a1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('c1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name, last_name, user_uid) VALUES "
        "('11111111-1111-1111-1111-111111111111','c1','Léa','Martin','a1')"))
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
                    "('p1','c1','11111111-1111-1111-1111-111111111111')"))
    app.dependency_overrides[verify_token] = lambda: {"uid": "c1"}
    return TestClient(app)


def _arbre(client: TestClient) -> dict:
    r = client.get("/programs/p1/training", headers=_AUTH)
    assert r.status_code == 200
    return r.json()


def _ok(reponse, attendu=200):
    """Assertion parlante : un 422 nu ne dit pas ce qui a été refusé."""
    assert reponse.status_code == attendu, f"{reponse.status_code} — {reponse.text[:300]}"
    return reponse.json()


def test_parcours_complet(coach):
    # ── 1. Un macro tout neuf, avec son bloc et sa première semaine ─────────
    ids = _ok(coach.post("/programs/p1/macros", headers=_AUTH, json={
        "name": "Prépa automne",
        "block": {"name": "Accumulation", "week": {"name": "S1"}},
    }), 201)["ids"]
    macro, bloc, semaine = ids["macro"], ids["block"], ids["week"]

    # ── 2. Renommer, comme on le fait juste après avoir créé ────────────────
    _ok(coach.patch(f"/programs/p1/macros/{macro}", json={"name": "Prépa hiver"}, headers=_AUTH))
    _ok(coach.patch(f"/programs/p1/blocks/{bloc}", json={"name": "Volume"}, headers=_AUTH))

    # ── 3. Deux séances, puis on remonte la seconde ─────────────────────────
    s1 = _ok(coach.post(f"/programs/p1/weeks/{semaine}/sessions",
                        json={"name": "Lundi"}, headers=_AUTH), 201)["id"]
    s2 = _ok(coach.post(f"/programs/p1/weeks/{semaine}/sessions",
                        json={"name": "Mercredi"}, headers=_AUTH), 201)["id"]
    _ok(coach.put(f"/programs/p1/weeks/{semaine}/sessions/order",
                  json={"ids": [s2, s1]}, headers=_AUTH))

    # ── 4. Une ligne VIDE, qu'on nomme ensuite — le geste de l'éditeur ──────
    ligne = _ok(coach.post(f"/programs/p1/sessions/{s2}/exercises",
                           json={"name": ""}, headers=_AUTH), 201)["id"]
    _ok(coach.patch(f"/programs/p1/exercises/{ligne}", headers=_AUTH, json={
        "name": "SQUAT", "variant": ["COMP", "PAUSE"], "tier": 1,
        "sets": "5", "reps": "8/10", "weight": "PDC", "weightLocked": True,
    }))

    # ── 5. La trame du bloc, et la re-datation qu'elle entraîne ─────────────
    _ok(coach.put(f"/programs/p1/blocks/{bloc}/base", headers=_AUTH, json={
        "base": {
            "daySplit": [{"day": "J1", "tiers": {"SQUAT": 1}}],
            "selectedPrincipaux": ["SQUAT"],
            "granularity": {"SQUAT": "2,5"},
            "s1StartDate": "2026-09-07", "s1EndDate": "2026-09-13",
            "principles": [{"name": "SQUAT", "tier": 1, "variant": ["COMP"],
                            "sets": "5", "reps": "5", "weightLocked": "", "repsUnit": ""}],
            "accessories": [{"name": "CURL", "day": "J1", "sets": "3", "tier": ""}],
        },
        "weekDates": [{"weekId": semaine, "startDate": "2026-09-07", "endDate": "2026-09-13"}],
    }))

    # ── 6. Générer S2 depuis la trame — avec les « vides » du front ─────────
    s2_ids = _ok(coach.post(f"/programs/p1/blocks/{bloc}/weeks", headers=_AUTH, json={
        "name": "S2", "hidden": False,
        "athlete": {"firstName": "Léa", "lastName": "Martin", "height": 168, "weight": 62},
        "sessions": [{
            "name": "Lundi", "sessionDate": "", "formOfTheDay": "",
            "exercises": [
                {"name": "SQUAT", "variant": ["COMP"], "tier": 1, "sets": "5", "reps": "5",
                 "weightLocked": "", "repsUnit": "", "incrementUnit": "", "kind": ""},
                {"name": "CURL", "sets": "3", "reps": "12"},
                {"name": ""},                       # ligne vide : écartée au chargement
            ],
        }],
    }), 201)["ids"]

    # ── 7. Et on relit TOUT, comme le fait le front au rechargement ─────────
    arbre = _arbre(coach)
    assert [m["name"] for m in arbre["macros"]] == ["Prépa hiver"]
    blocs = arbre["macros"][0]["blocks"]
    assert [b["name"] for b in blocs] == ["Volume"]

    semaines = blocs[0]["weeks"]
    assert [w["name"] for w in semaines] == ["S1", "S2"]
    assert semaines[0]["startDate"] == "2026-09-07"      # la re-datation a bien pris

    # L'ordre des séances est celui qu'on a posé, pas celui de la création.
    assert [s["name"] for s in semaines[0]["sessions"]] == ["Mercredi", "Lundi"]

    exo = semaines[0]["sessions"][0]["exercises"][0]
    assert exo["name"] == "SQUAT"
    assert exo["variant"] == ["COMP", "PAUSE"]
    assert exo["reps"] == "8/10" and exo["weight"] == "PDC"   # les formes libres survivent
    assert exo["weightLocked"] is True

    # La semaine générée : deux lignes, la vide écartée, et les « » du front
    # convertis en absence plutôt qu'en valeur fautive.
    generee = semaines[1]["sessions"][0]
    assert [e["name"] for e in generee["exercises"]] == ["SQUAT", "CURL"]
    # ÉPINGLÉ sur la forme réellement servie, et pas « l'un ou l'autre » :
    # c'est exactement cette tolérance qui a laissé passer les bugs du 15/08.
    # `_NON_TEXTE` ne contient ni `session_date` ni `reps_unit`, donc la
    # lecture rend `""` — le contrat front les type `string`, pas `string|null`.
    assert generee["sessionDate"] is None
    assert generee["exercises"][0]["repsUnit"] is None

    # La trame se relit avec le bloc, virgule décimale comprise.
    base = blocs[0]["base"]
    assert base["granularity"] == {"SQUAT": "2,5"}
    assert [p["name"] for p in base["principles"]] == ["SQUAT"]
    assert [a["day"] for a in base["accessories"]] == ["J1"]

    assert s2_ids["week"] == semaines[1]["id"]


def test_parcours_de_suppression(coach):
    """L'autre moitié du métier : défaire. Chaque suppression tient ses
    invariants — pas de trou dans les positions, pas de groupe à un membre, et le
    dernier bloc d'un macro qui résiste."""
    ids = _ok(coach.post("/programs/p1/macros", headers=_AUTH,
                         json={"block": {"week": {"name": "S1"}}}), 201)["ids"]
    macro, bloc, semaine = ids["macro"], ids["block"], ids["week"]
    seance = _ok(coach.post(f"/programs/p1/weeks/{semaine}/sessions",
                            json={"name": "Lundi"}, headers=_AUTH), 201)["id"]

    lignes = [_ok(coach.post(f"/programs/p1/sessions/{seance}/exercises",
                             json={"name": nom}, headers=_AUTH), 201)["id"]
              for nom in ("SQUAT", "CURL", "TRICEPS")]
    # Les deux dernières en bi-set.
    for ligne in lignes[1:]:
        _ok(coach.patch(f"/programs/p1/exercises/{ligne}",
                        json={"groupId": "biset-1"}, headers=_AUTH))

    # Retirer un membre dissout le groupe : à un seul, ce n'en est plus un.
    assert _ok(coach.delete(f"/programs/p1/exercises/{lignes[1]}",
                            headers=_AUTH))["groupesNettoyes"] == 1

    exos = _arbre(coach)["macros"][0]["blocks"][0]["weeks"][0]["sessions"][0]["exercises"]
    assert [e["name"] for e in exos] == ["SQUAT", "TRICEPS"]
    assert exos[1]["groupId"] is None    # une absence, et plus `''` (FRE-137)

    # Le dernier bloc d'un macro ne se supprime pas…
    assert coach.delete(f"/programs/p1/blocks/{bloc}", headers=_AUTH).status_code == 409
    # …mais le macro entier, si, et il emporte tout.
    _ok(coach.delete(f"/programs/p1/macros/{macro}", headers=_AUTH))
    assert _arbre(coach)["macros"] == []


def test_parcours_de_l_athlete(coach):
    """Ce que l'ATHLÈTE fait de son côté, et qui doit rester possible : saisir son
    réalisé et sa forme du jour. La parité avec l'existant se vérifie ici, sinon
    on la resserre par mégarde en portant les routes."""
    ids = _ok(coach.post("/programs/p1/macros", headers=_AUTH,
                         json={"block": {"week": {"name": "S1"}}}), 201)["ids"]
    seance = _ok(coach.post(f"/programs/p1/weeks/{ids['week']}/sessions",
                            json={"name": "Lundi"}, headers=_AUTH), 201)["id"]
    ligne = _ok(coach.post(f"/programs/p1/sessions/{seance}/exercises",
                           json={"name": "SQUAT", "sets": "5", "reps": "5"}, headers=_AUTH),
                201)["id"]

    app.dependency_overrides[verify_token] = lambda: {"uid": "a1"}
    athlete = TestClient(app)

    _ok(athlete.patch(f"/programs/p1/sessions/{seance}",
                      json={"formOfTheDay": 4}, headers=_AUTH))
    # ⚠️ LE `feltRPE` ENVOYÉ ICI EST FAUX, ET C'EST DEVENU LE SUJET (FRE-136).
    # « Sub5 » avec des séries notées 7, 8 et 9 est une contradiction : le
    # scalaire est la MOYENNE des séries, et cette fixture affirmait le
    # contraire de son propre détail. Depuis que le serveur le DÉRIVE, elle ne
    # peut plus mentir — il écrit 8, et c'est ce que la lecture rend.
    _ok(athlete.patch(f"/programs/p1/exercises/{ligne}", headers=_AUTH, json={
        "repsDone": "4", "weightDone": "102.5", "feltRPE": "Sub5",
        "feltRPEBySet": ["7", "8", "9"]}))
    # …mais il ne programme pas : ajouter une ligne reste au coach.
    assert athlete.post(f"/programs/p1/sessions/{seance}/exercises",
                        json={"name": "X"}, headers=_AUTH).status_code == 403

    seance_lue = _arbre(athlete)["macros"][0]["blocks"][0]["weeks"][0]["sessions"][0]
    assert seance_lue["formOfTheDay"] == 4
    exo = seance_lue["exercises"][0]
    assert (exo["repsDone"], exo["weightDone"], exo["feltRPE"]) == ("4", "102.5", "8")
    assert exo["feltRPEBySet"] == ["7", "8", "9"]
