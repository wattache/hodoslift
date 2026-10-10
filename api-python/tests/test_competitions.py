"""Compétitions — BASCULÉES sur Postgres (décompose/recompose, 2026-07-30).

Dispositif hermétique SQLite in-memory (StaticPool) monkeypatché sur get_engine.
is_coach lit la table `coaches`. Les mouvements de compét sont validés contre
`library_entries` (category='exercices' ET competition=true). Le SQL Postgres-only
(enums, CASCADE réel) est validé à part contre Neon.

Le test central est le ROUND-TRIP : PUT puis GET doit rendre un doc identique à
l'entrée (+ champs dérivés serveur) — un champ perdu à la recomposition passe
inaperçu jusqu'à ce qu'un coach édite.
"""


import pytest
from sqlalchemy import text

from tests.conftest import semer_un_membre


_COMP_LIFTS = ["SQUAT", "MUSCLE UP", "PULL UP", "DIPS"]  # competition=true


# `athletes.id` est un uuid en production, pas du texte libre.
ALICE = "a11ce000-0000-4000-8000-000000000001"


@pytest.fixture
def sql(pg):
    """⚠️ CE FICHIER LISAIT DÉJÀ LA VUE DEPUIS LE SCHÉMA DE PRODUCTION —
    `competition_scores` porte deux règles d'agrégation, et une copie locale en
    aurait fait une seconde définition, qui dérive. Le commentaire d'alors
    concédait le reste : « ce stub reste un pis-aller ». Il n'y en a plus : tout
    le schéma vient du fichier de référence, la vue comme les tables.

    Ne restent ici que les DONNÉES du décor : les coachs, une athlète, et les
    lifts de compétition (`weight_categories`, elles, sont portées par le schéma
    — c'est un référentiel de la fédération, pas de la donnée d'application)."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1', 'c1@x.fr'), ('coach-2', 'c2@x.fr'), ('user-alice', 'a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1'), ('coach-2')"))
    pg.execute(text("INSERT INTO athletes (id, legacy_id, coach_uid, user_uid) "
                    "VALUES (CAST(:a AS uuid), 'ath-alice', 'coach-1', 'user-alice')"),
               {"a": ALICE})
    for name in _COMP_LIFTS:
        # ⚠️ `DO UPDATE` ET NON `DO NOTHING` (FRE-123) : `conftest` sème un
        # référentiel minimal sans le drapeau `competition`, et ces tests ont
        # besoin qu'il soit VRAI. Ne rien faire sur conflit laisserait le lift
        # à `false`, et les specs échoueraient sur une cause invisible.
        pg.execute(text("INSERT INTO library_entries (category, name, competition, created_by) "
                        "VALUES ('exercices', :n, true, 'coach-1') "
                        "ON CONFLICT (structure, category, name) DO UPDATE SET competition = true"),
                   {"n": name})
    # exercice de renforcement (competition=false) → pas un lift de compét
    pg.execute(text("INSERT INTO library_entries (category, name, competition, created_by) "
                    "VALUES ('exercices', 'LEG CURL', false, 'coach-1') ON CONFLICT DO NOTHING"))
    return pg


_AUTH = {"Authorization": "Bearer x"}


def _count(conn, table):
    return conn.execute(text(f"SELECT count(*) FROM {table}")).scalar()


def _v(client, comp_id="c1"):
    """La version qu'un écran aurait lue, à présenter au PATCH (FRE-162)."""
    return next(c["version"] for c in client.get("/competitions", headers=_AUTH).json() if c["id"] == comp_id)


# Doc de référence pour le round-trip.
_DOC = {
    "name": "Open 2026",
    "date": "2026-03-01",
    "location": "Paris",
    "maxAttempts": 3,
    # ⚠️ LES QUATRE PLACES DU BARÈME, essais ou pas (FRE-147). La fixture n'en
    # disputait que deux : depuis que `competition_scores` borne le barème aux
    # épreuves qui disputent ce qu'il note, c'était une compétition dont le
    # RIS ne pouvait plus exister. Les scores, eux, ne bougent pas — personne
    # ne tente le tirage ni les dips.
    "movementNames": ["MUSCLE UP", "PULL UP", "DIPS", "SQUAT"],
    "participants": [
        {
            "name": "Alice",
            "uid": "user-alice",  # résoluble → athlète lié
            "bodyweight": 62.5,
            "gender": "F",
            "weightCategory": "-63",  # code F valide du référentiel
            "movements": [
                {"name": "MUSCLE UP", "attempts": [
                    {"weight": 30, "result": "rep",
                     "weights": {"pessimistic": 28, "realistic": 30, "optimistic": 32}, "selectedTier": "realistic"},
                    {"weight": 34, "result": "norep", "norepReason": "too_heavy", "varUsed": True},
                    {"weight": 34, "result": ""},  # pas encore tenté
                ]},
                {"name": "SQUAT", "attempts": [{"weight": 100, "result": "rep"}]},
            ],
        },
        {
            "name": "Bob invité",  # pas d'uid → invité
            "movements": [{"name": "SQUAT", "attempts": [{"weight": 120, "result": "rep"}]}],
        },
    ],
}


def _expected_doc(comp_id, created_by):
    """_DOC + dates (couple + compat), competesOn, et champs dérivés serveur."""
    import copy
    d = copy.deepcopy(_DOC)
    d["id"] = comp_id
    d["startDate"] = "2026-03-01"  # _DOC envoie `date` (compat) → start=end=date
    d["endDate"] = "2026-03-01"
    for p in d["participants"]:
        p["competesOn"] = None  # toujours renvoyé, null si non renseigné
    d["participants"][0]["score"] = 130.0  # MU best rep 30 + SQUAT 100 (34 norep ignoré)
    d["participants"][1]["score"] = 120.0
    # ⚠️ LE TOTAL DU BARÈME ÉGALE LE SCORE ICI, et c'est un hasard de fixture :
    # personne ne tente rien hors du barème, et les deux tirages restent vides.
    # Le jour où un mouvement annexe y entre, les deux nombres se sépareront —
    # c'est ce que `test_vue_ris.py` éprouve pour de bon.
    d["participants"][0]["risTotal"] = 130.0
    d["participants"][1]["risTotal"] = 120.0
    # Alice : 62,5 kg, F. Bob n'a ni poids ni genre → pas classable, et `None`
    # n'est PAS zéro (qui ferait de lui un dernier de classement).
    d["participants"][0]["ris"] = 51.452686403695445
    d["participants"][1]["ris"] = None
    # La projection (FRE-203) : le 3e muscle up d'Alice, annoncé à 34 sans plan,
    # reste à venir et vaut pour les trois hypothèses → 34 + 100. Bob a fini.
    d["participants"][0]["projection"] = {"pessimistic": 134.0, "realistic": 134.0, "optimistic": 134.0}
    d["participants"][1]["projection"] = {"pessimistic": 120.0, "realistic": 120.0, "optimistic": 120.0}
    d["flights"] = []
    d["editorEmails"] = []
    d["createdBy"] = created_by
    d["reglement"] = "fnsl"  # le règlement par défaut : la FNSL, comme avant qu'il existe
    d["participantUids"] = ["user-alice"]  # Bob sans uid exclu
    return d


# --------------------------------------------------------------------------- #
# Round-trip
# --------------------------------------------------------------------------- #


def test_round_trip_put_puis_get(auth_as, sql):
    client = auth_as(uid="coach-1")
    assert client.put("/competitions/c1", json=_DOC, headers=_AUTH).status_code == 200
    body = client.get("/competitions", headers=_AUTH).json()
    # La version est une empreinte : elle se compare, elle ne se prédit pas.
    assert isinstance(body[0].pop("version"), str)
    assert body == [_expected_doc("c1", "coach-1")]


def test_essai_non_tente_round_trip(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    # l'essai #3 d'Alice a result:'' → stocké NULL → recomposé ''
    alice = client.get("/competitions", headers=_AUTH).json()[0]["participants"][0]
    assert alice["movements"][0]["attempts"][2] == {"weight": 34.0, "result": ""}


def test_participant_uid_inconnu_athlete_null_nom_garde(auth_as, sql):
    client = auth_as(uid="coach-1")
    doc = {
        "name": "C", "date": "2026-03-01", "movementNames": ["SQUAT"],
        "participants": [{"name": "Inconnu", "uid": "pas-un-user",
                          "movements": [{"name": "SQUAT", "attempts": [{"weight": 90, "result": "rep"}]}]}],
    }
    client.put("/competitions/c1", json=doc, headers=_AUTH)
    p = client.get("/competitions", headers=_AUTH).json()[0]["participants"][0]
    assert p["name"] == "Inconnu"       # nom conservé
    assert "uid" not in p               # athlete_id NULL → pas d'uid recomposé
    # athlete_id NULL en base
    assert sql.execute(text("SELECT athlete_id FROM competition_participants")).scalar() is None


# --------------------------------------------------------------------------- #
# PATCH
# --------------------------------------------------------------------------- #


def test_patch_partiel_ne_touche_pas_le_reste(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    r = client.patch("/competitions/c1", json={"version": _v(client), "name": "Renommée"}, headers=_AUTH)
    assert r.status_code == 200
    got = client.get("/competitions", headers=_AUTH).json()[0]
    assert got["name"] == "Renommée"
    # participants / mouvements / essais intacts
    assert got["movementNames"] == _DOC["movementNames"]
    assert got["participants"] == _expected_doc("c1", "coach-1")["participants"]


def test_patch_movement_names_essais_coherents(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    # on réordonne les mouvements SANS renvoyer les participants
    r = client.patch("/competitions/c1", json={"version": _v(client), "movementNames": ["SQUAT", "MUSCLE UP"]}, headers=_AUTH)
    assert r.status_code == 200
    got = client.get("/competitions", headers=_AUTH).json()[0]
    assert got["movementNames"] == ["SQUAT", "MUSCLE UP"]
    # Alice garde ses essais sur les DEUX mouvements (remappés par nom), ordre = nouvelle position
    alice = got["participants"][0]
    assert [m["name"] for m in alice["movements"]] == ["SQUAT", "MUSCLE UP"]
    assert alice["score"] == 130.0  # inchangé (mêmes essais)


def test_patch_participants_seuls_mouvements_inchanges(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    # remplace les participants SANS toucher movementNames (rechargés)
    new_parts = [{"name": "Charlie",
                  "movements": [{"name": "SQUAT", "attempts": [{"weight": 200, "result": "rep"}]}]}]
    r = client.patch("/competitions/c1", json={"version": _v(client), "participants": new_parts}, headers=_AUTH)
    assert r.status_code == 200
    got = client.get("/competitions", headers=_AUTH).json()[0]
    assert got["movementNames"] == ["MUSCLE UP", "PULL UP", "DIPS", "SQUAT"]  # inchangés
    assert [p["name"] for p in got["participants"]] == ["Charlie"]
    assert got["participants"][0]["score"] == 200.0


# --------------------------------------------------------------------------- #
# Le mouvement retiré n'emporte plus les essais en silence (FRE-85)
# --------------------------------------------------------------------------- #

# ⚠️ CE COMPORTEMENT ÉTAIT SPÉCIFIÉ. Une spec nommée
# `test_patch_movement_retire_droppe_ses_essais` assertait la perte comme
# attendue, avec le score recalculé après. Elle décrivait fidèlement ce que le
# code faisait — un 200 et trois essais d'Alice évaporés — sans jamais demander
# si c'était souhaitable. Une spec qui grave un défaut le rend indiscutable :
# le corriger casse la suite, donc on ne le corrige pas.


def test_retirer_un_mouvement_PORTEUR_d_essais_est_refuse(auth_as, sql):
    """⚠️ LE DÉFAUT D'ORIGINE. `_write_children` résout le mouvement d'un essai par
    son NOM ; un essai dont le mouvement n'est plus listé était simplement sauté.
    Un `PATCH movementNames` amputé emportait donc les essais de TOUS les
    participants sur ce mouvement — 200, aucun signal, les charges avec."""
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)

    r = client.patch("/competitions/c1", json={"version": _v(client), "movementNames": ["SQUAT"]}, headers=_AUTH)
    assert r.status_code == 409
    assert r.json()["code"] == "essais_perdus"
    # Le COMPTE est dans le message : « des essais seraient perdus » n'aide pas à
    # décider, « 3 essais » si. Alice a trois essais sur MUSCLE UP, dont un
    # seulement porte un `result` — les deux autres portent une charge.
    assert "3" in r.json()["detail"]

    # ⚠️ ET RIEN N'A BOUGÉ. Le garde-fou est placé AVANT `_clear_children` : une
    # fois les enfants supprimés, refuser ne rendrait plus les essais.
    got = client.get("/competitions", headers=_AUTH).json()[0]
    assert got["movementNames"] == _DOC["movementNames"]
    assert got["participants"][0]["score"] == 130.0


def test_retirer_un_mouvement_EN_retirant_ses_essais_passe(auth_as, sql):
    """La voie reste ouverte : c'est le geste qui devient explicite, pas interdit.
    L'appelant envoie `movementNames` ET des participants dont les essais sur le
    mouvement retiré ont disparu — il assume alors ce qu'il détruit."""
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)

    sans_mu = [
        {**p, "movements": [m for m in p["movements"] if m["name"] != "MUSCLE UP"]}
        for p in _DOC["participants"]
    ]
    r = client.patch(
        "/competitions/c1",
        json={"version": _v(client), "movementNames": ["SQUAT"], "participants": sans_mu},
        headers=_AUTH,
    )
    assert r.status_code == 200
    got = client.get("/competitions", headers=_AUTH).json()[0]
    assert got["movementNames"] == ["SQUAT"]
    assert [m["name"] for m in got["participants"][0]["movements"]] == ["SQUAT"]
    assert got["participants"][0]["score"] == 100.0


def test_retirer_un_mouvement_SANS_essai_saisi_passe(auth_as, sql):
    """⚠️ LES LIGNES VIDES NE SONT PAS DES ESSAIS. Le front crée douze essais vides
    en ajoutant un participant (`createEmptyParticipant`) : les compter ferait
    refuser une écriture qui ne détruit rien, et le garde-fou deviendrait une
    gêne au lieu d'une protection.

    ⚠️ ET LE VIDE N'EST PAS NULL — le défaut le plus répété de ce projet, qui
    attendait exactement ici. Un essai vierge arrive en `{weight: 0, result: ''}`,
    JAMAIS en NULL : le schéma exige `weight`. Un garde-fou qui teste « non NULL »
    compte donc chaque placeholder comme une saisie."""
    client = auth_as(uid="coach-1")
    doc = {
        "name": "C", "date": "2026-03-01", "movementNames": ["MUSCLE UP", "SQUAT"],
        "participants": [{
            "name": "Alice",
            "movements": [
                # Exactement ce que produit `createEmptyParticipant`.
                {"name": "MUSCLE UP", "attempts": [
                    {"weight": 0, "result": ""}, {"weight": 0, "result": ""}]},
                {"name": "SQUAT", "attempts": [{"weight": 100, "result": "rep"}]},
            ],
        }],
    }
    client.put("/competitions/c1", json=doc, headers=_AUTH)

    r = client.patch("/competitions/c1", json={"version": _v(client), "movementNames": ["SQUAT"]}, headers=_AUTH)
    assert r.status_code == 200
    assert client.get("/competitions", headers=_AUTH).json()[0]["movementNames"] == ["SQUAT"]


def test_retirer_un_PARTICIPANT_porteur_d_essais_reste_permis(auth_as, sql):
    """⚠️ ON NE REFUSE PAS TOUTE DESTRUCTION, CE SERAIT CASSER UNE FONCTION LIVRÉE.
    Le front offre de retirer un participant (`competition-detail.tsx:381`,
    derrière une confirmation), et ses essais partent avec lui. L'appelant
    l'EXPRIME en l'omettant ; c'est la destruction que personne n'a demandée qui
    est refusée, pas celle qu'on demande."""
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)

    r = client.patch(
        "/competitions/c1",
        json={"version": _v(client), "participants": [_DOC["participants"][0]]},  # Bob et son SQUAT sautent
        headers=_AUTH,
    )
    assert r.status_code == 200
    got = client.get("/competitions", headers=_AUTH).json()[0]
    assert [p["name"] for p in got["participants"]] == ["Alice"]


def test_vider_les_participants_reste_permis(auth_as, sql):
    """Retirer le DERNIER participant est le même geste, et le front le produit
    (`participants.filter(...)` sur une liste d'un seul élément)."""
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)

    r = client.patch("/competitions/c1", json={"version": _v(client), "participants": []}, headers=_AUTH)
    assert r.status_code == 200
    assert client.get("/competitions", headers=_AUTH).json()[0]["participants"] == []


def test_ajouter_un_mouvement_ne_detruit_rien(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)

    r = client.patch(
        "/competitions/c1", json={"version": _v(client), "movementNames": ["MUSCLE UP", "SQUAT", "DIPS"]}, headers=_AUTH)
    assert r.status_code == 200
    got = client.get("/competitions", headers=_AUTH).json()[0]
    assert got["movementNames"] == ["MUSCLE UP", "SQUAT", "DIPS"]
    assert got["participants"][0]["score"] == 130.0  # les essais sont intacts


def test_patch_sans_mouvements_ni_participants_ne_declenche_rien(auth_as, sql):
    """Un patch de méta seule ne passe pas par la réinsertion des enfants : le
    garde-fou ne doit pas s'y inviter."""
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)

    r = client.patch("/competitions/c1", json={"version": _v(client), "location": "Lyon"}, headers=_AUTH)
    assert r.status_code == 200
    assert client.get("/competitions", headers=_AUTH).json()[0]["location"] == "Lyon"


def test_le_PUT_refuse_un_essai_sur_un_mouvement_non_liste(auth_as, sql):
    """⚠️ LA MÊME RÈGLE SUR LA CRÉATION-REMPLACEMENT. Le `PUT` décompose le payload
    tel qu'il est : un essai sur un mouvement absent de `movementNames` était sauté
    sans un mot, et l'appelant croyait l'avoir écrit."""
    client = auth_as(uid="coach-1")
    doc = {
        "name": "C", "date": "2026-03-01", "movementNames": ["SQUAT"],
        "participants": [{
            "name": "Alice",
            "movements": [{"name": "MUSCLE UP", "attempts": [{"weight": 30, "result": "rep"}]}],
        }],
    }
    r = client.put("/competitions/c1", json=doc, headers=_AUTH)
    assert r.status_code == 409
    assert r.json()["code"] == "essais_perdus"


def test_le_PUT_de_CREATION_ne_declenche_rien(auth_as, sql):
    """Sur un id inexistant, il n'y a rien à détruire — et une création cohérente
    ne doit pas être prise pour une amputation."""
    r = auth_as(uid="coach-1").put("/competitions/c1", json=_DOC, headers=_AUTH)
    assert r.status_code == 200


def test_put_id_invalide_422(auth_as, sql):
    r = auth_as(uid="coach-1").put("/competitions/a.b", json=_DOC, headers=_AUTH)
    assert r.status_code == 422


def test_patch_movement_names_renforcement_422(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    r = client.patch("/competitions/c1", json={"version": _v(client), "movementNames": ["SQUAT", "LEG CURL"]}, headers=_AUTH)
    assert r.status_code == 422
    # inchangé
    assert client.get("/competitions", headers=_AUTH).json()[0]["movementNames"] == _DOC["movementNames"]


# --------------------------------------------------------------------------- #
# Validation mouvements de compétition
# --------------------------------------------------------------------------- #


def test_put_movement_renforcement_422_rien_ecrit(auth_as, sql):
    client = auth_as(uid="coach-1")
    doc = {"name": "C", "date": "2026-03-01", "movementNames": ["SQUAT", "LEG CURL"], "participants": []}
    r = client.put("/competitions/c1", json=doc, headers=_AUTH)
    assert r.status_code == 422
    assert "LEG CURL" in r.json()["detail"]
    # transaction annulée : rien écrit
    assert _count(sql, "competitions") == 0
    assert _count(sql, "competition_movements") == 0


def test_put_movement_casse_insensible(auth_as, sql):
    client = auth_as(uid="coach-1")
    doc = {"name": "C", "date": "2026-03-01", "movementNames": ["squat", "Muscle Up"], "participants": []}
    r = client.put("/competitions/c1", json=doc, headers=_AUTH)
    assert r.status_code == 200  # 'squat'/'Muscle Up' matchent SQUAT/MUSCLE UP (upper)


# --------------------------------------------------------------------------- #
# Autorisation
# --------------------------------------------------------------------------- #


def test_coach_non_createur_peut_editer(auth_as, sql):
    auth_as(uid="coach-1").put("/competitions/c1", json=_DOC, headers=_AUTH)
    # coach-2 (pas le créateur) édite → 200
    r = auth_as(uid="coach-2").patch("/competitions/c1", json={"name": "Par coach-2", "version": _v(auth_as(uid="coach-2"))}, headers=_AUTH)
    assert r.status_code == 200
    assert auth_as(uid="coach-2").put("/competitions/c1", json=_DOC, headers=_AUTH).status_code == 200
    # createdBy reste coach-1 (préservé)
    assert auth_as(uid="coach-2").get("/competitions", headers=_AUTH).json()[0]["createdBy"] == "coach-1"


def test_un_coach_NON_createur_peut_supprimer(auth_as, sql):
    """⚠️ C'ÉTAIT RÉSERVÉ AU CRÉATEUR, ET LE FRONT NE LE SAVAIT PAS (FRE-85).
    Il offre le bouton à tout coach (`canDelete={canWrite}`) : sur 8 compétitions
    de production issues de 4 créateurs distincts, un coach voyait donc une action
    qui lui rendait un 403.

    C'est l'autorisation qui s'aligne, pas l'écran — décision de William le 29/08.
    Le staff est une poignée de personnes qui se parlent ; arbitrer entre elles
    par le code inventerait une frontière que l'usage ne demande pas."""
    auth_as(uid="coach-1").put("/competitions/c1", json=_DOC, headers=_AUTH)

    assert auth_as(uid="coach-2").delete("/competitions/c1", headers=_AUTH).status_code == 200
    assert _count(sql, "competitions") == 0
    # Et ça vide bien les enfants — c'est ce que le mot « destructif » recouvrait.
    assert _count(sql, "competition_attempts") == 0
    assert _count(sql, "competition_participants") == 0


def test_createdBy_survit_a_l_ouverture(auth_as, sql):
    """⚠️ `created_by` N'EST PLUS UNE AUTORISATION, MAIS RESTE UNE DONNÉE. Il est
    exposé en lecture, et la FK RESTRICT qui empêche de rétrograder un coach
    propriétaire de compétitions s'appuie dessus (`users.py`). L'ouverture ne
    devait pas l'emporter au passage."""
    auth_as(uid="coach-1").put("/competitions/c1", json=_DOC, headers=_AUTH)
    auth_as(uid="coach-2").patch("/competitions/c1", json={"name": "Par coach-2", "version": _v(auth_as(uid="coach-2"))}, headers=_AUTH)
    assert auth_as(uid="coach-2").get("/competitions", headers=_AUTH).json()[0]["createdBy"] == "coach-1"


def test_non_coach_refuse_partout(auth_as, sql):
    auth_as(uid="coach-1").put("/competitions/c1", json=_DOC, headers=_AUTH)
    intrus = auth_as(uid="pas-coach")  # absent de coaches
    assert intrus.put("/competitions/c2", json=_DOC, headers=_AUTH).status_code == 403
    assert intrus.patch("/competitions/c1", json={"name": "X", "version": "x"}, headers=_AUTH).status_code == 403
    # ⚠️ L'OUVERTURE S'ARRÊTE AUX COACHS. Elle porte sur QUI parmi le staff, pas
    # sur l'entrée dans le staff — sans cette ligne, « n'importe quel coach » se
    # serait discrètement changé en « n'importe qui ».
    assert intrus.delete("/competitions/c1", headers=_AUTH).status_code == 403
    assert _count(sql, "competitions") == 1


# --------------------------------------------------------------------------- #
# Dates (startDate / endDate) + competesOn
# --------------------------------------------------------------------------- #


def _minimal(start=None, end=None, date=None, participants=None):
    doc = {"name": "C", "movementNames": ["SQUAT"], "participants": participants or []}
    if date is not None:
        doc["date"] = date
    if start is not None:
        doc["startDate"] = start
    if end is not None:
        doc["endDate"] = end
    return doc


def test_create_start_seul_end_defaut(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_minimal(start="2026-05-10"), headers=_AUTH)
    c = client.get("/competitions", headers=_AUTH).json()[0]
    assert (c["startDate"], c["endDate"], c["date"]) == ("2026-05-10", "2026-05-10", "2026-05-10")


def test_create_deux_dates_conservees(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_minimal(start="2026-05-10", end="2026-05-11"), headers=_AUTH)
    c = client.get("/competitions", headers=_AUTH).json()[0]
    assert (c["startDate"], c["endDate"], c["date"]) == ("2026-05-10", "2026-05-11", "2026-05-10")


def test_compat_date_seul(auth_as, sql):
    # ancien front : `date` seul → startDate = endDate = date ; GET renvoie les 3
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_minimal(date="2026-05-10"), headers=_AUTH)
    c = client.get("/competitions", headers=_AUTH).json()[0]
    assert (c["startDate"], c["endDate"], c["date"]) == ("2026-05-10", "2026-05-10", "2026-05-10")


def test_end_avant_start_422(auth_as, sql):
    client = auth_as(uid="coach-1")
    r = client.put("/competitions/c1", json=_minimal(start="2026-05-11", end="2026-05-10"), headers=_AUTH)
    assert r.status_code == 422
    assert _count(sql, "competitions") == 0


def _part_on(day):
    return {"name": "Alice", "uid": "user-alice", "competesOn": day,
            "movements": [{"name": "SQUAT", "attempts": [{"weight": 100, "result": "rep"}]}]}


def test_competes_on_hors_plage_422(auth_as, sql):
    client = auth_as(uid="coach-1")
    # compét 10–11, participant sur le 12 → hors plage
    doc = _minimal(start="2026-05-10", end="2026-05-11", participants=[_part_on("2026-05-12")])
    r = client.put("/competitions/c1", json=doc, headers=_AUTH)
    assert r.status_code == 422 and "Alice" in r.json()["detail"]
    assert _count(sql, "competitions") == 0  # rien écrit


def test_competes_on_dans_plage_persiste_et_relu(auth_as, sql):
    client = auth_as(uid="coach-1")
    doc = _minimal(start="2026-05-10", end="2026-05-11", participants=[_part_on("2026-05-11")])
    assert client.put("/competitions/c1", json=doc, headers=_AUTH).status_code == 200
    p = client.get("/competitions", headers=_AUTH).json()[0]["participants"][0]
    assert p["competesOn"] == "2026-05-11"


def test_patch_dates_seules_participants_intacts(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    before = (_count(sql, "competition_participants"), _count(sql, "competition_attempts"))
    r = client.patch("/competitions/c1", json={"version": _v(client), "startDate": "2026-03-01", "endDate": "2026-03-02"}, headers=_AUTH)
    assert r.status_code == 200
    # participants/essais non touchés (mêmes lignes)
    assert (_count(sql, "competition_participants"), _count(sql, "competition_attempts")) == before
    c = client.get("/competitions", headers=_AUTH).json()[0]
    assert (c["startDate"], c["endDate"]) == ("2026-03-01", "2026-03-02")
    assert c["participants"] == _expected_doc("c1", "coach-1")["participants"]


def test_patch_retrecit_sous_competes_on_422_rien_ecrit(auth_as, sql):
    client = auth_as(uid="coach-1")
    # compét 10–12 avec Alice qui passe le 12
    doc = _minimal(start="2026-05-10", end="2026-05-12", participants=[_part_on("2026-05-12")])
    client.put("/competitions/c1", json=doc, headers=_AUTH)
    # on rétrécit la fin au 11 → le 12 d'Alice devient hors bornes
    r = client.patch("/competitions/c1", json={"version": _v(client), "endDate": "2026-05-11"}, headers=_AUTH)
    assert r.status_code == 422 and "Alice" in r.json()["detail"]
    # rien écrit : la fin reste au 12
    assert client.get("/competitions", headers=_AUTH).json()[0]["endDate"] == "2026-05-12"


def test_patch_location_et_max_attempts(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    r = client.patch("/competitions/c1", json={"version": _v(client), "location": "Lyon", "maxAttempts": 4}, headers=_AUTH)
    assert r.status_code == 200
    c = client.get("/competitions", headers=_AUTH).json()[0]
    assert c["location"] == "Lyon" and c["maxAttempts"] == 4


def test_patch_start_au_dela_de_la_fin_existante_422(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_minimal(start="2026-05-10"), headers=_AUTH)  # 10–10
    # patch startDate seul au 15 → fin existante (10) devient < début → 422
    r = client.patch("/competitions/c1", json={"version": _v(client), "startDate": "2026-05-15"}, headers=_AUTH)
    assert r.status_code == 422
    assert client.get("/competitions", headers=_AUTH).json()[0]["startDate"] == "2026-05-10"


def test_round_trip_deux_jours(auth_as, sql):
    client = auth_as(uid="coach-1")
    doc = {
        "name": "Championnat", "startDate": "2026-06-06", "endDate": "2026-06-07",
        "movementNames": ["SQUAT"],
        "participants": [
            {"name": "Alice", "uid": "user-alice", "competesOn": "2026-06-06",
             "movements": [{"name": "SQUAT", "attempts": [{"weight": 100, "result": "rep"}]}]},
            {"name": "Zoe", "competesOn": "2026-06-07",
             "movements": [{"name": "SQUAT", "attempts": [{"weight": 90, "result": "rep"}]}]},
        ],
    }
    client.put("/competitions/c1", json=doc, headers=_AUTH)
    got = client.get("/competitions", headers=_AUTH).json()[0]
    assert (got["startDate"], got["endDate"], got["date"]) == ("2026-06-06", "2026-06-07", "2026-06-06")
    assert [(p["name"], p["competesOn"]) for p in got["participants"]] == [
        ("Alice", "2026-06-06"), ("Zoe", "2026-06-07")]
    assert got["participantUids"] == ["user-alice"]


# --------------------------------------------------------------------------- #
# Catégorie de poids + motif de non-validation (422 avant écriture)
# --------------------------------------------------------------------------- #


def _part(name="P", gender=None, weightCategory=None, movements=None):
    p = {"name": name, "movements": movements or [
        {"name": "SQUAT", "attempts": [{"weight": 100, "result": "rep"}]}]}
    if gender is not None:
        p["gender"] = gender
    if weightCategory is not None:
        p["weightCategory"] = weightCategory
    return p


def _comp(participants):
    return {"name": "C", "date": "2026-05-10", "movementNames": ["SQUAT"], "participants": participants}


def test_categorie_valide_persistee(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_comp([_part("Alice", gender="F", weightCategory="-63")]), headers=_AUTH)
    p = client.get("/competitions", headers=_AUTH).json()[0]["participants"][0]
    assert (p["gender"], p["weightCategory"]) == ("F", "-63")


def test_categorie_hors_referentiel_422(auth_as, sql):
    client = auth_as(uid="coach-1")
    r = client.put("/competitions/c1", json=_comp([_part("Alice", gender="F", weightCategory="80")]), headers=_AUTH)
    assert r.status_code == 422 and "Alice" in r.json()["detail"]
    assert _count(sql, "competitions") == 0  # rien écrit


def test_categorie_masculine_sur_femme_422(auth_as, sql):
    client = auth_as(uid="coach-1")
    # -80 est un code M → invalide pour une participante F
    r = client.put("/competitions/c1", json=_comp([_part("Alice", gender="F", weightCategory="-80")]), headers=_AUTH)
    assert r.status_code == 422
    assert _count(sql, "competitions") == 0


def test_categorie_sans_genre_422(auth_as, sql):
    client = auth_as(uid="coach-1")
    r = client.put("/competitions/c1", json=_comp([_part("Alice", weightCategory="-63")]), headers=_AUTH)  # pas de gender
    assert r.status_code == 422 and "genre" in r.json()["detail"]
    assert _count(sql, "competitions") == 0


def test_categorie_absente_ok(auth_as, sql):
    client = auth_as(uid="coach-1")
    assert client.put("/competitions/c1", json=_comp([_part("Alice")]), headers=_AUTH).status_code == 200


def test_norep_reason_sur_rep_422(auth_as, sql):
    client = auth_as(uid="coach-1")
    parts = [_part("Alice", movements=[{"name": "SQUAT", "attempts": [
        {"weight": 100, "result": "rep", "norepReason": "too_heavy"}]}])]
    r = client.put("/competitions/c1", json=_comp(parts), headers=_AUTH)
    assert r.status_code == 422 and "SQUAT" in r.json()["detail"]
    assert _count(sql, "competitions") == 0


def test_norep_reason_sur_norep_persiste(auth_as, sql):
    client = auth_as(uid="coach-1")
    parts = [_part("Alice", movements=[{"name": "SQUAT", "attempts": [
        {"weight": 100, "result": "norep", "norepReason": "too_heavy"}]}])]
    assert client.put("/competitions/c1", json=_comp(parts), headers=_AUTH).status_code == 200
    att = client.get("/competitions", headers=_AUTH).json()[0]["participants"][0]["movements"][0]["attempts"][0]
    assert att["result"] == "norep" and att["norepReason"] == "too_heavy"


# --------------------------------------------------------------------------- #
# GET — visibilité (coach voit tout ; sinon seulement où l'on est participant)
# --------------------------------------------------------------------------- #


def _doc_sans_alice(name="Autre"):
    return {"name": name, "date": "2026-04-01", "movementNames": ["SQUAT"],
            "participants": [{"name": "Bob", "movements": [
                {"name": "SQUAT", "attempts": [{"weight": 100, "result": "rep"}]}]}]}


def test_get_coach_voit_tout(auth_as, sql):
    auth_as(uid="coach-1").put("/competitions/c1", json=_DOC, headers=_AUTH)  # créé par coach-1
    auth_as(uid="coach-1").put("/competitions/c2", json=_doc_sans_alice(), headers=_AUTH)
    # coach-2 (NON créateur) voit quand même les deux
    body = auth_as(uid="coach-2").get("/competitions", headers=_AUTH).json()
    assert {c["id"] for c in body} == {"c1", "c2"}


def test_get_athlete_ne_voit_que_les_siennes(auth_as, sql):
    auth_as(uid="coach-1").put("/competitions/c1", json=_DOC, headers=_AUTH)  # Alice participe
    auth_as(uid="coach-1").put("/competitions/c2", json=_doc_sans_alice(), headers=_AUTH)  # Alice absente
    # user-alice est participant de c1 seulement
    body = auth_as(uid="user-alice").get("/competitions", headers=_AUTH).json()
    assert [c["id"] for c in body] == ["c1"]


def test_get_MEMBRE_non_participant_liste_vide(auth_as, sql):
    """Un membre du club qui ne participe à rien voit une liste VIDE, pas un refus.
    C'est la moitié à ne pas casser en resserrant : la garde porte sur
    l'appartenance au club, pas sur la participation."""
    auth_as(uid="coach-1").put("/competitions/c1", json=_DOC, headers=_AUTH)
    semer_un_membre(sql, "user-bob", "athletes")
    r = auth_as(uid="user-bob").get("/competitions", headers=_AUTH)
    assert r.status_code == 200 and r.json() == []


def test_get_refuse_a_un_compte_SANS_LIEN_avec_le_club(auth_as, sql):
    """⚠️ CETTE SPEC DISAIT L'INVERSE : elle attendait une liste vide, donc un 200,
    pour un compte sans aucun rapport avec le club. C'était l'accepter.

    La route était en `verify_token` seul, et Firebase n'impose aucun domaine :
    « authentifié » veut dire « existe chez Google ». Un inconnu obtenait donc un
    200, et surtout ses deux voisines lui rendaient la LISTE DES COACHS avec nom
    ou adresse e-mail, et leurs disponibilités jour par jour.

    Même défaut que la bibliothèque, fermé le 22/08 (230 entrées servies à tout
    compte Google), resté ouvert ici et sur deux routes voisines (FRE-141)."""
    auth_as(uid="coach-1").put("/competitions/c1", json=_DOC, headers=_AUTH)
    r = auth_as(uid="inconnu-du-club").get("/competitions", headers=_AUTH)
    assert r.status_code == 403
    assert r.json()["code"] == "reserve_aux_membres"


def test_les_disponibilites_ne_sortent_pas_du_club(auth_as, sql):
    """⚠️ LA ROUTE QUI FUYAIT LE PLUS. Elle énumère les coachs avec
    `COALESCE(display_name, email, uid)` : sans nom d'affichage, c'est l'ADRESSE
    E-MAIL du coach qui sortait, à tout compte Google du monde."""
    auth_as(uid="coach-1").put("/competitions/c1", json=_DOC, headers=_AUTH)
    for chemin in ("/competitions/c1/availability", "/competitions/coach-availability"):
        r = auth_as(uid="inconnu-du-club").get(chemin, headers=_AUTH)
        assert r.status_code == 403, chemin
        assert r.json()["code"] == "reserve_aux_membres", chemin


# --------------------------------------------------------------------------- #
# Champs dérivés serveur → 422 si envoyés
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("field,value", [
    ("createdBy", "hacker"),
    ("participantUids", ["x"]),
])
def test_put_champ_derive_serveur_422(auth_as, sql, field, value):
    client = auth_as(uid="coach-1")
    doc = {"name": "C", "date": "2026-03-01", "movementNames": ["SQUAT"], "participants": [], field: value}
    assert client.put("/competitions/c1", json=doc, headers=_AUTH).status_code == 422


def test_put_score_participant_422(auth_as, sql):
    client = auth_as(uid="coach-1")
    doc = {"name": "C", "date": "2026-03-01", "movementNames": ["SQUAT"],
           "participants": [{"name": "P", "score": 10, "movements": []}]}
    assert client.put("/competitions/c1", json=doc, headers=_AUTH).status_code == 422


def test_le_score_est_celui_de_la_vue_meme_quand_la_casse_divise_un_mouvement(auth_as, sql):
    """⚠️ UNE SEULE DÉFINITION DU SCORE : la vue `competition_scores`.

    `competition_movements` est unique sur le TEXTE du mouvement : « SQUAT » et
    « Squat » y coexistent, et le validateur les accepte tous deux. La vue les
    agrège sur `upper(...)` — un mouvement, le plus lourd des deux. Un calcul
    refait en Python sur le nom brut les additionnerait (210 au lieu de 110)."""
    client = auth_as(uid="coach-1")
    doc = {"name": "C", "date": "2026-03-01", "movementNames": ["SQUAT", "Squat"],
           "participants": [{"name": "P", "movements": [
               {"name": "SQUAT", "attempts": [{"weight": 100, "result": "rep"}]},
               {"name": "Squat", "attempts": [{"weight": 110, "result": "rep"}]},
           ]}]}
    assert client.put("/competitions/c1", json=doc, headers=_AUTH).status_code == 200
    got = client.get("/competitions", headers=_AUTH).json()[0]
    assert got["participants"][0]["score"] == 110.0


def test_recompose_all_se_borne_a_UNE_competition_quand_on_la_nomme(auth_as, sql):
    """`version_actuelle` relit la version d'une compétition DANS sa transaction
    d'écriture, sous verrou : relire le club entier pour n'en garder qu'une
    faisait dix SELECT globaux par PATCH (FRE-222).

    MUTATION QUI ROUGIT : retirer le `WHERE :cid` d'une des cinq lectures."""
    from app.competitions import metier_competitions as metier
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    client.put("/competitions/c2", json={**_DOC, "name": "Autre"}, headers=_AUTH)
    cid = sql.execute(text("SELECT id FROM competitions WHERE legacy_id = 'c1'")).scalar()
    assert [c["id"] for c in metier.recompose_all(sql)] == ["c1", "c2"]
    [seule] = metier.recompose_all(sql, cid=cid)
    assert seule["id"] == "c1"
    # Bornée, elle rend le MÊME document que la lecture globale — version comprise.
    assert seule == next(c for c in metier.recompose_all(sql) if c["id"] == "c1")


def test_le_reglement_se_choisit_a_la_creation_et_se_change_apres(auth_as, sql):
    """Une compétition se joue sous UN règlement — FNSL par défaut, FinalRep si
    on le dit — et le front n'en propose que les motifs de « no rep »."""
    client = auth_as(uid="coach-1")
    assert client.put("/competitions/c1", json={**_DOC, "reglement": "finalrep"}, headers=_AUTH).status_code == 200
    assert client.get("/competitions", headers=_AUTH).json()[0]["reglement"] == "finalrep"
    r = client.patch("/competitions/c1", json={"version": _v(client), "reglement": "fnsl"}, headers=_AUTH)
    assert r.status_code == 200 and r.json()["written"] == ["reglement"]
    assert client.get("/competitions", headers=_AUTH).json()[0]["reglement"] == "fnsl"
    # Un règlement inconnu n'existe pas : refusé avant d'écrire.
    assert client.patch("/competitions/c1", json={"version": _v(client), "reglement": "ipf"}, headers=_AUTH).status_code == 422
    # Un motif FinalRep s'enregistre comme un motif FNSL : la clé étrangère les connaît tous.
    doc = {**_DOC, "reglement": "finalrep", "participants": [{"name": "P", "movements": [
        {"name": "SQUAT", "attempts": [{"weight": 100, "result": "norep", "norepReason": "fr_depth"}]}]}]}
    assert client.put("/competitions/c2", json=doc, headers=_AUTH).status_code == 200
    att = next(c for c in client.get("/competitions", headers=_AUTH).json() if c["id"] == "c2")["participants"][0]["movements"][0]["attempts"][0]
    assert att["norepReason"] == "fr_depth"


def test_comp_absente_404(auth_as, sql):
    client = auth_as(uid="coach-1")
    assert client.patch("/competitions/nope", json={"name": "X", "version": "x"}, headers=_AUTH).status_code == 404
    assert client.delete("/competitions/nope", headers=_AUTH).status_code == 404


# --------------------------------------------------------------------------- #
# LES CLÉS DE SORTIE, figées AVANT le `response_model` (FRE-70, vague 4)
#
# ⚠️ Un `response_model` FILTRE : un champ non déclaré disparaît sans erreur ni
# journal. `test_round_trip_put_puis_get` protège déjà l'essentiel — il compare le
# document ENTIER — mais il le fait sur un doc où tout est renseigné. Les specs
# ci-dessous disent l'autre moitié : ce qui doit être OMIS quand ce n'est pas
# renseigné, et ce qui doit rester présent même vide.
# --------------------------------------------------------------------------- #


def test_une_competition_porte_TOUS_ses_champs(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    comp = client.get("/competitions", headers=_AUTH).json()[0]

    assert set(comp) == {
        "id", "name", "startDate", "endDate", "date", "location", "maxAttempts", "reglement",
        "movementNames", "participants", "flights", "editorEmails", "createdBy", "participantUids", "version"}
    # `editorEmails` n'est lu par personne et vaut toujours `[]` — il reste au
    # contrat parce que le retirer CHANGERAIT le format sur le fil, ce qu'une
    # simple déclaration de modèle n'a pas à faire.
    assert comp["editorEmails"] == []
    # `date` DOUBLONNE `startDate` par compatibilité : le front s'en sert encore.
    assert comp["date"] == comp["startDate"]


def test_un_participant_RENSEIGNE_porte_tous_ses_champs(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    alice = client.get("/competitions", headers=_AUTH).json()[0]["participants"][0]

    assert set(alice) == {"name", "uid", "bodyweight", "gender", "weightCategory",
                          "competesOn", "movements", "score", "ris", "risTotal", "projection"}
    assert set(alice["movements"][0]) == {"name", "attempts"}


def test_un_participant_NU_omet_ses_optionnels_mais_garde_competesOn_et_score(auth_as, sql):
    """⚠️ LA DISTINCTION QUI COMPTE ICI : `competesOn` et `score` sont TOUJOURS
    rendus — nuls ou vides — alors que `uid`, `bodyweight`, `gender` et
    `weightCategory` DISPARAISSENT quand ils ne sont pas renseignés.

    Ce n'est pas une inconséquence : le front lit `competesOn` pour le J−x du
    tableau de bord et `score` pour le classement, donc l'absence l'obligerait à
    se défendre. Les quatre autres ne se lisent que s'ils existent.

    Le contrat écrit à la main côté front les marquait pourtant TOUS optionnels,
    `competesOn` et `score` compris — il mentait sur ces deux-là."""
    client = auth_as(uid="coach-1")
    doc = {"name": "C", "date": "2026-03-01", "movementNames": ["SQUAT"],
           "participants": [{"name": "Sans rien", "movements": []}]}
    client.put("/competitions/c1", json=doc, headers=_AUTH)
    nu = client.get("/competitions", headers=_AUTH).json()[0]["participants"][0]

    assert set(nu) == {"name", "competesOn", "movements", "score", "ris", "risTotal", "projection"}
    # La projection aussi, TOUJOURS là : sans essai, elle vaut zéro partout (FRE-203).
    assert nu["projection"] == {"pessimistic": 0.0, "realistic": 0.0, "optimistic": 0.0}
    assert nu["competesOn"] is None and nu["score"] == 0.0
    # ⚠️ MÊME RÈGLE POUR LE RIS, ET LA MÊME RAISON : le front classe avec, donc
    # l'absence de clé l'obligerait à se défendre. Mais `ris` vaut `None` là où
    # `score` vaut `0.0` — un participant sans poids ni genre n'est pas
    # classable, ce qui n'est pas la même chose que « dernier ».
    assert nu["risTotal"] == 0.0 and nu["ris"] is None


def test_une_competition_SANS_LIEU_omet_la_cle(auth_as, sql):
    client = auth_as(uid="coach-1")
    doc = {"name": "C", "date": "2026-03-01", "movementNames": ["SQUAT"], "participants": []}
    client.put("/competitions/c1", json=doc, headers=_AUTH)
    assert "location" not in client.get("/competitions", headers=_AUTH).json()[0]


def test_un_essai_omet_ce_qui_n_est_pas_renseigne(auth_as, sql):
    """`weight` et `result` toujours ; `weights`, `selectedTier`, `norepReason`
    et `varUsed` seulement s'ils existent. Un essai pas encore tenté sort donc à
    deux clés — et `result` vaut `''`, pas `null` : c'est ce que le front type."""
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    essais = client.get("/competitions", headers=_AUTH).json()[0] \
        ["participants"][0]["movements"][0]["attempts"]

    assert set(essais[0]) == {"weight", "result", "weights", "selectedTier"}
    assert set(essais[1]) == {"weight", "result", "norepReason", "varUsed"}
    assert set(essais[2]) == {"weight", "result"}
    assert essais[2]["result"] == ""
    assert set(essais[0]["weights"]) == {"pessimistic", "realistic", "optimistic"}


# --------------------------------------------------------------------------- #
# Deux coachs sur un même plateau (FRE-162)
# --------------------------------------------------------------------------- #


def test_le_second_coach_a_enregistrer_est_REFUSE_et_n_efface_rien(auth_as, sql):
    """⚠️ LE PATCH REMPLACE PARTICIPANTS ET ESSAIS EN BLOC. Aubin et Théo ont chargé
    le plateau à la même version ; Aubin enregistre une barre pour Alice, puis
    Théo enregistre la sienne pour Bob depuis son état chargé — SANS la barre
    d'Aubin. Avant la garde, celle-ci disparaissait en silence.

    On ne permet pas la saisie concurrente (décision William, 16/09) : on rend le
    conflit visible. MUTATION QUI ROUGIT : retirer la comparaison de version."""
    aubin, theo = auth_as(uid="coach-1"), auth_as(uid="coach-2")
    aubin.put("/competitions/c1", json=_DOC, headers=_AUTH)
    lue = _v(aubin)

    import copy
    par_aubin = copy.deepcopy(_DOC["participants"])
    par_aubin[0]["movements"][0]["attempts"][2] = {"weight": 36, "result": "rep"}
    assert aubin.patch("/competitions/c1", json={"version": lue, "participants": par_aubin},
                       headers=_AUTH).status_code == 200

    par_theo = copy.deepcopy(_DOC["participants"])
    par_theo[1]["movements"][0]["attempts"][0] = {"weight": 105, "result": "rep"}
    r = theo.patch("/competitions/c1", json={"version": lue, "participants": par_theo}, headers=_AUTH)
    assert r.status_code == 409
    assert r.json()["code"] == "competition_perimee"

    alice = theo.get("/competitions", headers=_AUTH).json()[0]["participants"][0]
    assert alice["movements"][0]["attempts"][2] == {"weight": 36.0, "result": "rep"}


def test_la_version_rendue_par_le_PATCH_sert_au_suivant(auth_as, sql):
    """Un plateau enregistre plusieurs fois de suite : chaque PATCH doit rendre la
    version que le prochain présentera, sinon l'écran se refuserait lui-même.
    MUTATION QUI ROUGIT : rendre la version REÇUE au lieu de la relire."""
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    premiere = client.patch("/competitions/c1", json={"version": _v(client), "location": "Lyon"}, headers=_AUTH)
    assert premiere.status_code == 200
    seconde = client.patch("/competitions/c1", json={"version": premiere.json()["version"], "location": "Paris"},
                           headers=_AUTH)
    assert seconde.status_code == 200
    assert seconde.json()["version"] == _v(client)


def test_la_version_ne_bouge_pas_sans_ecriture_et_bouge_avec(auth_as, sql):
    """Une version qui changerait d'une lecture à l'autre ferait refuser des
    écritures légitimes ; une version qui ne bougerait pas après une écriture ne
    garderait rien."""
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_DOC, headers=_AUTH)
    avant = _v(client)
    assert _v(client) == avant
    client.patch("/competitions/c1", json={"version": avant, "location": "Lyon"}, headers=_AUTH)
    assert _v(client) != avant


# --------------------------------------------------------------------------- #
# LES FLIGHTS (FRE-204)
# --------------------------------------------------------------------------- #

_FLIGHTS = [
    {"name": "A", "categories": [{"gender": "M", "weightCategory": "-80"}]},
    {"name": "B", "categories": [{"gender": "F", "weightCategory": "-63"},
                                 {"gender": "M", "weightCategory": "-94"}]},
]


def _avec_flights(flights=None):
    import copy
    d = copy.deepcopy(_DOC)
    d["flights"] = copy.deepcopy(_FLIGHTS if flights is None else flights)
    # Bob, invité, concourt en -80.
    d["participants"][1].update({"gender": "M", "weightCategory": "-80"})
    return d


def _participants(client):
    return {p["name"]: p for p in client.get("/competitions", headers=_AUTH).json()[0]["participants"]}


def _flights(client):
    return client.get("/competitions", headers=_AUTH).json()[0]["flights"]


def test_les_flights_font_l_aller_retour_dans_leur_ordre(auth_as, sql):
    """L'ordre de la liste est l'ordre de passage : B est écrit après A, il passe après.

    MUTATION QUI ROUGIT : oublier `replace_flights` dans le PUT — la liste revient vide."""
    client = auth_as(uid="coach-1")
    assert client.put("/competitions/c1", json=_avec_flights(list(reversed(_FLIGHTS))),
                      headers=_AUTH).status_code == 200
    assert [f["name"] for f in _flights(client)] == ["B", "A"]
    cles = lambda cats: {(c["gender"], c["weightCategory"]) for c in cats}  # noqa: E731
    assert cles(_flights(client)[0]["categories"]) == cles(_FLIGHTS[1]["categories"])


def test_un_athlete_passe_dans_le_flight_de_sa_categorie(auth_as, sql):
    """Le flight se DÉDUIT de la catégorie : rien à saisir par athlète.

    MUTATION QUI ROUGIT : ne pas poser `flight` à la recomposition."""
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_avec_flights(), headers=_AUTH)
    p = _participants(client)
    assert (p["Alice"]["flight"], p["Bob invité"]["flight"]) == ("B", "A")


def test_changer_de_categorie_change_de_flight(auth_as, sql):
    """Le flight n'est pas stocké sur le participant : il suit sa catégorie."""
    client = auth_as(uid="coach-1")
    doc = _avec_flights()
    client.put("/competitions/c1", json=doc, headers=_AUTH)
    doc["participants"][1]["weightCategory"] = "-94"
    client.put("/competitions/c1", json=doc, headers=_AUTH)
    assert _participants(client)["Bob invité"]["flight"] == "B"


def test_une_categorie_sans_flight_ne_range_l_athlete_nulle_part(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_avec_flights([_FLIGHTS[0]]), headers=_AUTH)
    p = _participants(client)
    assert "flight" not in p["Alice"] and p["Bob invité"]["flight"] == "A"


def test_une_categorie_ne_passe_que_dans_un_flight(auth_as, sql):
    """Dans deux flights, l'athlète n'aurait pas de place dans l'ordre de passage.

    MUTATION QUI ROUGIT : retirer le contrôle — la clé primaire lève, et c'est un 500."""
    client = auth_as(uid="coach-1")
    doublon = [_FLIGHTS[0], {"name": "B", "categories": [{"gender": "M", "weightCategory": "-80"}]}]
    r = client.put("/competitions/c1", json=_avec_flights(doublon), headers=_AUTH)
    assert r.status_code == 422 and r.json()["code"] == "categorie_dans_deux_flights", r.text[:300]


def test_deux_flights_ne_portent_pas_le_meme_nom(auth_as, sql):
    """« A » et « a » sont le même flight sur une affiche."""
    client = auth_as(uid="coach-1")
    r = client.put("/competitions/c1", json=_avec_flights([_FLIGHTS[0], {"name": "a", "categories": []}]),
                   headers=_AUTH)
    assert r.status_code == 422 and r.json()["code"] == "flight_en_double", r.text[:300]


def test_une_categorie_de_flight_hors_referentiel_est_refusee(auth_as, sql):
    client = auth_as(uid="coach-1")
    r = client.put("/competitions/c1", json=_avec_flights(
        [{"name": "A", "categories": [{"gender": "F", "weightCategory": "-101"}]}]), headers=_AUTH)
    assert r.status_code == 422 and r.json()["code"] == "categorie_invalide", r.text[:300]


def test_un_patch_des_participants_garde_les_flights(auth_as, sql):
    """Les flights ne sont pas des enfants des participants : réécrire la feuille
    ne les emporte pas.

    MUTATION QUI ROUGIT : vider les flights dans `clear_children`."""
    client = auth_as(uid="coach-1")
    doc = _avec_flights()
    client.put("/competitions/c1", json=doc, headers=_AUTH)
    r = client.patch("/competitions/c1", json={"version": _v(client), "participants": doc["participants"]},
                     headers=_AUTH)
    assert r.status_code == 200, r.text[:300]
    assert [f["name"] for f in _flights(client)] == ["A", "B"]


def test_un_patch_des_flights_seuls_les_remplace_sans_toucher_la_feuille(auth_as, sql):
    """Et la version bouge : un second coach qui éditerait les flights d'hier serait refusé.

    MUTATION QUI ROUGIT : oublier `replace_flights` dans le PATCH."""
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_avec_flights(), headers=_AUTH)
    avant = _v(client)
    r = client.patch("/competitions/c1", json={"version": avant, "flights": [_FLIGHTS[1]]}, headers=_AUTH)
    assert r.status_code == 200, r.text[:300]
    assert [f["name"] for f in _flights(client)] == ["B"]
    assert _participants(client)["Alice"]["score"] == 130.0
    assert _v(client) != avant


def test_une_competition_avec_ses_flights_se_supprime(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_avec_flights(), headers=_AUTH)
    assert client.delete("/competitions/c1", headers=_AUTH).status_code == 200
    assert client.get("/competitions", headers=_AUTH).json() == []


# --------------------------------------------------------------------------- #
# UNE ANNONCE NE BAISSE PAS (FRE-204)
# --------------------------------------------------------------------------- #

def _squat(*essais):
    return {"name": "C", "date": "2026-03-01", "movementNames": ["SQUAT"],
            "participants": [{"name": "Alice", "movements": [{"name": "SQUAT", "attempts": list(essais)}]}]}


def test_une_annonce_plus_legere_qu_un_essai_precedent_est_refusee(auth_as, sql):
    """Après 102,5 manqué, 100 est refusé : on retente, on ne descend pas.

    MUTATION QUI ROUGIT : ne pas appeler la règle à l'écriture — 200."""
    r = auth_as(uid="coach-1").put("/competitions/c1", json=_squat(
        {"weight": 100, "result": "rep"}, {"weight": 102.5, "result": "norep"}, {"weight": 100, "result": ""}), headers=_AUTH)
    assert (r.status_code, r.json()["code"]) == (422, "annonce_en_baisse")
    assert "essai #3" in r.json()["detail"]


def test_retenter_la_meme_charge_apres_un_echec_est_permis(auth_as, sql):
    r = auth_as(uid="coach-1").put("/competitions/c1", json=_squat(
        {"weight": 100, "result": "rep"}, {"weight": 102.5, "result": "norep"}, {"weight": 102.5, "result": ""}), headers=_AUTH)
    assert r.status_code == 200, r.text[:300]


def test_le_plan_reste_libre_seule_l_annonce_compte(auth_as, sql):
    """Un plan P plus léger que l'essai précédent n'est qu'une hypothèse : tant
    qu'il n'est pas annoncé, rien n'est refusé.

    MUTATION QUI ROUGIT : comparer les charges du PLAN au lieu de l'annonce."""
    r = auth_as(uid="coach-1").put("/competitions/c1", json=_squat(
        {"weight": 100, "result": "rep"},
        {"weight": 0, "result": "", "weights": {"pessimistic": 95, "realistic": 102.5, "optimistic": 105}}), headers=_AUTH)
    assert r.status_code == 200, r.text[:300]


def test_la_baisse_est_refusee_aussi_par_un_patch(auth_as, sql):
    client = auth_as(uid="coach-1")
    client.put("/competitions/c1", json=_squat({"weight": 100, "result": "rep"}), headers=_AUTH)
    r = client.patch("/competitions/c1", json={"version": _v(client), "participants": _squat(
        {"weight": 100, "result": "rep"}, {"weight": 97.5, "result": ""})["participants"]}, headers=_AUTH)
    assert (r.status_code, r.json()["code"]) == (422, "annonce_en_baisse")
