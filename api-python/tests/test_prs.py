"""Records manuels (manualPRs → athlete_prs) — BASCULÉS sur Postgres (2026-07-31).

⚠️ SUR LE VRAI POSTGRES (FRE-80). Le stub SQLite redéclarait les tables à sa
façon — `id TEXT` là où la production a un `uuid`, aucune des FK, pas les enums —
donc il ne pouvait par construction jamais contredire le schéma réel. C'est ce
mécanisme qui a laissé `docs/postgres-schema.sql` diverger sans que rien ne
rougisse : le fichier avait perdu une table et gardé deux colonnes fantômes, et
tous les tests étaient verts. La fixture `pg` monte un Postgres 16, LA version de
Neon, dont le schéma est appliqué DEPUIS ce fichier.
"""

import pytest
from sqlalchemy import text


# Bibliothèque : deux lifts de compétition + un renforcement (competition=false).
_LIBRARY = [
    ("SQUAT", "exercices", 1),
    ("ÉPAULÉ-JETÉ", "exercices", 1),
    ("GAINAGE", "exercices", 0),        # renforcement → refusé
    ("Course", "wods", 1),              # pas un exercice → refusé
]


# Un VRAI uuid : `athletes.id` est de type uuid en production, pas du texte —
# le stub SQLite acceptait « uuid-a1 », Postgres non.
A1 = "a1a1a1a1-0000-4000-8000-000000000001"
A2 = "a2a2a2a2-0000-4000-8000-000000000002"


@pytest.fixture
def sql(pg):
    """L'athlète de référence, semé dans la transaction annulée du test.
    `coach_uid` est NOT NULL et FK vers `coaches` — le stub l'ignorait."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1', 'c@x.fr'), "
                    "('uid-1', 'a@x.fr') ON CONFLICT (uid) DO NOTHING"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1') ON CONFLICT (uid) DO NOTHING"))
    pg.execute(text("INSERT INTO athletes (id, legacy_id, coach_uid, user_uid) VALUES "
                    "(CAST(:a1 AS uuid), 'a1', 'coach-1', 'uid-1'), "
                    "(CAST(:a2 AS uuid), 'a2', 'coach-1', NULL)"), {"a1": A1, "a2": A2})
    # ⚠️ LA BIBLIOTHÈQUE FAIT PARTIE DU DISPOSITIF : le POST refuse un mouvement
    # qui n'est pas un lift de compétition. Deux lifts, un renforcement et une
    # entrée hors catégorie — les deux derniers doivent être REFUSÉS.
    # ⚠️ EN MAJUSCULES, COMME LA PRODUCTION (aligné le 06/09, FRE-123). La
    # fixture semait « Squat » quand le référentiel porte « SQUAT » : deux
    # graphies du même lift, c'est-à-dire précisément ce que la clé étrangère
    # vers la bibliothèque interdit désormais. La correspondance canonique
    # devenait ambiguë, et le test échouait pour cette raison-là.
    for nom, categorie, compet in (("SQUAT", "exercices", True),
                                   ("ÉPAULÉ-JETÉ", "exercices", True),
                                   ("GAINAGE", "exercices", False),
                                   # ⚠️ « wods » N'EXISTE PAS : `library_category` est
                                   # un enum fermé en production (exercices, variantes,
                                   # assistances, tempos, formats). Le stub SQLite, avec
                                   # sa colonne TEXT, acceptait une catégorie inventée —
                                   # le test éprouvait donc un cas impossible.
                                   ("Course", "variantes", False)):
        pg.execute(text("INSERT INTO library_entries (name, category, competition, created_by) "
                        "VALUES (:n, CAST(:c AS library_category), :k, 'coach-1') "
                        # ⚠️ `DO UPDATE` : `conftest` sème sans le drapeau
                        # `competition`, dont ces specs ont besoin.
                        "ON CONFLICT (structure, category, name) DO UPDATE SET competition = EXCLUDED.competition"),
                   {"n": nom, "c": categorie, "k": compet})
    return pg


_AUTH = {"Authorization": "Bearer x"}


def _seed_pr(conn, athlete=A1, movement="SQUAT", reps=1, weight=100.0,
             sets=None, fmt=None, variant=None, performed=None):
    return conn.execute(
        text(
            "INSERT INTO athlete_prs "
            "(athlete_id, movement, reps, weight_kg, sets, format, variant, performed_on) "
            "VALUES (:a, :m, :r, :w, :s, :f, :v, :p) RETURNING id"
        ),
        {"a": athlete, "m": movement, "r": reps, "w": weight,
         "s": sets, "f": fmt, "v": variant, "p": performed},
    ).scalar()


def _rows(conn, athlete=A1):
    return conn.execute(
        text("SELECT movement, reps, weight_kg, sets, variant, format FROM athlete_prs "
             "WHERE athlete_id = :a ORDER BY id"),
        {"a": athlete},
    ).all()


def _body(movement="SQUAT", reps=1, weight=120.0, **extra):
    return {"movement": movement, "reps": reps, "weight": weight, **extra}


# --------------------------------------------------------------------------- #
# GET
# --------------------------------------------------------------------------- #


def test_get_liste_triee_movement_reps(sql, auth_as):
    _seed_pr(sql, movement="SQUAT", reps=3, weight=150)
    _seed_pr(sql, movement="SQUAT", reps=1, weight=180)
    _seed_pr(sql, movement="ÉPAULÉ-JETÉ", reps=1, weight=90, sets="4", variant="pause",
             fmt="EMOM", performed="2026-05-01")
    r = auth_as(uid="uid-1").get("/athletes/a1/prs", headers=_AUTH)
    assert r.status_code == 200
    body = r.json()
    # ⚠️ L'ORDRE EST CELUI DE POSTGRES, et il n'est PAS celui que ce test
    # affirmait. SQLite comparait des octets, donc « É » (U+00C9) passait après
    # « S » ; Postgres compare selon la collation et le range AVANT. La
    # production a toujours rendu cet ordre-là — le test décrivait son stub.
    assert [(p["movement"], p["reps"]) for p in body] == [
        ("ÉPAULÉ-JETÉ", 1), ("SQUAT", 1), ("SQUAT", 3),
    ]
    ej = body[0]
    assert ej == {
        "id": ej["id"], "movement": "ÉPAULÉ-JETÉ", "reps": 1, "weight": 90.0,
        "sets": "4", "format": "EMOM", "variant": "pause", "performedOn": "2026-05-01",
    }
    assert body[1]["sets"] is None and body[1]["performedOn"] is None


def test_get_vide(sql, auth_as):
    r = auth_as(uid="uid-1").get("/athletes/a1/prs", headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == []


def test_get_coach_autorise(sql, auth_as):
    _seed_pr(sql, movement="SQUAT", reps=1)
    r = auth_as(uid="coach-1").get("/athletes/a1/prs", headers=_AUTH)
    assert r.status_code == 200
    assert [p["movement"] for p in r.json()] == ["SQUAT"]


def test_get_intrus_403(sql, auth_as):
    r = auth_as(uid="intrus").get("/athletes/a1/prs", headers=_AUTH)
    assert r.status_code == 403


def test_get_athlete_absent_404(sql, auth_as):
    r = auth_as(uid="uid-1").get("/athletes/ghost/prs", headers=_AUTH)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# POST — ajout / mise à jour par identité
# --------------------------------------------------------------------------- #


def test_post_ajout_puis_get_roundtrip(sql, auth_as):
    client = auth_as(uid="coach-1")
    r = client.post(
        "/athletes/a1/prs",
        json=_body(movement="SQUAT", reps=1, weight=180, sets="1", performedOn="2026-06-01"),
        headers=_AUTH,
    )
    assert r.status_code == 200
    created = r.json()
    assert created["id"]
    assert created["movement"] == "SQUAT" and created["weight"] == 180.0

    got = client.get("/athletes/a1/prs", headers=_AUTH).json()
    assert len(got) == 1
    assert got[0]["id"] == created["id"]
    assert got[0]["weight"] == 180.0 and got[0]["sets"] == "1"
    assert got[0]["performedOn"] == "2026-06-01"


def test_post_meme_movement_reps_sets_differents_coexistent(sql, auth_as):
    client = auth_as(uid="coach-1")
    r1 = client.post("/athletes/a1/prs", json=_body(reps=4, weight=100, sets=None), headers=_AUTH)
    r2 = client.post("/athletes/a1/prs", json=_body(reps=4, weight=100, sets="4"), headers=_AUTH)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] != r2.json()["id"]
    assert len(_rows(sql)) == 2  # deux records distincts


def test_post_identique_met_a_jour_sans_doublon(sql, auth_as):
    client = auth_as(uid="coach-1")
    first = client.post("/athletes/a1/prs", json=_body(reps=1, weight=150, sets="1"), headers=_AUTH)
    second = client.post("/athletes/a1/prs", json=_body(reps=1, weight=185, sets="1"), headers=_AUTH)
    assert first.json()["id"] == second.json()["id"]  # même identité → màj
    rows = _rows(sql)
    assert len(rows) == 1
    assert float(rows[0][2]) == 185.0  # weight_kg mis à jour


def test_post_identique_sets_null_met_a_jour(sql, auth_as):
    """Identité null-safe : sets NULL ↔ sets NULL collisionnent (IS NOT DISTINCT FROM)."""
    client = auth_as(uid="coach-1")
    a = client.post("/athletes/a1/prs", json=_body(reps=1, weight=150), headers=_AUTH)
    b = client.post("/athletes/a1/prs", json=_body(reps=1, weight=200), headers=_AUTH)
    assert a.json()["id"] == b.json()["id"]
    assert len(_rows(sql)) == 1
    assert float(_rows(sql)[0][2]) == 200.0


def test_post_mouvement_renforcement_422(sql, auth_as):
    r = auth_as(uid="coach-1").post("/athletes/a1/prs", json=_body(movement="GAINAGE"), headers=_AUTH)
    assert r.status_code == 422
    assert len(_rows(sql)) == 0


def test_post_mouvement_inconnu_422(sql, auth_as):
    r = auth_as(uid="coach-1").post("/athletes/a1/prs", json=_body(movement="Zumba"), headers=_AUTH)
    assert r.status_code == 422
    assert len(_rows(sql)) == 0


def test_post_mouvement_insensible_casse(sql, auth_as):
    """⚠️ ACCEPTÉ DANS N'IMPORTE QUELLE CASSE, MAIS ÉCRIT DANS CELLE DE LA
    BIBLIOTHÈQUE (changé le 06/09, FRE-123).

    Cette spec affirmait « écrit tel que saisi ». C'était un défaut, pas une
    fonctionnalité : « squat » et « SQUAT » se retrouvaient côte à côte dans le
    tableau des records comme DEUX lifts — la fragmentation même que ce ticket
    combat. La clé étrangère vers `library_entries` l'interdit désormais, et le
    serveur écrit le nom canonique.

    Sans effet sur l'existant : les 184 PR de production portaient déjà
    l'orthographe de la bibliothèque (mesuré, zéro écart)."""
    r = auth_as(uid="coach-1").post("/athletes/a1/prs", json=_body(movement="squat"), headers=_AUTH)
    assert r.status_code == 200
    assert _rows(sql)[0][0] == "SQUAT"


def test_post_movement_blanc_422(sql, auth_as):
    r = auth_as(uid="coach-1").post("/athletes/a1/prs", json=_body(movement="   "), headers=_AUTH)
    assert r.status_code == 422
    assert len(_rows(sql)) == 0


def test_post_reps_zero_422(sql, auth_as):
    r = auth_as(uid="coach-1").post("/athletes/a1/prs", json=_body(reps=0), headers=_AUTH)
    assert r.status_code == 422
    assert len(_rows(sql)) == 0


def test_post_weight_non_positif_422(sql, auth_as):
    r = auth_as(uid="coach-1").post("/athletes/a1/prs", json=_body(weight=0), headers=_AUTH)
    assert r.status_code == 422
    assert len(_rows(sql)) == 0


def test_post_performed_on_invalide_422(sql, auth_as):
    r = auth_as(uid="coach-1").post(
        "/athletes/a1/prs", json=_body(performedOn="01/02/2026"), headers=_AUTH
    )
    assert r.status_code == 422
    assert len(_rows(sql)) == 0


def test_post_athlete_owner_403(sql, auth_as):
    """L'athlète lié NE saisit PAS ses records (POST = coach)."""
    r = auth_as(uid="uid-1").post("/athletes/a1/prs", json=_body(), headers=_AUTH)
    assert r.status_code == 403
    assert len(_rows(sql)) == 0


def test_post_intrus_403(sql, auth_as):
    r = auth_as(uid="intrus").post("/athletes/a1/prs", json=_body(), headers=_AUTH)
    assert r.status_code == 403


def test_post_athlete_absent_404(sql, auth_as):
    r = auth_as(uid="coach-1").post("/athletes/ghost/prs", json=_body(), headers=_AUTH)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# DELETE
# --------------------------------------------------------------------------- #


def test_delete_par_id(sql, auth_as):
    pr_id = _seed_pr(sql, movement="SQUAT", reps=1)
    r = auth_as(uid="coach-1").delete(f"/athletes/a1/prs/{pr_id}", headers=_AUTH)
    assert r.status_code == 200
    assert r.json()["deleted"] == str(pr_id)
    assert len(_rows(sql)) == 0


def test_delete_id_inexistant_404(sql, auth_as):
    r = auth_as(uid="coach-1").delete("/athletes/a1/prs/999999", headers=_AUTH)
    assert r.status_code == 404


def test_delete_id_autre_athlete_404(sql, auth_as):
    """On ne supprime jamais le record d'un autre athlète (id valide mais pas le sien)."""
    other = _seed_pr(sql, athlete=A2, movement="SQUAT", reps=1)
    r = auth_as(uid="coach-1").delete(f"/athletes/a1/prs/{other}", headers=_AUTH)
    assert r.status_code == 404
    assert len(_rows(sql, athlete=A2)) == 1  # intact


def test_delete_athlete_owner_403(sql, auth_as):
    pr_id = _seed_pr(sql, movement="SQUAT", reps=1)
    r = auth_as(uid="uid-1").delete(f"/athletes/a1/prs/{pr_id}", headers=_AUTH)
    assert r.status_code == 403
    assert len(_rows(sql)) == 1


def test_delete_intrus_403(sql, auth_as):
    pr_id = _seed_pr(sql, movement="SQUAT", reps=1)
    r = auth_as(uid="intrus").delete(f"/athletes/a1/prs/{pr_id}", headers=_AUTH)
    assert r.status_code == 403
    assert len(_rows(sql)) == 1


def test_un_PR_porte_TOUS_ses_champs(auth_as, sql):
    """Figé AVANT le `response_model` (FRE-70) : un champ qu'il ne déclarerait pas
    disparaîtrait de la réponse sans erreur ni journal.

    ⚠️ `performedOn` est TOUJOURS présent, éventuellement nul — la route l'écrit
    par un ternaire, pas par un ajout conditionnel. Omettre une clé et la rendre
    nulle sont deux messages différents pour le client."""
    c = auth_as(uid="coach-1")
    c.post("/athletes/a1/prs", json={"movement": "squat", "reps": 1, "weight": 100},
           headers=_AUTH)

    pr = c.get("/athletes/a1/prs", headers=_AUTH).json()[0]
    assert set(pr) == {"id", "movement", "reps", "weight", "sets", "format",
                       "variant", "performedOn"}
