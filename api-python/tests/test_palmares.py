"""Le palmarès : les meilleurs singles, les compétitions, et le 1RM de la table."""
from sqlalchemy import text

from tests.conftest import A1

_AUTH = {"Authorization": "Bearer x"}


def _essais(*essais):
    return [{"weight": w, "result": r} for w, r in essais]


def _une_competition(client, sql, nom, date, mouvements, bodyweight=78):
    """Une compétition où a1 concourt, liée à SA fiche — comme l'inscription la lie."""
    r = client.put(f"/competitions/{nom}", headers=_AUTH, json={
        "name": nom, "date": date, "movementNames": list(mouvements),
        "participants": [
            {"name": "A Un", "bodyweight": bodyweight, "gender": "M",
             "movements": [{"name": m, "attempts": _essais(*e)} for m, e in mouvements.items()]},
            {"name": "Invité", "bodyweight": 80, "gender": "M",
             "movements": [{"name": m, "attempts": _essais((999, "rep"))} for m in mouvements]},
        ]})
    assert r.status_code == 200, r.text[:300]
    sql.execute(text("UPDATE competition_participants SET athlete_id = CAST(:a AS uuid) WHERE name = 'A Un'"), {"a": A1})


def test_le_meilleur_single_vient_d_ou_il_vient_et_le_1rm_garde_le_plus_lourd(auth_as, sql):
    """MUTATION QUI ROUGIT : prendre la saisie du coach telle quelle — le squat
    resterait à 200 alors qu'il a passé 215 en compétition."""
    sql.execute(text("UPDATE athletes SET current_one_rm = '{\"squat\": 200, \"pullUp\": 120}' WHERE id = CAST(:a AS uuid)"), {"a": A1})
    sql.execute(text("INSERT INTO athlete_prs (athlete_id, movement, reps, weight_kg) VALUES "
                     "(CAST(:a AS uuid), 'SQUAT', 1, 210), (CAST(:a AS uuid), 'SQUAT', 3, 230)"), {"a": A1})
    coach = auth_as(uid="coach-1")
    _une_competition(coach, sql, "open-2026", "2026-05-10",
                     {"SQUAT": [(205, "rep"), (215, "rep"), (225, "norep")], "PULL UP": [(100, "rep")]})

    r = coach.get("/athletes/a1/palmares", headers=_AUTH)
    assert r.status_code == 200, r.text[:300]
    doc = r.json()
    par_mouvement = {s["mouvement"]: (s["charge"], s["source"], s["contexte"]) for s in doc["records"]}
    # Le no rep à 225 ne compte pas ; le PR manuel à 3 reps n'est pas un single ;
    # l'invité à 999 n'est pas lui.
    assert par_mouvement == {"SQUAT": (215, "competition", "open-2026"), "PULL UP": (100, "competition", "open-2026")}
    assert doc["unRm"] == {"squat": 215, "pullUp": 120}


def test_ses_competitions_avec_total_ris_et_place(auth_as, sql):
    """La place se lit au RIS, parmi ceux qui en ont un : l'invité, plus fort, passe devant."""
    coach = auth_as(uid="coach-1")
    _une_competition(coach, sql, "open-2026", "2026-05-10",
                     {"MUSCLE UP": [(30, "rep")], "PULL UP": [(90, "rep")], "DIPS": [(120, "rep")], "SQUAT": [(180, "rep")]})
    _une_competition(coach, sql, "euros-2026", "2026-10-02",
                     {"SQUAT": [(190, "rep")]})

    comps = coach.get("/athletes/a1/palmares", headers=_AUTH).json()["competitions"]
    assert [(c["id"], c["total"]) for c in comps] == [("euros-2026", 190), ("open-2026", 420)]
    open_ = comps[1]
    assert open_["ris"] is not None and (open_["place"], open_["classes"]) == (2, 2)


def test_un_athlete_sans_rien_a_un_palmares_vide_pas_une_erreur(auth_as, sql):
    r = auth_as(uid="coach-1").get("/athletes/a1/palmares", headers=_AUTH)
    assert r.status_code == 200 and r.json() == {"genre": None, "categorie": None, "total": None, "ris": None,
                                                 "records": [], "competitions": [], "unRm": {}}


def test_un_athlete_d_un_autre_coach_n_ouvre_pas_son_palmares(auth_as, sql):
    sql.execute(text("INSERT INTO users (uid, email) VALUES ('coach-2', 'b@x.fr')"))
    sql.execute(text("INSERT INTO coaches (uid) VALUES ('coach-2')"))
    assert auth_as(uid="coach-2").get("/athletes/a1/palmares", headers=_AUTH).status_code in (403, 404)


def test_le_total_des_quatre_places_et_son_ris_au_poids_actuel(auth_as, sql):
    """Le pull up et le chin up se disputent une place ; sans dips, pas de total.
    MUTATION QUI ROUGIT : additionner le pull up ET le chin up."""
    sql.execute(text("UPDATE athletes SET gender = 'M', weight_kg = 72 WHERE id = CAST(:a AS uuid)"), {"a": A1})
    sql.execute(text("INSERT INTO athlete_prs (athlete_id, movement, reps, weight_kg) VALUES "
                     "(CAST(:a AS uuid), 'MUSCLE UP', 1, 20), (CAST(:a AS uuid), 'PULL UP', 1, 60), "
                     "(CAST(:a AS uuid), 'CHIN UP', 1, 65), (CAST(:a AS uuid), 'SQUAT', 1, 180)"), {"a": A1})
    coach = auth_as(uid="coach-1")
    sans_dips = coach.get("/athletes/a1/palmares", headers=_AUTH).json()
    assert (sans_dips["genre"], sans_dips["categorie"], sans_dips["total"], sans_dips["ris"]) == ("M", "-73", None, None)
    sql.execute(text("INSERT INTO athlete_prs (athlete_id, movement, reps, weight_kg) VALUES (CAST(:a AS uuid), 'DIPS', 1, 90)"), {"a": A1})
    doc = coach.get("/athletes/a1/palmares", headers=_AUTH).json()
    assert doc["total"] == 20 + 65 + 90 + 180 and doc["ris"] > 0
