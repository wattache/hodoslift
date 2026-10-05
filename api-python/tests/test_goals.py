"""Objectifs d'athlète — BASCULÉS sur Postgres (2026-07-23).

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


_AUTH = {"Authorization": "Bearer x"}


def _seed_goal(conn, legacy, exercise="Squat", created="2026-01-10", achieved=None, **cols):
    row = {"legacy": legacy, "ex": exercise, "created": created, "achieved": achieved,
           "sets": cols.get("sets", ""), "reps": cols.get("reps", ""),
           "weight": cols.get("weight", ""), "motivation": cols.get("motivation", "")}
    conn.execute(
        text(
            "INSERT INTO athlete_goals "
            "(athlete_id, legacy_id, exercise, sets, reps, weight, motivation, created_on, achieved_on) "
            "VALUES (CAST('a1a1a1a1-0000-4000-8000-000000000001' AS uuid), :legacy, :ex, :sets, :reps, :weight, :motivation, :created, :achieved)"
        ),
        row,
    )


def _legacy_ids(conn):
    return sorted(r[0] for r in conn.execute(text("SELECT legacy_id FROM athlete_goals")).all())


def _iso(valeur):
    """⚠️ POSTGRES REND DES `date`, SQLITE RENDAIT DES CHAÎNES. Les assertions de
    ce fichier comparaient donc des dates à des chaînes et passaient — contre un
    stub qui n'avait pas de type DATE. C'est un des mensonges que la bascule sur
    le vrai Postgres (FRE-80) a fait tomber : on normalise ici, une fois, plutôt
    que de réécrire trente assertions en `date(2026, 5, 1)`."""
    return valeur.isoformat() if hasattr(valeur, "isoformat") else valeur

def _goal(conn, legacy):
    ligne = conn.execute(
        text("SELECT exercise, sets, reps, weight, motivation, created_on, achieved_on "
             "FROM athlete_goals WHERE legacy_id = :l"),
        {"l": legacy},
    ).first()
    return ligne if ligne is None else tuple(_iso(v) for v in ligne)


def _item(id_, exercise="Squat", createdAt="2026-01-10", **extra):
    return {"id": id_, "exercise": exercise, "createdAt": createdAt, **extra}


def _version(client) -> str:
    """La version que la LECTURE vient de rendre — le geste exact du front.

    ⚠️ Aucune spec ne fabrique cette valeur à la main : une version inventée
    prouverait qu'on sait écrire une chaîne, pas que le client peut réécrire ce
    qu'il vient de lire."""
    return client.get("/athletes/a1/goals", headers=_AUTH).json()["version"]


# --------------------------------------------------------------------------- #
# GET
# --------------------------------------------------------------------------- #


def test_get_liste_triee_achievedat_omis(auth_as, sql):
    _seed_goal(sql, "g2", exercise="Bench", created="2026-03-01")
    _seed_goal(sql, "g1", exercise="Squat", created="2026-01-10", achieved="2026-02-01",
               sets="5", reps="3", weight="100", motivation="PR")
    client = auth_as(uid="uid-1")
    r = client.get("/athletes/a1/goals", headers=_AUTH)
    assert r.status_code == 200
    body = r.json()["goals"]
    # trié par created_on : g1 (janvier) avant g2 (mars)
    assert body[0] == {
        "id": "g1", "exercise": "Squat", "sets": "5", "reps": "3", "weight": "100",
        "motivation": "PR", "createdAt": "2026-01-10", "achievedAt": "2026-02-01",
    }
    assert body[1]["id"] == "g2"
    assert "achievedAt" not in body[1]  # achieved_on NULL → omis


def test_get_vide(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.get("/athletes/a1/goals", headers=_AUTH)
    assert r.status_code == 200
    assert r.json()["goals"] == []


def test_get_coach_autorise(auth_as, sql):
    _seed_goal(sql, "g1")
    r = auth_as(uid="coach-1").get("/athletes/a1/goals", headers=_AUTH)
    assert r.status_code == 200
    assert [g["id"] for g in r.json()["goals"]] == ["g1"]


def test_get_intrus_403(auth_as, sql):
    r = auth_as(uid="intrus").get("/athletes/a1/goals", headers=_AUTH)
    assert r.status_code == 403


def test_get_athlete_absent_sql_404(auth_as, sql):
    r = auth_as(uid="uid-1").get("/athletes/ghost/goals", headers=_AUTH)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# PUT — remplacement (upsert présents + delete absents)
# --------------------------------------------------------------------------- #


def test_put_sync_upsert_et_delete(auth_as, sql):
    _seed_goal(sql, "g1", exercise="Squat")
    _seed_goal(sql, "g2", exercise="Bench")  # sera supprimé (absent du PUT)
    client = auth_as(uid="uid-1")
    r = client.put(
        "/athletes/a1/goals",
        json={"version": _version(client), "goals": [
            _item("g1", exercise="Front Squat"),         # upsert (modifié)
            _item("g3", exercise="Deadlift", achievedAt="2026-05-01", createdAt="2026-04-01"),  # nouveau
        ]},
        headers=_AUTH,
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "count": 2}
    assert _legacy_ids(sql) == ["g1", "g3"]  # g2 supprimé
    assert _goal(sql, "g1")[0] == "Front Squat"  # g1 mis à jour
    assert _goal(sql, "g3")[6] == "2026-05-01"   # achieved_on de g3


def test_put_owner_athlete_ecrit_ses_goals(auth_as, sql):
    client = auth_as(uid="uid-1")
    r = client.put("/athletes/a1/goals",
                   json={"version": _version(client), "goals": [_item("g1")]}, headers=_AUTH)
    assert r.status_code == 200
    assert _legacy_ids(sql) == ["g1"]


def test_put_coach_ecrit(auth_as, sql):
    client = auth_as(uid="coach-1")
    r = client.put("/athletes/a1/goals",
                   json={"version": _version(client), "goals": [_item("g1")]}, headers=_AUTH)
    assert r.status_code == 200


def test_put_vide_supprime_tout(auth_as, sql):
    _seed_goal(sql, "g1")
    client = auth_as(uid="uid-1")
    r = client.put("/athletes/a1/goals",
                   json={"version": _version(client), "goals": []}, headers=_AUTH)
    assert r.status_code == 200
    assert _legacy_ids(sql) == []


def test_put_intrus_403(auth_as, sql):
    _seed_goal(sql, "g1")
    r = auth_as(uid="intrus").put("/athletes/a1/goals",
                                  json={"version": "peu-importe", "goals": [_item("gX")]}, headers=_AUTH)
    assert r.status_code == 403
    assert _legacy_ids(sql) == ["g1"]  # inchangé


def test_put_athlete_absent_sql_404(auth_as, sql):
    r = auth_as(uid="uid-1").put("/athletes/ghost/goals",
                                 json={"version": "peu-importe", "goals": [_item("g1")]}, headers=_AUTH)
    assert r.status_code == 404


def test_put_created_at_invalide_422(auth_as, sql):
    r = auth_as(uid="uid-1").put(
        "/athletes/a1/goals", json={"version": "x", "goals": [_item("g1", createdAt="01/02/2026")]}, headers=_AUTH
    )
    assert r.status_code == 422
    assert _legacy_ids(sql) == []


def test_put_created_at_manquant_422(auth_as, sql):
    r = auth_as(uid="uid-1").put(
        "/athletes/a1/goals", json={"version": "x", "goals": [{"id": "g1", "exercise": "Squat"}]}, headers=_AUTH
    )
    assert r.status_code == 422


def test_put_achieved_avant_created_422(auth_as, sql):
    r = auth_as(uid="uid-1").put(
        "/athletes/a1/goals",
        json={"version": "x", "goals": [_item("g1", createdAt="2026-03-01", achievedAt="2026-02-01")]},
        headers=_AUTH,
    )
    assert r.status_code == 422
    assert _legacy_ids(sql) == []


def test_put_exercise_vide_422(auth_as, sql):
    r = auth_as(uid="uid-1").put(
        "/athletes/a1/goals", json={"version": "x", "goals": [{"id": "g1", "exercise": "  ", "createdAt": "2026-01-10"}]},
        headers=_AUTH,
    )
    assert r.status_code == 422


def test_put_id_invalide_422(auth_as, sql):
    r = auth_as(uid="uid-1").put(
        "/athletes/a1/goals", json={"version": "x", "goals": [_item("g1/../evil")]}, headers=_AUTH
    )
    assert r.status_code == 422
    assert _legacy_ids(sql) == []


def test_put_cap_depasse_422(auth_as, sql):
    goals = [_item(f"g{i}", createdAt="2026-01-10") for i in range(201)]
    r = auth_as(uid="uid-1").put("/athletes/a1/goals", json={"version": "x", "goals": goals}, headers=_AUTH)
    assert r.status_code == 422
    assert _legacy_ids(sql) == []


# --------------------------------------------------------------------------- #
# PUT — LA LISTE N'A PAS BOUGÉ DEPUIS SA LECTURE (FRE-134)
# --------------------------------------------------------------------------- #


def test_le_SECOND_ecrivain_n_efface_plus_le_premier(auth_as, sql):
    """⚠️ LE DÉFAUT VIVAIT ICI, ET IL ÉTAIT SILENCIEUX. Ce PUT remplace la liste
    ENTIÈRE par celle du client, et `owner_or_staff` ouvre la porte à DEUX
    humains : l'athlète et son coach. Celui qui avait chargé la page en premier
    renvoyait une liste sans l'objectif que l'autre venait d'ajouter — et cet
    objectif disparaissait, sans erreur ni journal.

    On rejoue exactement ça : les deux lisent, le coach écrit, l'athlète écrit
    ensuite avec SA version, celle d'avant."""
    _seed_goal(sql, "g1", exercise="Squat")
    athlete, coach = auth_as(uid="uid-1"), auth_as(uid="coach-1")

    vue_par_l_athlete = _version(athlete)
    coach.put("/athletes/a1/goals",
              json={"version": _version(coach), "goals": [_item("g1"), _item("g2", exercise="Bench")]},
              headers=_AUTH)

    r = athlete.put("/athletes/a1/goals",
                    json={"version": vue_par_l_athlete, "goals": [_item("g1")]}, headers=_AUTH)
    assert r.status_code == 409
    assert r.json()["code"] == "objectifs_perimes"
    # Et surtout : l'ajout du coach est TOUJOURS LÀ.
    assert _legacy_ids(sql) == ["g1", "g2"]


def test_relire_puis_reecrire_passe(auth_as, sql):
    """⚠️ LA MOITIÉ QUI REND LA GARDE VIVABLE. Un refus qu'on ne sait pas lever
    n'est pas une garde, c'est une panne : après le 409, recharger doit suffire.

    Sans cette spec, une version qui ne se rafraîchirait jamais — calculée une
    fois, mise en cache, figée — passerait le test précédent en beauté."""
    _seed_goal(sql, "g1")
    athlete, coach = auth_as(uid="uid-1"), auth_as(uid="coach-1")
    perimee = _version(athlete)
    coach.put("/athletes/a1/goals",
              json={"version": _version(coach), "goals": [_item("g1"), _item("g2", exercise="Bench")]},
              headers=_AUTH)
    assert athlete.put("/athletes/a1/goals",
                       json={"version": perimee, "goals": [_item("g1")]},
                       headers=_AUTH).status_code == 409

    r = athlete.put("/athletes/a1/goals",
                    json={"version": _version(athlete), "goals": [_item("g1")]}, headers=_AUTH)
    assert r.status_code == 200
    assert _legacy_ids(sql) == ["g1"]


def test_deux_objectifs_du_MEME_JOUR_sortent_dans_un_ordre_TOTAL(auth_as, sql):
    """⚠️ CE DONT LA VERSION DÉPEND. L'empreinte est calculée sur la liste DANS
    L'ORDRE OÙ LA REQUÊTE LA REND : si cet ordre n'est pas totalement déterminé,
    l'empreinte peut changer sans que la donnée bouge — et le PUT refuserait
    alors une écriture parfaitement légitime, ce qui est pire que le défaut
    qu'on corrige.

    `ORDER BY created_on` seul laisse Postgres départager deux objectifs du même
    jour comme il veut : il rendait l'ordre du TAS, c'est-à-dire l'ordre
    d'écriture (z, a, m). `legacy_id` tranche.

    ⚠️ ON N'ASSERTE PAS « DEUX LECTURES DONNENT LE MÊME MOT » : c'était la
    première version de cette spec, et elle restait VERTE sans le départage —
    sur trois lignes, deux scans consécutifs du même tas rendent le même ordre.
    Elle prouvait la stabilité du bac à sable, pas celle du tri."""
    for suffixe in ("z", "a", "m"):
        _seed_goal(sql, f"g{suffixe}", created="2026-01-10")
    lus = auth_as(uid="uid-1").get("/athletes/a1/goals", headers=_AUTH).json()["goals"]
    assert [g["id"] for g in lus] == ["ga", "gm", "gz"]


def test_une_version_ABSENTE_ne_passe_pas(auth_as, sql):
    """Le champ est requis par le contrat : un client qui ne l'envoie pas est
    exactement celui qui écraserait. 422 de validation, pas de porte de sortie."""
    _seed_goal(sql, "g1")
    r = auth_as(uid="uid-1").put("/athletes/a1/goals",
                                 json={"goals": [_item("g2")]}, headers=_AUTH)
    assert r.status_code == 422
    assert _legacy_ids(sql) == ["g1"]
