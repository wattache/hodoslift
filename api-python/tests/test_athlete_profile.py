"""Écriture du profil athlète — Postgres (2026-07-26).

⚠️ SUR LE VRAI POSTGRES (FRE-80). L'en-tête d'origine disait tout : « athletes.id
est INTEGER pour que le RETURNING fonctionne sous SQLite », « current_one_rm est
TEXT », et surtout « ce chemin N'EST PAS couvrable sur ce stub » à propos du
MERGE jsonb. Le stub imposait donc ses propres types, et le chemin d'écriture le
plus délicat du profil restait dans l'angle mort.

La fixture `pg` monte un Postgres 16, LA version de Neon, dont le schéma est
appliqué depuis `docs/postgres-schema.sql` : les uuid sont des uuid, le genre est
un enum, `current_one_rm` est du jsonb.
"""

import json

import pytest
from sqlalchemy import text

from tests.conftest import semer_un_membre


@pytest.fixture
def sql(pg):
    """`coaches.uid` est une FK vers `users` et `athletes.coach_uid` vers
    `coaches` — deux liens que le stub ne déclarait pas."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1', 'c@x.fr') "
                    "ON CONFLICT (uid) DO NOTHING"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1') ON CONFLICT (uid) DO NOTHING"))
    return pg


_AUTH = {"Authorization": "Bearer x"}


def _seed_authz():
    """Doc athlète Firestore pour l'autz (coach-only : coachId == uid)."""


def _seed_row(conn, legacy="a1", **cols):
    # ⚠️ `user_uid` EST UNE FK VERS `users` : on crée le stub au passage, comme le
    # fait `POST /athletes/link` en production.
    user_uid = cols.get("user_uid")
    if user_uid:
        conn.execute(
            text("INSERT INTO users (uid, email) VALUES (:u, :e) ON CONFLICT (uid) DO NOTHING"),
            {"u": user_uid, "e": cols.get("email") or f"{user_uid}@x.com"})
    row = {"legacy": legacy, "fn": cols.get("first_name", "Bob"), "gender": cols.get("gender"),
           "coach": cols.get("coach_uid", "coach-1"), "email": cols.get("email"),
           "user": user_uid,
           "orm": json.dumps(cols["current_one_rm"]) if cols.get("current_one_rm") is not None else None}
    conn.execute(
        text("INSERT INTO athletes (legacy_id, first_name, gender, coach_uid, email, user_uid, "
             "current_one_rm) "
             "VALUES (:legacy, :fn, CAST(:gender AS gender), :coach, :email, :user, "
             "CAST(:orm AS jsonb))"),
        row,
    )


def _row(conn, legacy="a1"):
    return conn.execute(
        text("SELECT first_name, last_name, email, height_cm, weight_kg, birth_date, gender, current_one_rm "
             "FROM athletes WHERE legacy_id = :l"),
        {"l": legacy},
    ).mappings().first()


# --------------------------------------------------------------------------- #
# PATCH /profile — champs scalaires (portable SQLite)
# --------------------------------------------------------------------------- #


def test_patch_update_partiel(auth_as, sql):
    _seed_authz()
    _seed_row(sql, first_name="Bob")
    client = auth_as(uid="coach-1")
    r = client.patch("/athletes/a1/profile",
                     json={"firstName": "Léa", "height": 165, "birthDate": "1996-03-14"}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "written": ["birthDate", "firstName", "height"]}
    row = _row(sql)
    assert row["first_name"] == "Léa" and row["height_cm"] == 165
    assert row["birth_date"].isoformat() == "1996-03-14"


def test_un_age_envoye_par_un_client_ancien_est_ignore_sans_perdre_le_reste(auth_as, sql):
    """FRE-168 — ⚠️ LA FILE HORS-LIGNE REJOUE DES PATCHS ANCIENS. Un `{age: 30}`
    en 422 ferait tomber le patch ENTIER, et le poids qui l'accompagne serait
    perdu. Il est écarté : ni écrit, ni annoncé dans `written` — et seul, il ne
    touche rien et ne casse pas l'UPDATE (un `SET` vide serait une erreur SQL)."""
    _seed_authz()
    _seed_row(sql, first_name="Bob")
    client = auth_as(uid="coach-1")
    r = client.patch("/athletes/a1/profile", json={"weight": 82, "age": 30}, headers=_AUTH)
    assert (r.status_code, r.json()) == (200, {"ok": True, "written": ["weight"]})
    assert _row(sql)["weight_kg"] == 82
    r = client.patch("/athletes/a1/profile", json={"age": 30}, headers=_AUTH)
    assert (r.status_code, r.json()) == (200, {"ok": True, "written": []})


def test_une_date_de_naissance_s_efface_par_la_chaine_vide_et_refuse_le_futur(auth_as, sql):
    """`""` efface (le patch écarte les `None`, comme pour `gender`) ; une date
    future est refusée à l'écriture — un CHECK ne peut pas le dire, il doit
    rester vrai demain."""
    _seed_authz()
    _seed_row(sql, first_name="Bob")
    client = auth_as(uid="coach-1")
    assert client.patch("/athletes/a1/profile", json={"birthDate": "1990-01-01"}, headers=_AUTH).status_code == 200
    assert client.patch("/athletes/a1/profile", json={"birthDate": ""}, headers=_AUTH).status_code == 200
    assert _row(sql)["birth_date"] is None
    futur = client.patch("/athletes/a1/profile", json={"birthDate": "2999-01-01"}, headers=_AUTH)
    assert futur.status_code == 422
    assert client.patch("/athletes/a1/profile", json={"birthDate": "pas une date"}, headers=_AUTH).status_code == 422
    assert _row(sql)["birth_date"] is None


def test_le_bench_et_le_deadlift_font_l_aller_ET_le_retour(auth_as, sql):
    """FRE-147 — les deux mouvements ajoutés à la Table RM, éprouvés BOUT EN BOUT.

    ⚠️ DEUX CONTRATS SÉPARÉS, ET C'EST LE SECOND QUI FAIT MAL. `OneRMPatch`
    oublié rend 422 sur la seule écriture concernée. `UnRM` oublié rend **500 sur
    `/athletes/mine`** — la liste entière, pour TOUS les athlètes du coach, parce
    que le modèle est lui aussi en `extra="forbid"` et qu'une clé qu'il ne
    déclare pas fait échouer la validation de la RÉPONSE. Une seule valeur de
    bench press enregistrée suffirait alors à vider le tableau de bord de tout
    le monde. Vu rouge le 07/09 en retirant les deux champs de `UnRM`.

    Le MERGE jsonb est vérifié au passage : les cinq clés d'origine survivent."""
    _seed_authz()
    _seed_row(sql, current_one_rm={"squat": 160, "pullUp": 70})
    client = auth_as(uid="coach-1")

    r = client.patch("/athletes/a1/profile", headers=_AUTH,
                     json={"currentOneRM": {"benchPress": 90, "deadlift": 180}})
    assert r.status_code == 200

    assert _row(sql)["current_one_rm"] == {
        "squat": 160, "pullUp": 70, "benchPress": 90, "deadlift": 180}

    lu = client.get("/athletes/mine", headers=_AUTH).json()[0]["currentOneRM"]
    assert lu["benchPress"] == 90 and lu["deadlift"] == 180, \
        "la lecture doit rendre ce que l'écriture a accepté"


def test_patch_email_normalise(auth_as, sql):
    """⚠️ ET C'EST LE TÉMOIN DU GEL CI-DESSOUS : sur une fiche SANS compte,
    l'email reste parfaitement écrivable. C'est le geste d'onboarding — le coach
    corrige l'adresse pour que l'athlète puisse se connecter — et il ne devait
    surtout pas partir avec le correctif de FRE-131."""
    _seed_authz()
    _seed_row(sql)
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile", json={"email": "  BOB@X.COM "}, headers=_AUTH)
    assert r.status_code == 200
    assert _row(sql)["email"] == "bob@x.com"  # strip + lower


def test_l_email_SE_FIGE_des_que_la_fiche_porte_un_compte(auth_as, sql):
    """⚠️ LA CHAÎNE QUE CE REFUS CASSE (FRE-131). `PATCH /profile` en mode staff
    acceptait `email` ; le coach y écrivait sa propre adresse, se connectait avec
    un second compte Google, et `POST /athletes/link` — qui rattache toute fiche
    dont l'email correspond — le rendait OWNER. `GET /bilans/{id}` s'ouvre à
    `owner` : antécédents et pathologies servis. Chaque étape était auditée,
    aucune n'était empêchée.

    Avant liaison l'email est un contact ; après, c'est une identité. Le schéma
    l'affirmait déjà — « une fois lié, `users.email` fait foi » — sans que le
    code l'applique.

    MESURÉ AVANT DE FERMER (10/09) : 67 fiches liées, `athletes.email` égal à
    `users.email` 67 fois sur 67. Le champ était déjà un miroir."""
    _seed_authz()
    _seed_row(sql, email="bob@x.com", user_uid="bob")
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile",
                                     json={"email": "coach@pirate.com"}, headers=_AUTH)
    assert r.status_code == 409
    assert r.json()["code"] == "email_fige_par_le_compte"
    assert _row(sql)["email"] == "bob@x.com"   # rien touché


def test_le_gel_ne_prend_QUE_l_email_en_otage(auth_as, sql):
    """Une fiche liée reste éditable — poids, taille, âge, nom. Un refus qui
    emporterait tout le profil punirait le coach pour un geste qu'il ne fait
    pas, et le pousserait à contourner autrement."""
    _seed_authz()
    _seed_row(sql, email="bob@x.com", user_uid="bob")
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile",
                                     json={"lastName": "Martin", "weight": 78}, headers=_AUTH)
    assert r.status_code == 200
    row = _row(sql)
    assert row["last_name"] == "Martin" and row["weight_kg"] == 78
    assert row["email"] == "bob@x.com"


def test_le_gel_refuse_le_LOT_ENTIER_et_n_ecrit_rien(auth_as, sql):
    """⚠️ UN REFUS PARTIEL SERAIT PIRE QUE PAS DE REFUS. `PATCH` écrit ses champs
    en UN seul UPDATE : accepter le poids et ignorer l'email en silence rendrait
    200 sur une écriture à moitié faite, et le client croirait avoir tout
    enregistré. La règle est donc posée AVANT l'UPDATE, sur le lot complet."""
    _seed_authz()
    _seed_row(sql, email="bob@x.com", user_uid="bob", first_name="Bob")
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile",
                                     json={"email": "coach@pirate.com", "firstName": "Léa"},
                                     headers=_AUTH)
    assert r.status_code == 409
    row = _row(sql)
    assert row["email"] == "bob@x.com"
    assert row["first_name"] == "Bob", "le champ innocent du lot ne doit pas passer non plus"


def test_patch_gender_vide_devient_null(auth_as, sql):
    _seed_authz()
    _seed_row(sql, gender="M")
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile", json={"gender": ""}, headers=_AUTH)
    assert r.status_code == 200
    assert _row(sql)["gender"] is None  # ex-deleteField


def test_patch_gender_set(auth_as, sql):
    _seed_authz()
    _seed_row(sql)
    auth_as(uid="coach-1").patch("/athletes/a1/profile", json={"gender": "F"}, headers=_AUTH)
    assert _row(sql)["gender"] == "F"


def test_patch_athlete_lie_refuse_403(auth_as, sql):
    _seed_authz()
    _seed_row(sql)
    r = auth_as(uid="uid-1").patch("/athletes/a1/profile", json={"weight": 61}, headers=_AUTH)
    assert r.status_code == 403  # coach-only : l'athlète lié ne peut pas éditer
    assert _row(sql)["first_name"] == "Bob"  # inchangé


def test_patch_tiers_refuse_403(auth_as, sql):
    _seed_authz()
    _seed_row(sql)
    r = auth_as(uid="intrus").patch("/athletes/a1/profile", json={"weight": 61}, headers=_AUTH)
    assert r.status_code == 403


def test_patch_athlete_absent_sql_404(auth_as, sql):
    _seed_authz()  # doc Firestore présent (autz OK) mais pas de ligne SQL
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile", json={"weight": 61}, headers=_AUTH)
    assert r.status_code == 404


def test_patch_athlete_inexistant_firestore_404(auth_as, sql):
    # aucun doc athlète → autz 404 avant même de toucher SQL
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile", json={"weight": 61}, headers=_AUTH)
    assert r.status_code == 404


@pytest.mark.parametrize("field", ["coachId", "linkedUserId", "programId"])
def test_patch_champ_hors_whitelist_422(auth_as, sql, field):
    _seed_authz()
    _seed_row(sql)
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile", json={field: "x"}, headers=_AUTH)
    assert r.status_code == 422


def test_patch_vide_422(auth_as, sql):
    _seed_authz()
    _seed_row(sql)
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile", json={}, headers=_AUTH)
    assert r.status_code == 422


def test_patch_first_name_vide_422(auth_as, sql):
    _seed_authz()
    _seed_row(sql)
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile", json={"firstName": "   "}, headers=_AUTH)
    assert r.status_code == 422


def test_patch_email_vide_422(auth_as, sql):
    _seed_authz()
    _seed_row(sql)
    r = auth_as(uid="coach-1").patch("/athletes/a1/profile", json={"email": ""}, headers=_AUTH)
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# POST /athletes — createAthlete
# --------------------------------------------------------------------------- #


def _coach(conn, uid="coach-1"):
    """is_coach lit Postgres (coaches). Le `users` d'abord : FK."""
    semer_un_membre(conn, uid)


def test_create_athlete_et_programme(auth_as, sql):
    _coach(sql)
    r = auth_as(uid="coach-1").post("/athletes", json={"firstName": "  Neo ", "email": "NEO@X.com"}, headers=_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"id", "programId"}
    ath = sql.execute(
        text("SELECT id, legacy_id, first_name, email, coach_uid, current_one_rm FROM athletes")
    ).mappings().first()
    prog = sql.execute(text("SELECT id, coach_uid, athlete_id FROM programs")).mappings().first()
    # athlète : legacy_id renvoyé, name trim, email strip+lower, coach = appelant
    assert ath["legacy_id"] == body["id"]
    assert ath["first_name"] == "Neo" and ath["email"] == "neo@x.com"
    assert ath["coach_uid"] == "coach-1"
    # current_one_rm par défaut : VIDE. Il portait les cinq clés à 0 — la moitié
    # manquante de FRE-137, cf. `test_creation_UNE_FICHE_NEUVE_N_A_AUCUN_1RM`.
    # ⚠️ UN `dict`, PAS UNE CHAÎNE. `current_one_rm` est du jsonb : psycopg le
    # désérialise pour nous. Le stub SQLite le stockait en TEXT, d'où le
    # `json.loads` d'avant — encore une forme que le test empruntait à son stub
    # et pas à la production.
    assert ath["current_one_rm"] == {}
    # programme : id renvoyé, pointe l'athlète créé, coach = appelant
    assert prog["id"] == body["programId"]
    assert prog["athlete_id"] == ath["id"]
    assert prog["coach_uid"] == "coach-1"


def test_create_non_coach_403(auth_as, sql):
    r = auth_as(uid="pas-coach").post("/athletes", json={"firstName": "Neo", "email": "neo@x.com"}, headers=_AUTH)
    assert r.status_code == 403
    assert sql.execute(text("SELECT count(*) FROM athletes")).scalar() == 0


def test_create_first_name_vide_422(auth_as, sql):
    _coach(sql)
    r = auth_as(uid="coach-1").post("/athletes", json={"firstName": "  ", "email": "neo@x.com"}, headers=_AUTH)
    assert r.status_code == 422


def test_create_email_vide_422(auth_as, sql):
    _coach(sql)
    r = auth_as(uid="coach-1").post("/athletes", json={"firstName": "Neo", "email": "  "}, headers=_AUTH)
    assert r.status_code == 422



# --------------------------------------------------------------------------- #
# UN ZÉRO N'EST PAS UNE MESURE (FRE-137, lot 4)
# --------------------------------------------------------------------------- #

def test_un_poids_a_zero_s_ecrit_NULL(auth_as, sql):
    """⚠️ PERSONNE NE PÈSE ZÉRO KILO, et 28 fiches sur 70 le prétendaient.

    La cause n'est pas une saisie fautive : `athlete-profile-edit.tsx` fait
    `parseFloat(v) || 0`, donc VIDER la case envoie `0`. Le serveur l'écrivait
    tel quel, et « non renseigné » devenait une mesure.

    ⚠️ ON CORRIGE CÔTÉ SERVEUR, et c'est la règle de propriété du projet : le
    maximum de logique dans brokkr. Un front corrigé laisserait passer tout
    autre client — et la file hors-ligne rejoue des patchs écrits par des
    versions antérieures, qui porteront ce `0` encore longtemps."""
    _seed_authz()
    _seed_row(sql, first_name="Bob")
    r = auth_as(uid="coach-1").patch(
        "/athletes/a1/profile", json={"weight": 0, "height": 0}, headers=_AUTH)
    assert r.status_code == 200
    row = _row(sql)
    assert row["weight_kg"] is None and row["height_cm"] is None


def test_une_vraie_mesure_passe_intacte(auth_as, sql):
    """⚠️ LA GARDE DE LA GARDE : la conversion ne doit toucher QUE le zéro."""
    _seed_authz()
    _seed_row(sql)
    auth_as(uid="coach-1").patch(
        "/athletes/a1/profile", json={"weight": 81.5, "height": 175}, headers=_AUTH)
    row = _row(sql)
    assert float(row["weight_kg"]) == 81.5 and float(row["height_cm"]) == 175


def test_un_1RM_a_zero_RETIRE_la_cle(auth_as, sql):
    """⚠️ UN 1RM À ZÉRO N'EST PAS UN RECORD, C'EST UNE CASE VIDE. 59 fiches sur
    70 portaient `chinUp: 0`, et `tracking.py` fait `float(one_rm) if one_rm
    else None` — ce qui confond « pas de record » et « record de zéro ».

    ⚠️ LA CLÉ EST RETIRÉE, PAS MISE À `null`. Le merge `||` de Postgres écrirait
    un `null` JSON, qui se relit comme une valeur : le même piège d'un cran plus
    bas. Il faut la faire disparaître de l'objet."""
    _seed_authz()
    _seed_row(sql)
    cli = auth_as(uid="coach-1")
    cli.patch("/athletes/a1/profile",
              json={"currentOneRM": {"squat": 120, "chinUp": 47.5}}, headers=_AUTH)
    r = cli.patch("/athletes/a1/profile",
                  json={"currentOneRM": {"chinUp": 0}}, headers=_AUTH)
    assert r.status_code == 200
    orm = _row(sql)["current_one_rm"]
    orm = orm if isinstance(orm, dict) else __import__("json").loads(orm)
    assert "chinUp" not in orm, "la clé doit DISPARAÎTRE, pas valoir null"
    # ⚠️ Et le merge continue de préserver ce qu'on n'a pas touché.
    assert float(orm["squat"]) == 120
