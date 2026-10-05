"""Events du calendrier — BASCULÉS sur Postgres (2026-07-23).

Même dispositif hermétique que test_daily_logs.py : autz via le doc athlète
Firestore (mock `store`), donnée en SQL via un engine SQLite in-memory (StaticPool)
monkeypatché sur `get_engine`. Le schéma `calendar_events` de test porte les MÊMES
CHECK que Postgres (end_date>=start_date) et
l'UNIQUE(athlete_id, legacy_id) qui arme l'ON CONFLICT. Enums = colonnes TEXT (le
routeur n'utilise pas de CAST, cf. son docstring). SQL réel vérifié à part (ETL +
smoke Neon).
"""

import pytest
from sqlalchemy import text


# Un VRAI uuid : `athletes.id` est de type uuid en production, pas du texte —
# le stub SQLite acceptait « uuid-a1 », Postgres non.
A1 = "a1a1a1a1-0000-4000-8000-000000000001"


@pytest.fixture
def sql(pg):
    """L'athlète de référence, semé dans la transaction annulée du test.
    `coach_uid` est NOT NULL et FK vers `coaches` — le stub l'ignorait."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1', 'c@x.fr'), "
                    "('uid-1', 'a@x.fr') ON CONFLICT (uid) DO NOTHING"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1') ON CONFLICT (uid) DO NOTHING"))
    pg.execute(text("INSERT INTO athletes (id, legacy_id, coach_uid, user_uid) VALUES "
                    "(CAST(:a1 AS uuid), 'a1', 'coach-1', 'uid-1')"), {"a1": A1})
    return pg


def _iso(valeur):
    """⚠️ POSTGRES REND DES `date`, SQLITE RENDAIT DES CHAÎNES. Les assertions de
    ce fichier comparaient donc des dates à des chaînes et passaient — contre un
    stub qui n'avait pas de type DATE. C'est un des mensonges que la bascule sur
    le vrai Postgres (FRE-80) a fait tomber : on normalise ici, une fois, plutôt
    que de réécrire trente assertions en `date(2026, 5, 1)`."""
    return valeur.isoformat() if hasattr(valeur, "isoformat") else valeur

def _row(conn, legacy="e1"):
    ligne = conn.execute(
        text(
            "SELECT type, name, start_date, end_date, emoji, can_train "
            "FROM calendar_events WHERE athlete_id=CAST('a1a1a1a1-0000-4000-8000-000000000001' AS uuid) AND legacy_id=:l"
        ),
        {"l": legacy},
    ).first()
    return ligne if ligne is None else tuple(_iso(v) for v in ligne)


def _seed_event(conn, legacy="e1", **overrides):
    row = {
        "legacy_id": legacy,
        "type": "competition",
        "name": "Open",
        "start_date": "2026-03-01",
        "end_date": "2026-03-02",
        "emoji": None,
        "can_train": None,
    }
    row.update(overrides)
    conn.execute(
        text(
            "INSERT INTO calendar_events "
            "(legacy_id, athlete_id, type, name, start_date, end_date, emoji, can_train) "
            "VALUES (:legacy_id, CAST('a1a1a1a1-0000-4000-8000-000000000001' AS uuid), :type, :name, :start_date, :end_date, :emoji, :can_train)"
        ),
        row,
    )


_AUTH = {"Authorization": "Bearer x"}


# --------------------------------------------------------------------------- #
# PUT — create-or-replace
# --------------------------------------------------------------------------- #


def test_put_create_par_athlete(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.put(
        "/athletes/a1/events/e1",
        json={"type": "travel", "name": "Déplacement", "startDate": "2026-03-01",
              "endDate": "2026-03-02", "emoji": "💼", "canTrain": True},
        headers=_AUTH,
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "id": "e1"}
    # emoji + canTrain préservés (correction William).
    assert _row(sql) == ("travel", "Déplacement", "2026-03-01", "2026-03-02", "💼", 1)


def test_put_competition_REFUSEE_elle_vit_dans_son_onglet(auth_as, sql):
    """⚠️ UNE COMPÉTITION NE SE SAISIT PLUS DEPUIS LE CALENDRIER (William, 16/09).

    L'événement homonyme n'avait qu'un nom et deux dates, là où une compétition
    porte un lieu, des mouvements, des essais et des participants : il fabriquait
    une compétition FANTÔME, affichée comme telle et sans fiche derrière.

    MUTATION QUI ROUGIT : `EventCreate.type` de retour sur `EventType`."""
    client = auth_as(uid="uid-1")
    r = client.put(
        "/athletes/a1/events/e1",
        json={"type": "competition", "name": "Open", "startDate": "2026-03-01",
              "endDate": "2026-03-02"},
        headers=_AUTH,
    )
    assert r.status_code == 422
    assert _row(sql) is None


def test_put_create_par_coach(auth_as, sql):
    client = auth_as(uid="coach-1")
    r = client.put(
        "/athletes/a1/events/e1",
        json={"type": "vacation", "name": "Vacances", "startDate": "2026-08-01",
              "endDate": "2026-08-15", "emoji": "🌴"},
        headers=_AUTH,
    )
    assert r.status_code == 200
    assert _row(sql) == ("vacation", "Vacances", "2026-08-01", "2026-08-15", "🌴", None)


def test_put_replace_remplace_toute_la_ligne(auth_as, sql):
    _seed_event(sql, type="travel", name="Ancien", emoji="💼")
    client = auth_as(uid="uid-1")
    r = client.put(
        "/athletes/a1/events/e1",
        json={"type": "rest", "name": "Repos", "startDate": "2026-04-01", "endDate": "2026-04-03"},
        headers=_AUTH,
    )
    assert r.status_code == 200
    # remplacement complet : emoji effacé, tout réécrit
    assert _row(sql) == ("rest", "Repos", "2026-04-01", "2026-04-03", None, None)


def test_put_cycle_REFUSE_le_cycle_vit_dans_le_journal(auth_as, sql):
    """FRE-173 : la phase du cycle est un fait du jour (`daily_logs.cycle_phase`),
    écrit par l'athlète seule. Le calendrier ne l'accepte plus — sinon deux
    endroits déclareraient la même notion, et le staff pourrait le faire à la
    place de l'athlète. Depuis le 13/09, la BASE ne le pourrait plus non plus :
    `cycle` a quitté l'enum `event_type`."""
    client = auth_as(uid="uid-1")
    r = client.put(
        "/athletes/a1/events/c1",
        json={"type": "cycle", "name": "Lutéale", "startDate": "2026-03-10",
              "endDate": "2026-03-17"},
        headers=_AUTH,
    )
    assert r.status_code == 422
    assert _row(sql, "c1") is None


def test_put_phase_REFUSEE_a_l_ecriture(auth_as, sql):
    """`phase` n'existe plus : `extra="forbid"` le rejette plutôt que de l'ignorer."""
    client = auth_as(uid="uid-1")
    r = client.put(
        "/athletes/a1/events/e1",
        json={"type": "competition", "name": "Open", "startDate": "2026-03-01",
              "endDate": "2026-03-02", "phase": "luteal"},
        headers=_AUTH,
    )
    assert r.status_code == 422
    assert _row(sql) is None


def test_put_end_avant_start_422(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.put(
        "/athletes/a1/events/e1",
        json={"type": "rest", "name": "X", "startDate": "2026-03-05", "endDate": "2026-03-01"},
        headers=_AUTH,
    )
    assert r.status_code == 422
    assert _row(sql) is None  # rien écrit


def test_put_type_hors_enum_422(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.put(
        "/athletes/a1/events/e1",
        json={"type": "bogus", "name": "X", "startDate": "2026-03-01", "endDate": "2026-03-02"},
        headers=_AUTH,
    )
    assert r.status_code == 422


def test_put_athlete_absent_sql_404(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.put(
        "/athletes/ghost/events/e1",
        json={"type": "rest", "name": "X", "startDate": "2026-03-01", "endDate": "2026-03-02"},
        headers=_AUTH,
    )
    assert r.status_code == 404


def test_put_event_id_invalide_422(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.put(
        "/athletes/a1/events/e1.evil",  # '.' hors regex [A-Za-z0-9_-]
        json={"type": "rest", "name": "X", "startDate": "2026-03-01", "endDate": "2026-03-02"},
        headers=_AUTH,
    )
    assert r.status_code == 422
    assert _row(sql, "e1.evil") is None


def test_put_intrus_403(auth_as, sql):
    client = auth_as(uid="intrus")
    r = client.put(
        "/athletes/a1/events/e1",
        json={"type": "rest", "name": "X", "startDate": "2026-03-01", "endDate": "2026-03-02"},
        headers=_AUTH,
    )
    assert r.status_code == 403
    assert _row(sql) is None


# --------------------------------------------------------------------------- #
# PATCH — read-modify-write
# --------------------------------------------------------------------------- #


def test_patch_partiel_preserve_le_reste(auth_as, sql):
    _seed_event(sql, emoji="⚔️", can_train=True)
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/events/e1", json={"name": "Renommé"}, headers=_AUTH)
    assert r.status_code == 200
    # name changé ; type/dates/emoji/canTrain intacts
    assert _row(sql) == ("competition", "Renommé", "2026-03-01", "2026-03-02", "⚔️", 1)


def test_patch_vers_cycle_REFUSE(auth_as, sql):
    """FRE-173 : on ne fabrique plus de cycle par le calendrier, même en PATCH."""
    _seed_event(sql, type="vacation", name="V")
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/events/e1", json={"type": "cycle"}, headers=_AUTH)
    assert r.status_code == 422
    assert _row(sql)[0] == "vacation"


def test_patch_vers_competition_REFUSE(auth_as, sql):
    """Une porte fermée à moitié n'est pas fermée : sans cette garde, l'événement
    se créait en « autre », puis se retournait en compétition d'un second appel.
    MUTATION QUI ROUGIT : `EventPatch.type` de retour sur `EventType`."""
    _seed_event(sql, type="vacation", name="V")
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/events/e1", json={"type": "competition"}, headers=_AUTH)
    assert r.status_code == 422
    assert _row(sql)[0] == "vacation"


def test_patch_phase_REFUSEE(auth_as, sql):
    """`phase` n'existe plus, même en PATCH : 422, et la ligne ne bouge pas."""
    _seed_event(sql, type="vacation", name="V")
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/events/e1", json={"phase": "ovulation"}, headers=_AUTH)
    assert r.status_code == 422
    assert _row(sql)[:2] == ("vacation", "V")


def test_la_base_ne_connait_plus_ni_cycle_ni_phase(sql):
    """13/09 — CE QUE LA MIGRATION PROMET, éprouvé sur le schéma que pytest
    charge : aucune valeur `cycle` à `event_type`, aucune colonne `phase`. Un
    INSERT direct, qui contourne toute la couche HTTP, doit échouer.
    MUTATION QUI ROUGIT : remettre `'cycle'` dans l'enum de `postgres-schema.sql`."""
    from sqlalchemy.exc import DataError
    valeurs = sql.execute(text("SELECT enum_range(NULL::event_type)::text")).scalar()
    assert valeurs == "{competition,vacation,travel,rest,other}"
    assert sql.execute(text(
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'calendar_events' AND column_name = 'phase'")).scalar() == 0
    point = sql.begin_nested()
    with pytest.raises(DataError):
        _seed_event(sql, legacy="c1", type="cycle", name="Cycle")
    point.rollback()


def test_patch_end_avant_start_422(auth_as, sql):
    _seed_event(sql)  # 2026-03-01 → 2026-03-02
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/events/e1", json={"endDate": "2026-02-01"}, headers=_AUTH)
    assert r.status_code == 422
    assert _row(sql)[3] == "2026-03-02"  # inchangé


def test_patch_event_absent_404(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.patch("/athletes/a1/events/absent", json={"name": "X"}, headers=_AUTH)
    assert r.status_code == 404


def test_patch_intrus_403(auth_as, sql):
    _seed_event(sql)
    client = auth_as(uid="intrus")
    r = client.patch("/athletes/a1/events/e1", json={"name": "Hack"}, headers=_AUTH)
    assert r.status_code == 403
    assert _row(sql)[1] == "Open"  # inchangé


# --------------------------------------------------------------------------- #
# DELETE
# --------------------------------------------------------------------------- #


def test_delete_supprime(auth_as, sql):
    _seed_event(sql)
    client = auth_as(uid="uid-1")
    r = client.delete("/athletes/a1/events/e1", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "deleted": "e1"}
    assert _row(sql) is None


def test_delete_absent_404(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.delete("/athletes/a1/events/absent", headers=_AUTH)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# GET — liste complète
# --------------------------------------------------------------------------- #


def test_get_liste_camelcase_null_omis_ordonne(auth_as, sql):
    """⚠️ ET LA COMPÉTITION SE LIT ENCORE (16/09) : l'écriture la refuse désormais,
    la lecture la rend. 13 lignes de production la portent, dont 11 à venir — les
    refuser ici effacerait de vrais engagements des calendriers de leurs athlètes."""
    _seed_event(sql, legacy="e2", type="vacation", name="Vacances", start_date="2026-01-05",
                end_date="2026-01-10")
    _seed_event(sql, legacy="e1", type="competition", name="Open", start_date="2026-03-01",
                end_date="2026-03-02", emoji="⚔️", can_train=True)
    client = auth_as(uid="uid-1")
    r = client.get("/athletes/a1/events", headers=_AUTH)
    assert r.status_code == 200
    # ordonné par start_date (e2 en janvier avant e1 en mars)
    assert r.json() == [
        {"id": "e2", "type": "vacation", "name": "Vacances", "startDate": "2026-01-05",
         "endDate": "2026-01-10"},
        {"id": "e1", "type": "competition", "name": "Open", "startDate": "2026-03-01",
         "endDate": "2026-03-02", "emoji": "⚔️", "canTrain": True},
    ]


def test_get_vide(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.get("/athletes/a1/events", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == []


def test_get_coach_autorise(auth_as, sql):
    _seed_event(sql)
    client = auth_as(uid="coach-1")
    r = client.get("/athletes/a1/events", headers=_AUTH)
    assert r.status_code == 200
    assert [e["id"] for e in r.json()] == ["e1"]


def test_get_intrus_403(auth_as, sql):
    client = auth_as(uid="intrus")
    r = client.get("/athletes/a1/events", headers=_AUTH)
    assert r.status_code == 403


def test_get_athlete_absent_sql_404(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.get("/athletes/ghost/events", headers=_AUTH)
    assert r.status_code == 404
