"""Les douleurs suivies (FRE-195) — contre un VRAI Postgres.

Ce que ces specs cherchent à prouver, dans l'ordre d'importance :

  1. qu'une douleur d'un AUTRE athlète est inatteignable, même avec un
     `athlete_id` légitime dans l'URL. C'est le seul défaut ici qui serait une
     fuite de donnée de santé, pas un bug d'affichage ;
  2. qu'une douleur porte PLUSIEURS zones, en garde au moins une, et qu'une
     zone peut appartenir à deux douleurs vivantes (FRE-196) ;
  3. que « récurrente » se DÉDUIT du nombre de logs. Un booléen stocké aurait
     fini par contredire l'historique.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.chargeur_arbre import Arbre, load
from tests.conftest import client_de
from tests.fixtures_training import arbre_de_test

_A1 = "11111111-1111-1111-1111-111111111111"
_A2 = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def monde(pg):
    """Deux athlètes, deux coachs, un kiné. Le second athlète existe pour une
    seule raison : vérifier qu'on ne l'atteint pas depuis le premier."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1','a@x.fr'), ('coach-2','b@x.fr'), "
                    "('ath-1','c@x.fr'), ('ath-2','d@x.fr'), ('kine-1','k@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1'), ('coach-2')"))
    pg.execute(text("INSERT INTO kines (uid) VALUES ('kine-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, kine_uid, first_name, user_uid) VALUES "
        f"('{_A1}','leg-1','coach-1','kine-1','A','ath-1'),"
        f"('{_A2}','leg-2','coach-2',NULL,'B','ath-2')"))
    return pg


def _client(uid: str) -> TestClient:
    return client_de(uid)


def _declarer(uid="ath-1", legacy="leg-1", **corps):
    defaut = {"nom": "Mon épaule", "zones": ["deltoids:droite"]}
    return _client(uid).post(f"/athletes/{legacy}/douleurs", json={**defaut, **corps})


# --------------------------------------------------------------------------- #
# 1. La porte fermée
# --------------------------------------------------------------------------- #

def test_la_douleur_d_un_AUTRE_athlete_est_introuvable(monde):
    """LE test de cette feature. `require_athlete_access` autorise l'athlète du
    CHEMIN — elle ne dit rien de la douleur visée. Sans la remontée
    douleur → athlète, on noterait la douleur de quelqu'un d'autre en passant
    son propre `athlete_id`."""
    autre = _declarer(uid="ath-2", legacy="leg-2").json()["id"]

    r = _client("ath-1").put(f"/athletes/leg-1/douleurs/{autre}/logs/2026-09-22",
                             json={"intensite": 5})
    assert r.status_code == 404          # 404 et non 403 : on ne confirme rien
    assert monde.execute(text("SELECT count(*) FROM douleur_logs")).scalar() == 0


def test_un_tiers_n_entre_pas(monde):
    assert _client("coach-2").get("/athletes/leg-1/douleurs").status_code == 403


def test_le_STAFF_lit_mais_n_ecrit_pas(monde):
    """Le kiné et le coach voient — c'est la règle du suivi kiné, dont le guichet
    sert déjà les deux. Mais c'est l'ATHLÈTE qui dit où il a mal."""
    _declarer()
    for uid in ("kine-1", "coach-1"):
        assert _client(uid).get("/athletes/leg-1/douleurs").status_code == 200
        assert _client(uid).post("/athletes/leg-1/douleurs",
                                 json={"nom": "X", "zones": ["chest:gauche"]}).status_code == 403


# --------------------------------------------------------------------------- #
# 2. Les zones d'une douleur (FRE-196)
# --------------------------------------------------------------------------- #

def _zones(douleur_id):
    lu = _client("ath-1").get("/athletes/leg-1/douleurs").json()
    return next(d["zones"] for d in lu if d["id"] == douleur_id)


def test_une_douleur_porte_PLUSIEURS_zones(monde):
    """« Épaule + biceps », ce n'est pas dissociable : une douleur, deux zones."""
    d = _declarer(zones=["deltoids:droite", "biceps:droite"]).json()["id"]
    assert _zones(d) == ["biceps:droite", "deltoids:droite"]


def test_une_zone_deja_prise_PEUT_porter_une_autre_douleur(monde):
    """⚠️ UN CLAQUAGE DU BICEPS N'EST PAS LA VIEILLE ÉPAULE. Rattacher à
    l'existante est un choix que l'écran propose, pas une contrainte du serveur.
    MUTATION QUI ROUGIT : refuser une zone déjà tenue par une douleur vivante."""
    assert _declarer(zones=["deltoids:droite", "biceps:droite"]).status_code == 201
    assert _declarer(nom="Claquage", zones=["biceps:droite"]).status_code == 201
    assert monde.execute(text("SELECT count(*) FROM douleurs WHERE fin IS NULL")).scalar() == 2


def test_les_zones_se_REMPLACENT_au_patch(monde):
    d = _declarer().json()["id"]
    r = _client("ath-1").patch(f"/athletes/leg-1/douleurs/{d}",
                               json={"zones": ["deltoids:droite", "biceps:droite"]})
    assert r.status_code == 200 and r.json()["written"] == ["zones"]
    assert _zones(d) == ["biceps:droite", "deltoids:droite"]
    _client("ath-1").patch(f"/athletes/leg-1/douleurs/{d}", json={"zones": ["biceps:droite"]})
    assert _zones(d) == ["biceps:droite"]


@pytest.mark.parametrize("zones", [None, [], ["chest:gauche", "chest:gauche"]])
def test_une_douleur_garde_AU_MOINS_une_zone_et_sans_doublon(monde, zones):
    """⚠️ SANS ZONE, ELLE DISPARAÎT DE LA FIGURE SANS ÊTRE CLOSE — le « vide
    contre NULL » du projet, transposé.
    MUTATION QUI ROUGIT : laisser passer `zones: null` au patch."""
    d = _declarer().json()["id"]
    r = _client("ath-1").patch(f"/athletes/leg-1/douleurs/{d}", json={"zones": zones})
    assert r.status_code == 422
    assert _zones(d) == ["deltoids:droite"]
    if zones is not None:
        assert _declarer(zones=zones).status_code == 422


def test_rouvrir_une_douleur_est_possible(monde):
    """⚠️ ROUVRIR EST UN CAS RÉEL : une douleur qu'on croyait passée revient —
    même si une autre tient la zone entre-temps."""
    premiere = _declarer().json()["id"]
    _client("ath-1").patch(f"/athletes/leg-1/douleurs/{premiere}", json={"fin": "2026-06-01"})
    _declarer(nom="Elle revient")
    assert _client("ath-1").patch(f"/athletes/leg-1/douleurs/{premiere}",
                                  json={"fin": None}).status_code == 200


# --------------------------------------------------------------------------- #
# 3. Ce que la lecture DÉDUIT
# --------------------------------------------------------------------------- #

def test_recurrente_se_DEDUIT_du_nombre_de_logs(monde):
    """⚠️ AUCUNE COLONNE « RÉCURRENTE ». Notée une fois, c'est un signalement ;
    notée deux fois, ça revient. Un booléen saisi à côté du compte finirait par
    le contredire — et c'est le compte qui dit la vérité.

    MUTATION QUI ROUGIT : rendre `logs >= 1` au lieu de `> 1` — une douleur
    notée une seule fois se dirait récurrente."""
    d = _declarer().json()["id"]
    c = _client("ath-1")

    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-20", json={"intensite": 6})
    lue = c.get("/athletes/leg-1/douleurs").json()[0]
    assert lue["logs"] == 1 and lue["recurrente"] is False

    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-21", json={"intensite": 4})
    lue = c.get("/athletes/leg-1/douleurs").json()[0]
    assert lue["logs"] == 2 and lue["recurrente"] is True


def test_noter_DEUX_fois_le_meme_jour_remplace(monde):
    """La seconde note est une correction, pas un fait de plus : deux intensités
    le même jour pour la même épaule se contrediraient."""
    d = _declarer().json()["id"]
    c = _client("ath-1")
    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-22", json={"intensite": 8})
    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-22",
          json={"intensite": 3, "commentaire": "ça passe"})

    lue = c.get("/athletes/leg-1/douleurs").json()[0]
    assert lue["logs"] == 1
    assert lue["derniere"] == {"date": "2026-09-22", "intensite": 3, "commentaire": "ça passe", "entrainement": None, "exercices": []}


def test_ZERO_est_une_reponse(monde):
    """⚠️ « PLUS MAL AUJOURD'HUI » SE DIT. Sans le zéro, une douleur qui passe ne
    peut s'exprimer que par le silence — et le silence veut déjà dire « pas
    saisi »."""
    d = _declarer().json()["id"]
    r = _client("ath-1").put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-22",
                             json={"intensite": 0})
    assert r.status_code == 200
    assert _client("ath-1").get("/athletes/leg-1/douleurs").json()[0]["derniere"]["intensite"] == 0


def test_une_intensite_hors_bornes_est_refusee(monde):
    d = _declarer().json()["id"]
    for valeur in (11, -1):
        assert _client("ath-1").put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-22",
                                    json={"intensite": valeur}).status_code == 422


def test_un_commentaire_VIDE_devient_une_absence(monde):
    """⚠️ `''` N'EST PAS `NULL`, et c'est le défaut le plus répété du projet. Une
    case ouverte puis refermée ne doit pas laisser une chaîne vide que la base
    refuse et que l'écran afficherait comme un commentaire."""
    d = _declarer().json()["id"]
    r = _client("ath-1").put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-22",
                             json={"intensite": 5, "commentaire": "   "})
    assert r.status_code == 200
    assert monde.execute(text("SELECT commentaire FROM douleur_logs")).scalar() is None


def test_les_douleurs_VIVANTES_sortent_en_premier(monde):
    """Ce qu'on vient voir, c'est ce qui fait mal maintenant. Les closes restent
    lisibles en dessous : une épaule qui a fait mal six mois est un antécédent."""
    close = _declarer(nom="Ancienne", zones=["knees:gauche"]).json()["id"]
    _client("ath-1").patch(f"/athletes/leg-1/douleurs/{close}", json={"fin": "2026-05-01"})
    _declarer(nom="En cours")

    noms = [d["nom"] for d in _client("ath-1").get("/athletes/leg-1/douleurs").json()]
    assert noms == ["En cours", "Ancienne"]


def test_un_patch_vide_est_refuse(monde):
    d = _declarer().json()["id"]
    assert _client("ath-1").patch(f"/athletes/leg-1/douleurs/{d}", json={}).status_code == 422


# --------------------------------------------------------------------------- #
# L'HISTOIRE D'UNE DOULEUR — FRE-197
#
# La feature promet de suivre une douleur DANS LE TEMPS : c'est ce qui la
# distingue du signalement ponctuel qu'elle remplace. Jusqu'ici le contrat ne
# servait que la DERNIÈRE note et un compte ; l'historique existait en base et
# ne sortait jamais. Dix relevés de production sur dix portent un commentaire —
# c'est ce que le kiné vient lire.
# --------------------------------------------------------------------------- #

def test_l_historique_rend_TOUS_les_releves_du_plus_recent(monde):
    """MUTATION QUI ROUGIT : `ORDER BY log_date` au lieu de `DESC` — la suite
    part du plus vieux, et la carte ouvre sur une douleur d'il y a six mois."""
    d = _declarer().json()["id"]
    c = _client("ath-1")
    for jour, i in (("2026-09-18", 7), ("2026-09-20", 4), ("2026-09-22", 1)):
        c.put(f"/athletes/leg-1/douleurs/{d}/logs/{jour}",
              json={"intensite": i, "commentaire": f"jour {jour[-2:]}"})

    r = c.get(f"/athletes/leg-1/douleurs/{d}/logs")
    assert r.status_code == 200
    assert r.json() == [
        {"date": "2026-09-22", "intensite": 1, "commentaire": "jour 22", "entrainement": None, "exercices": []},
        {"date": "2026-09-20", "intensite": 4, "commentaire": "jour 20", "entrainement": None, "exercices": []},
        {"date": "2026-09-18", "intensite": 7, "commentaire": "jour 18", "entrainement": None, "exercices": []},
    ]


def test_une_correction_ne_fait_pas_DEUX_points(monde):
    """⚠️ NOTER DEUX FOIS LE MÊME JOUR EST UNE CORRECTION, pas un fait de plus.
    Deux points le même jour tracés sur une courbe raconteraient une douleur qui
    varie dans la journée — une histoire que personne n'a déclarée."""
    d = _declarer().json()["id"]
    c = _client("ath-1")
    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-22", json={"intensite": 8})
    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-22",
          json={"intensite": 3, "commentaire": "ça passe"})

    assert c.get(f"/athletes/leg-1/douleurs/{d}/logs").json() == [
        {"date": "2026-09-22", "intensite": 3, "commentaire": "ça passe", "entrainement": None, "exercices": []}]


def test_une_douleur_JAMAIS_notee_rend_une_liste_vide(monde):
    """⚠️ VIDE, PAS 404 : la douleur existe, elle n'a simplement rien à raconter.
    Une erreur ici ferait croire à un défaut là où il n'y a qu'un début."""
    d = _declarer().json()["id"]
    r = _client("ath-1").get(f"/athletes/leg-1/douleurs/{d}/logs")
    assert r.status_code == 200 and r.json() == []


def test_une_douleur_CLOSE_garde_son_histoire(monde):
    """⚠️ C'EST L'ANTÉCÉDENT QUE LE KINÉ VIENT CHERCHER. Une épaule qui a fait
    mal six mois raconte quelque chose même une fois close ; filtrer sur `fin`
    effacerait précisément ce qu'on garde ces relevés pour."""
    d = _declarer().json()["id"]
    c = _client("ath-1")
    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-20", json={"intensite": 5})
    c.patch(f"/athletes/leg-1/douleurs/{d}", json={"fin": "2026-09-21"})

    assert c.get(f"/athletes/leg-1/douleurs/{d}/logs").json() == [
        {"date": "2026-09-20", "intensite": 5, "commentaire": None, "entrainement": None, "exercices": []}]


def test_le_STAFF_lit_l_historique(monde):
    """Le coach ET le kiné, comme pour la liste : `owner_or_staff`. C'est le
    point de la fonctionnalité — l'athlète rapporte, son staff lit."""
    d = _declarer().json()["id"]
    _client("ath-1").put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-20",
                         json={"intensite": 5})

    for uid in ("coach-1", "kine-1"):
        r = _client(uid).get(f"/athletes/leg-1/douleurs/{d}/logs")
        assert r.status_code == 200, uid
        assert len(r.json()) == 1


def test_l_historique_d_un_AUTRE_athlete_est_introuvable(monde):
    """⚠️ LE MÊME DÉFAUT QUE POUR LA NOTE, SUR UNE AUTRE ROUTE — et c'est
    pourquoi il se reteste : `require_athlete_access` autorise l'athlète du
    CHEMIN, elle ne dit rien de la douleur visée. 404 et pas 403 : on ne
    confirme pas l'existence de ce qui ne vous regarde pas.

    MUTATION QUI ROUGIT : retirer l'appel à `_douleur_de_l_athlete` — les
    relevés de l'athlète B sortent avec l'`athlete_id` de A."""
    autre = _declarer(uid="ath-2", legacy="leg-2").json()["id"]
    _client("ath-2").put(f"/athletes/leg-2/douleurs/{autre}/logs/2026-09-20",
                         json={"intensite": 9, "commentaire": "privé"})

    r = _client("ath-1").get(f"/athletes/leg-1/douleurs/{autre}/logs")
    assert r.status_code == 404
    assert "privé" not in r.text


def test_un_tiers_ne_lit_pas_l_historique(monde):
    d = _declarer().json()["id"]
    _client("ath-1").put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-20",
                         json={"intensite": 5})
    assert _client("coach-2").get(f"/athletes/leg-1/douleurs/{d}/logs").status_code == 403


# --------------------------------------------------------------------------- #
# ENTRAÎNÉ OU NON, CE JOUR-LÀ — FRE-197
#
# « J'ai déjà eu des douleurs même hors training, persistantes » (William,
# 23/09). Distinguer une douleur qui suit une séance d'une douleur de fond est
# ce que le kiné cherche en premier devant une douleur qui dure.
# --------------------------------------------------------------------------- #

def test_le_jour_entraine_se_DECLARE_et_se_relit(monde):
    """MUTATION QUI ROUGIT : ne pas écrire `entrainement` dans l'upsert — la
    réponse de l'athlète est acceptée puis perdue, sans aucune erreur."""
    d = _declarer().json()["id"]
    c = _client("ath-1")
    r = c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-20",
              json={"intensite": 6, "entrainement": True})
    assert r.status_code == 200
    assert "entrainement" in r.json()["written"]

    assert c.get(f"/athletes/leg-1/douleurs/{d}/logs").json() == [
        {"date": "2026-09-20", "intensite": 6, "commentaire": None, "entrainement": True, "exercices": []}]


def test_UN_JOUR_SANS_n_est_pas_un_jour_NON_DIT(monde):
    """⚠️ LES TROIS ÉTATS, ET C'EST TOUT L'OBJET DE CETTE SPEC. `false` veut dire
    « je ne me suis pas entraîné », `None` veut dire « on ne m'a pas demandé ».
    Les confondre rangerait les onze relevés déjà en base parmi les journées de
    repos, que personne n'a déclarées — la confusion `''`/NULL du projet,
    appliquée à la seule question qui intéresse l'athlète.

    MUTATION QUI ROUGIT : donner `False` en défaut à `LogDouleur.entrainement`."""
    d = _declarer().json()["id"]
    c = _client("ath-1")
    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-20",
          json={"intensite": 6, "entrainement": False})
    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-21", json={"intensite": 5})

    logs = c.get(f"/athletes/leg-1/douleurs/{d}/logs").json()
    assert [l["entrainement"] for l in logs] == [None, False], logs
    # Et le jour non dit ne compte pas comme une réponse dans l'écriture.
    assert "entrainement" not in c.put(
        f"/athletes/leg-1/douleurs/{d}/logs/2026-09-22", json={"intensite": 4}).json()["written"]


def test_corriger_sa_note_peut_REMETTRE_la_question_a_non_dit(monde):
    """⚠️ LA RÉPONSE SE REMPLACE, `NULL` COMPRIS. Un COALESCE dans l'upsert
    figerait la première réponse pour toujours : on ne pourrait plus revenir
    sur un « oui » donné par erreur, alors que corriger sa note est le geste
    normal de cet écran.

    MUTATION QUI ROUGIT : `entrainement = COALESCE(EXCLUDED.entrainement,
    douleur_logs.entrainement)` — le `true` survit à la correction."""
    d = _declarer().json()["id"]
    c = _client("ath-1")
    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-20",
          json={"intensite": 6, "entrainement": True})
    c.put(f"/athletes/leg-1/douleurs/{d}/logs/2026-09-20", json={"intensite": 6})

    assert c.get(f"/athletes/leg-1/douleurs/{d}/logs").json()[0]["entrainement"] is None


# --------------------------------------------------------------------------- #
# 4. Signalée depuis une LIGNE DE SÉANCE (William, 27/10)
# --------------------------------------------------------------------------- #
#
# Ce que ces specs gardent, par ordre d'importance :
#   · la ligne d'un AUTRE athlète est introuvable, et rien ne s'écrit ;
#   · les exercices s'AJOUTENT à la note du jour, l'intensité se corrige ;
#   · le cliché survit à la ligne (semaine régénérée), le lien s'éteint.
# Vues rouges : `DO NOTHING` → `DO UPDATE` (la même ligne deux fois en faisait
# deux), `SET NULL` → `CASCADE` (la ligne supprimée emportait le cliché), la
# garde `entrainement is False` retirée (la contradiction passait).

@pytest.fixture
def seance(monde):
    """L'athlète A a un programme, et sa séance du 5 janvier porte les lignes
    réelles de `arbre_de_test` (SQUAT COMP 5×5 @ 100, PULL UP 8/10 fait 7…)."""
    monde.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                       "VALUES ('p1', 'coach-1', CAST(:a AS uuid))"), {"a": _A1})
    load(monde, Arbre(macros=arbre_de_test("p1")))
    return monde


def _ligne(conn, name: str) -> str:
    return str(conn.execute(text(
        "SELECT id FROM training_exercises WHERE name = :n ORDER BY position LIMIT 1"),
        {"n": name}).scalar())


def _noter(douleur_id: str, *, uid="ath-1", legacy="leg-1", jour="2026-01-05", **corps):
    return _client(uid).put(f"/athletes/{legacy}/douleurs/{douleur_id}/logs/{jour}",
                            json={"intensite": 5, **corps})


def _logs(douleur_id: str, *, uid="ath-1", legacy="leg-1") -> list[dict]:
    r = _client(uid).get(f"/athletes/{legacy}/douleurs/{douleur_id}/logs")
    assert r.status_code == 200, r.text
    return r.json()


def test_signalee_depuis_une_ligne_la_note_porte_son_CLICHE(seance):
    """Le cliché se prend côté serveur : le client n'envoie que l'identifiant."""
    d = _declarer().json()["id"]
    squat = _ligne(seance, "SQUAT")
    r = _noter(d, exercice={"exerciseId": squat}, entrainement=True)
    assert r.status_code == 200, r.text
    assert "exercice" in r.json()["written"]

    [note] = _logs(d)
    [ex] = note["exercices"]
    assert ex["exerciseId"] == squat and ex["ligneVivante"] is True
    assert (ex["name"], ex["variant"], ex["sets"], ex["reps"], ex["weight"]) == \
        ("SQUAT", ["COMP"], "5", "5", "100")
    # La LISTE porte le même cliché sur la dernière note.
    [douleur] = _client("ath-1").get("/athletes/leg-1/douleurs").json()
    assert douleur["derniere"]["exercices"][0]["name"] == "SQUAT"


def test_le_REALISE_vaut_quand_il_est_saisi_sinon_le_prescrit(seance):
    """PULL UP est prescrit 8/10 et fait 7 : la note dit 7 — la règle du guichet."""
    d = _declarer().json()["id"]
    _noter(d, exercice={"exerciseId": _ligne(seance, "PULL UP")})
    [ex] = _logs(d)[0]["exercices"]
    assert ex["reps"] == "7"


def test_deux_lignes_le_meme_jour_s_AJOUTENT_et_l_intensite_se_corrige(seance):
    """L'épaule gêne au squat (5) puis aux dips (7) : UNE note à 7, DEUX lignes."""
    d = _declarer().json()["id"]
    _noter(d, intensite=5, exercice={"exerciseId": _ligne(seance, "SQUAT")})
    _noter(d, intensite=7, exercice={"exerciseId": _ligne(seance, "DIPS")})
    [note] = _logs(d)
    assert note["intensite"] == 7
    assert [e["name"] for e in note["exercices"]] == ["SQUAT", "DIPS"]


def test_la_meme_ligne_deux_fois_ne_fait_qu_UNE_entree(seance):
    d = _declarer().json()["id"]
    squat = _ligne(seance, "SQUAT")
    _noter(d, exercice={"exerciseId": squat})
    _noter(d, exercice={"exerciseId": squat})
    assert len(_logs(d)[0]["exercices"]) == 1


def test_signaler_depuis_une_ligne_DIT_le_jour_entraine(seance):
    """Pas besoin de répondre à la question : signaler depuis la séance y répond."""
    d = _declarer().json()["id"]
    _noter(d, exercice={"exerciseId": _ligne(seance, "SQUAT")})
    assert _logs(d)[0]["entrainement"] is True


def test_un_exercice_avec_un_jour_SANS_est_une_contradiction(seance):
    d = _declarer().json()["id"]
    r = _noter(d, exercice={"exerciseId": _ligne(seance, "SQUAT")}, entrainement=False)
    assert r.status_code == 422 and r.json()["code"] == "corps_invalide"
    assert _logs(d) == []


def test_la_ligne_d_un_AUTRE_athlete_est_introuvable_et_rien_ne_s_ecrit(seance):
    """LE test de cette extension. B tient une douleur légitime et un identifiant
    de ligne volé à A : 404, et pas même la note du jour n'est écrite."""
    d = _declarer(uid="ath-2", legacy="leg-2").json()["id"]
    r = _noter(d, uid="ath-2", legacy="leg-2", exercice={"exerciseId": _ligne(seance, "SQUAT")})
    assert r.status_code == 404 and r.json()["code"] == "exercice_introuvable"
    assert _logs(d, uid="ath-2", legacy="leg-2") == []


def test_un_identifiant_de_ligne_mal_forme_est_un_422_pas_un_500(seance):
    d = _declarer().json()["id"]
    r = _noter(d, exercice={"exerciseId": "pas-un-uuid"})
    assert r.status_code == 422


def test_la_ligne_disparue_laisse_son_CLICHE_et_eteint_le_lien(seance):
    """La semaine se régénère, la ligne meurt ; la douleur, elle, reste."""
    d = _declarer().json()["id"]
    squat = _ligne(seance, "SQUAT")
    _noter(d, exercice={"exerciseId": squat})
    seance.execute(text("DELETE FROM training_exercises WHERE id = CAST(:x AS uuid)"), {"x": squat})
    [ex] = _logs(d)[0]["exercices"]
    assert ex["exerciseId"] is None and ex["ligneVivante"] is False
    assert ex["name"] == "SQUAT" and ex["weight"] == "100"


def test_le_tableau_des_signalements_porte_les_exercices(seance):
    """Le staff lit SUR QUOI ça a fait mal, par la même vue que la coche."""
    d = _declarer().json()["id"]
    _noter(d, exercice={"exerciseId": _ligne(seance, "SQUAT")})
    r = _client("coach-1").get("/athletes/signalements?jours=365")
    assert r.status_code == 200, r.text
    [s] = [s for s in r.json() if s["date"] == "2026-01-05"]
    assert s["douleurs"][0]["exercices"][0]["name"] == "SQUAT"


def test_notee_depuis_l_onglet_douleurs_la_note_n_a_AUCUN_exercice(seance):
    """`[]`, jamais `null` : l'absence a une seule forme."""
    d = _declarer().json()["id"]
    _noter(d)
    assert _logs(d)[0]["exercices"] == []
