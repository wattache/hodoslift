"""La progression d'un mouvement (25/10) : le 1RM estimé par série, l'intensité,
les raisons d'une semaine sans estimation, et le travail refait à l'identique.

Fonctions pures sur des lignes factices, sauf la dernière, qui traverse la
route sur le vrai Postgres.
"""

from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.suivi import progression, rm_estime
from tests.conftest import AUTH


# --------------------------------------------------------------------------- #
# Le moteur : la table RTS
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("rpe, reps, pct", [
    (10, 1, 100.0), (9, 1, 95.5), (9.5, 1, 97.8), (8, 3, 86.3), (7.5, 1, 90.7),
    (6.5, 8, 69.4), (10, 10, 73.9), (6, 10, 62.6),
])
def test_la_table_est_celle_de_tuchscherer(rpe, reps, pct):
    assert rm_estime.pourcentage(rpe, reps) == pct


def test_le_rpe_s_arrondit_au_demi_point():
    assert rm_estime.pourcentage(8.3, 3) == rm_estime.pourcentage(8.5, 3)
    assert rm_estime.pourcentage(8.2, 3) == rm_estime.pourcentage(8, 3)


@pytest.mark.parametrize("rpe, reps", [(5.5, 3), (8, 11), (8, 0), (8, 2.5), (10.5, 1)])
def test_hors_table_on_ne_devine_pas(rpe, reps):
    assert rm_estime.pourcentage(rpe, reps) is None


def test_e1rm_en_charge_totale():
    # 100 kg × 3 @8 : 86,3 % du max → 115,9 kg.
    assert round(rm_estime.e1rm_total(100, 3, 8), 1) == 115.9
    assert rm_estime.e1rm_total(0, 3, 8) is None


def test_la_pesee_est_la_derniere_connue_sans_regarder_devant():
    pesees = [(date(2026, 2, 1), 80.0), (date(2026, 3, 1), 82.0)]
    assert rm_estime.pdc_le(pesees, date(2026, 2, 15)) == 80.0
    assert rm_estime.pdc_le(pesees, date(2026, 3, 1)) == 82.0
    assert rm_estime.pdc_le(pesees, date(2026, 1, 15)) is None


# --------------------------------------------------------------------------- #
# Les semaines
# --------------------------------------------------------------------------- #


def _ligne(jour, *, reps=3, kg=5, rpe=8, variantes=(), tempo="", fmt="", sets=3, bodyweight=False):
    return SimpleNamespace(session_date=jour, macro_number=1, block_number=1,
                           variantes=list(variantes), tempo_cle=tempo, format_cle=fmt,
                           sets=sets, reps=reps, charge_kg=kg, bodyweight=bodyweight, felt_rpe=rpe)


_PESEES = [(date(2026, 1, 1), 80.0)]


def test_le_1rm_de_la_semaine_est_le_meilleur_en_lest():
    """Muscle up, 80 kg de corps : 5 kg × 3 @8 → (85 / 0,863) − 80 = 18,5 kg ;
    10 kg × 1 @9 → (90 / 0,955) − 80 = 14,2 kg. La semaine garde 18,5."""
    s = progression.semaines(
        [_ligne(date(2026, 3, 2), kg=5, reps=3, rpe=8), _ligne(date(2026, 3, 4), kg=10, reps=1, rpe=9)],
        pesees=_PESEES, exercise="MUSCLE UP")
    assert s[date(2026, 3, 2)]["e1Kg"] == 18.5
    assert s[date(2026, 3, 2)]["e1Raison"] is None


def test_sur_une_barre_le_poids_du_corps_ne_compte_pas():
    s = progression.semaines([_ligne(date(2026, 3, 2), kg=100, reps=3, rpe=8)],
                             pesees=[], exercise="SQUAT")
    assert s[date(2026, 3, 2)]["e1Kg"] == 115.9


def test_une_semaine_sans_forme_de_competition_dit_variantes():
    """C'est le cas du muscle up depuis le 31/08 : NO DIPS, tempo DS, CHEST —
    du travail, mais aucune série qui annonce un maximum. `None`, pas 0, et la
    raison écrite : l'écran dit « pas de série de compétition », pas « arrêtée »."""
    s = progression.semaines(
        [_ligne(date(2026, 9, 7), variantes=["NO DIPS"]), _ligne(date(2026, 9, 9), tempo="DS")],
        pesees=_PESEES, exercise="MUSCLE UP")
    assert s[date(2026, 9, 7)] == {"e1Kg": None, "intensite": None, "e1Raison": "variantes"}


def test_comp_et_free_sont_la_forme_de_competition():
    s = progression.semaines([_ligne(date(2026, 3, 2), variantes=["COMP"]),
                              _ligne(date(2026, 3, 9), variantes=["FREE"])],
                             pesees=_PESEES, exercise="MUSCLE UP")
    assert all(v["e1Kg"] is not None for v in s.values())


def test_sans_rpe_rien_a_estimer():
    s = progression.semaines([_ligne(date(2026, 3, 2), rpe=None)], pesees=_PESEES, exercise="MUSCLE UP")
    assert s[date(2026, 3, 2)]["e1Raison"] == "sans_rpe"


def test_sans_pesee_un_mouvement_au_poids_du_corps_ne_s_estime_pas():
    s = progression.semaines([_ligne(date(2026, 3, 2))], pesees=[], exercise="MUSCLE UP")
    assert s[date(2026, 3, 2)]["e1Raison"] == "sans_pesee"
    # Mais la pesée prime sur toute autre raison quand plusieurs manquent.
    s = progression.semaines([_ligne(date(2026, 3, 2)), _ligne(date(2026, 3, 3), rpe=None)],
                             pesees=[], exercise="MUSCLE UP")
    assert s[date(2026, 3, 2)]["e1Raison"] == "sans_pesee"


def test_trop_de_reps_hors_table():
    s = progression.semaines([_ligne(date(2026, 3, 2), reps=15)], pesees=_PESEES, exercise="MUSCLE UP")
    assert s[date(2026, 3, 2)] == {"e1Kg": None, "intensite": None, "e1Raison": "reps"}


def test_l_intensite_est_en_pourcent_du_meilleur_de_la_periode():
    """Semaine 1 : 5 kg × 3 @8 → total 85, e1 18,5. Semaine 2 : 0 kg × 5 @7 →
    total 80, e1 = 80 / 0,786 − 80 = 21,8 : c'est le meilleur, la référence vaut
    101,8 kg. Semaine 1 : 85 / 101,8 = 83,5 % ; semaine 2 : 80 / 101,8 = 78,6 %."""
    s = progression.semaines(
        [_ligne(date(2026, 3, 2), kg=5, reps=3, rpe=8), _ligne(date(2026, 3, 9), kg=0, reps=5, rpe=7)],
        pesees=_PESEES, exercise="MUSCLE UP")
    assert s[date(2026, 3, 2)]["intensite"] == 83.5
    assert s[date(2026, 3, 9)]["intensite"] == 78.6


def test_pdc_sans_charge_vaut_zero_de_lest():
    s = progression.semaines([_ligne(date(2026, 3, 2), kg=None, bodyweight=True)],
                             pesees=_PESEES, exercise="MUSCLE UP")
    assert s[date(2026, 3, 2)]["e1Kg"] == round(80 / 0.863 - 80, 1)


# --------------------------------------------------------------------------- #
# Le travail refait
# --------------------------------------------------------------------------- #


def test_un_travail_refait_a_l_identique_trie_du_progres_au_recul():
    lignes = [
        _ligne(date(2026, 4, 23), kg=5, reps=3, sets=3, rpe=10),
        _ligne(date(2026, 7, 13), kg=5, reps=3, sets=3, rpe=7.5),
        _ligne(date(2026, 3, 16), kg=0, reps=6, sets=2, rpe=8.5),
        _ligne(date(2026, 4, 18), kg=0, reps=6, sets=2, rpe=10),
        # Même séries × reps × lest mais un tempo : un AUTRE travail.
        _ligne(date(2026, 9, 18), kg=5, reps=3, sets=3, rpe=8.5, tempo="DS"),
        _ligne(date(2026, 10, 5), kg=5, reps=3, sets=3, rpe=7, tempo="DS"),
        # Fait une seule fois : pas refait.
        _ligne(date(2026, 5, 1), kg=12.5, reps=1, sets=1, rpe=9),
    ]
    r = progression.refaits(lignes, exercise="MUSCLE UP")
    assert [(x["delta"], x["competition"], x["tempo"]) for x in r] == [
        (-2.5, True, None), (-1.5, False, "DS"), (1.5, True, None)]
    assert r[0]["points"] == [{"date": "2026-04-23", "rpe": 10.0}, {"date": "2026-07-13", "rpe": 7.5}]
    assert r[0]["lestKg"] == 5.0 and r[0]["sets"] == 3.0 and r[0]["reps"] == 3.0


def test_refait_le_meme_jour_n_est_pas_refait():
    lignes = [_ligne(date(2026, 4, 23), rpe=10), _ligne(date(2026, 4, 23), rpe=7)]
    assert progression.refaits(lignes, exercise="MUSCLE UP") == []


def test_refait_exige_un_rpe_a_chaque_fois():
    lignes = [_ligne(date(2026, 4, 23), rpe=10), _ligne(date(2026, 5, 23), rpe=None)]
    assert progression.refaits(lignes, exercise="MUSCLE UP") == []


# --------------------------------------------------------------------------- #
# Par la route, sur le vrai Postgres : les séries lourdes et les pesées
# --------------------------------------------------------------------------- #

_AUTH = AUTH


@pytest.fixture
def sql(pg):
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','c1@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name) "
        "VALUES ('aaaaaaaa-1111-1111-1111-111111111111','a1','coach-1','A')"))
    return pg


def _serie(conn, jour, *, kg, reps, sets, felt, variant=None):
    conn.execute(text(
        "INSERT INTO training_sets (athlete_id, program_id, session_index, exercise_index, "
        "exercise, session_date, date_exact, week_number, macro_number, block_number, "
        "sets, reps, weight_kg, tonnage_kg, felt_rpe, felt_rpe_raw, variant) "
        "VALUES ('a1','p1',0,0,'MUSCLE UP',CAST(:d AS date),true,1,1,1,"
        "        :sets,:reps,:kg,:sets*:reps*:kg,:felt,CAST(:felt AS text),:variant)"),
        {"d": jour, "kg": kg, "reps": reps, "sets": sets, "felt": felt, "variant": variant})


def test_la_route_rend_lourdes_e1_intensite_et_refaits(auth_as, sql):
    """Deux semaines de muscle up, une pesée au journal. Semaine 1 : 3 × 3 @8 à
    5 kg (lourde) ; semaine 2 : le même travail @7 (plus lourde), et une ligne
    NO DIPS @9 qui compte dans les lourdes mais pas dans l'estimation."""
    sql.execute(text(
        "INSERT INTO daily_logs (athlete_id, log_date, weight_kg) "
        "VALUES ('aaaaaaaa-1111-1111-1111-111111111111', '2026-02-01', 80)"))
    _serie(sql, "2026-03-02", kg=5, reps=3, sets=3, felt=8)
    _serie(sql, "2026-03-09", kg=5, reps=3, sets=3, felt=7)
    _serie(sql, "2026-03-11", kg=0, reps=5, sets=4, felt=9, variant=["NO DIPS"])

    body = auth_as(uid="coach-1").get("/athletes/a1/tracking", headers=_AUTH).json()

    s1, s2 = body["weeks"]
    assert (s1["lourdes"], s2["lourdes"]) == (3, 4)
    assert s1["e1Kg"] == 18.5 and s1["e1Raison"] is None
    # @7 à la même charge : 85 / 0,837 − 80 = 21,6 — et c'est lui le meilleur.
    assert s2["e1Kg"] == 21.6
    # Les deux semaines travaillent à 85 kg de total sur 101,6 : 83,7 % — la
    # ligne NO DIPS n'entre pas dans l'intensité, ce n'est pas la forme de compétition.
    assert (s1["intensite"], s2["intensite"]) == (83.7, 83.7)
    assert body["refaits"] == [{
        "competition": True, "variant": [], "tempo": None, "format": None,
        "sets": 3.0, "reps": 3.0, "lestKg": 5.0,
        "points": [{"date": "2026-03-02", "rpe": 8.0}, {"date": "2026-03-09", "rpe": 7.0}],
        "delta": -1.0}]


def test_sans_pesee_la_route_le_dit(auth_as, sql):
    _serie(sql, "2026-03-02", kg=5, reps=3, sets=3, felt=8)
    body = auth_as(uid="coach-1").get("/athletes/a1/tracking", headers=_AUTH).json()
    assert body["weeks"][0]["e1Kg"] is None
    assert body["weeks"][0]["e1Raison"] == "sans_pesee"
