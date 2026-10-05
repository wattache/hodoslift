"""`GET /athletes/{id}/forme-du-jour` — la courbe de forme, servie (FRE-119).

⚠️ CE QUE CES SPECS PROTÈGENT AVANT TOUT : LE REPLI DE DATE. Mesuré le 17/08 sur
la vraie donnée, 446 séances notées portent une `session_date` et **306 autres
ont une forme saisie SANS date de séance**, leur semaine étant seule datée. Une
lecture qui ne prendrait que `session_date` perdrait donc 40 % des points — et
personne ne s'en apercevrait, parce qu'une courbe plus courte reste une courbe.

C'est aussi pourquoi cette règle descend ICI : elle était écrite en double, dans
l'ETL et dans `lib/forme-du-jour.ts`, donc dans deux langages.
"""

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.usefixtures("pg")

_AUTH = {"Authorization": "Bearer x"}


@pytest.fixture
def monde(pg):
    """Un athlète, deux semaines datées, et des séances dont certaines seulement
    portent leur propre date."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','c@x.fr'), ('ath-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, user_uid, first_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','a1','coach-1','ath-1','Léa')"))
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                    "VALUES ('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    macro = pg.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number) "
        "VALUES ('p1','m1',1) RETURNING id")).scalar()
    bloc = pg.execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number) "
        f"VALUES ('{macro}','b1',1) RETURNING id")).scalar()
    s1 = pg.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number, start_date, end_date) "
        f"VALUES ('{bloc}','w1',1, DATE '2026-05-04', DATE '2026-05-10') RETURNING id")).scalar()
    s2 = pg.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number, start_date, end_date) "
        f"VALUES ('{bloc}','w2',2, DATE '2026-05-11', DATE '2026-05-17') RETURNING id")).scalar()

    def seance(week, legacy, position, date, forme):
        d = f"DATE '{date}'" if date else "NULL"
        f = str(forme) if forme is not None else "NULL"
        pg.execute(text(
            "INSERT INTO training_sessions (week_id, legacy_id, position, name, "
            f"session_date, form_of_the_day) VALUES ('{week}','{legacy}',{position},'J', {d}, {f})"))

    seance(s1, "sa", 1, "2026-05-05", 4)   # datée, notée
    seance(s1, "sb", 2, None, 2)           # PAS datée, notée → repli sur le lundi
    seance(s1, "sc", 3, "2026-05-07", None)  # datée, PAS notée → écartée
    seance(s2, "sd", 1, "2026-05-12", 5)
    return pg


def _lire(client, depuis="2026-01-01"):
    r = client.get(f"/athletes/a1/forme-du-jour?depuis={depuis}", headers=_AUTH)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def test_une_seance_SANS_date_retombe_sur_le_debut_de_sa_semaine(monde, auth_as):
    """⚠️ LA SPEC QUI VAUT LE TICKET. Sans ce repli, 306 des 752 séances notées
    de la production n'ont aucun point — et la courbe reste crédible."""
    points = _lire(auth_as(uid="ath-1"))

    assert {"date": "2026-05-04", "form": 2} in points, "la séance non datée est perdue"
    assert {"date": "2026-05-05", "form": 4} in points


def test_une_seance_NON_NOTEE_n_est_pas_un_point(monde, auth_as):
    """Pas de forme saisie ≠ forme nulle : elle ne figure sur aucune courbe."""
    assert [p["date"] for p in _lire(auth_as(uid="ath-1"))] == [
        "2026-05-04", "2026-05-05", "2026-05-12"]


def test_les_points_sont_ORDONNES_par_date(monde, auth_as):
    dates = [p["date"] for p in _lire(auth_as(uid="ath-1"))]
    assert dates == sorted(dates)


def test_depuis_est_INCLUSE_et_coupe_le_reste(monde, auth_as):
    """La borne porte sur la date EFFECTIVE — celle d'après le repli, pas celle
    de la séance : une séance non datée se coupe sur le lundi de sa semaine."""
    points = _lire(auth_as(uid="ath-1"), depuis="2026-05-05")
    assert [p["date"] for p in points] == ["2026-05-05", "2026-05-12"]

    borne = _lire(auth_as(uid="ath-1"), depuis="2026-05-04")
    assert borne[0]["date"] == "2026-05-04", "`depuis` est incluse"


def test_le_COACH_de_l_athlete_lit_la_courbe(monde, auth_as):
    assert len(_lire(auth_as(uid="coach-1"))) == 3


def test_un_ETRANGER_ne_lit_rien(monde, auth_as):
    """Même autorisation que le suivi et les records : l'athlète ou son staff."""
    monde.execute(text("INSERT INTO users (uid, email) VALUES ('autre','x@x.fr')"))
    monde.execute(text("INSERT INTO coaches (uid) VALUES ('autre')"))
    r = auth_as(uid="autre").get("/athletes/a1/forme-du-jour?depuis=2026-01-01", headers=_AUTH)
    assert r.status_code == 403
    assert r.json()["code"] == "athlete_hors_perimetre"


def test_une_semaine_SANS_AUCUNE_date_ne_produit_pas_de_point(monde, auth_as):
    """Ni date de séance, ni date de semaine : la forme existe mais ne se place
    nulle part. `NULL >= date` n'est pas vrai — le filtre l'écarte, et c'est le
    comportement voulu, pas un effet de bord à corriger."""
    macro = monde.execute(text("SELECT id FROM training_macros WHERE program_id='p1'")).scalar()
    bloc = monde.execute(text(f"SELECT id FROM training_blocks WHERE macro_id='{macro}'")).scalar()
    orpheline = monde.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number) "
        f"VALUES ('{bloc}','w3',3) RETURNING id")).scalar()
    monde.execute(text(
        "INSERT INTO training_sessions (week_id, legacy_id, position, name, form_of_the_day) "
        f"VALUES ('{orpheline}','se',1,'J', 3)"))

    assert len(_lire(auth_as(uid="ath-1"))) == 3
