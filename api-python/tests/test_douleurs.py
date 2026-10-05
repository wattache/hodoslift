"""Les douleurs suivies (FRE-195) — contre un VRAI Postgres.

Ce que ces specs cherchent à prouver, dans l'ordre d'importance :

  1. qu'une douleur d'un AUTRE athlète est inatteignable, même avec un
     `athlete_id` légitime dans l'URL. C'est le seul défaut ici qui serait une
     fuite de donnée de santé, pas un bug d'affichage ;
  2. que la même zone ne se suit pas deux fois en même temps — c'est tout
     l'objet du rattachement, et ce qui distingue cette feature d'un champ de
     plus dans le formulaire ;
  3. que « récurrente » se DÉDUIT du nombre de logs. Un booléen stocké aurait
     fini par contredire l'historique.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app

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
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def _declarer(uid="ath-1", legacy="leg-1", **corps):
    defaut = {"nom": "Mon épaule", "zone": "deltoids:droite"}
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
                                 json={"nom": "X", "zone": "chest:gauche"}).status_code == 403


# --------------------------------------------------------------------------- #
# 2. Une seule douleur vivante par zone
# --------------------------------------------------------------------------- #

def test_la_meme_zone_ne_se_suit_pas_DEUX_fois(monde):
    """⚠️ C'EST TOUT L'OBJET DU RATTACHEMENT. Sans ce refus, chaque signalement
    referait un îlot — exactement l'état d'avant, où sept athlètes ont saisi une
    fois chacun sans que rien ne se suive."""
    assert _declarer().status_code == 201
    r = _declarer(nom="Encore l'épaule")
    assert r.status_code == 409
    assert r.json()["code"] == "douleur_deja_suivie"


def test_une_douleur_CLOSE_libere_sa_zone(monde):
    """La même épaule peut refaire mal six mois plus tard, et c'est une NOUVELLE
    douleur — pas la reprise de l'ancienne, dont l'historique reste lisible."""
    premiere = _declarer().json()["id"]
    assert _client("ath-1").patch(f"/athletes/leg-1/douleurs/{premiere}",
                                  json={"fin": "2026-06-01"}).status_code == 200
    assert _declarer(nom="Elle revient").status_code == 201
    assert monde.execute(text("SELECT count(*) FROM douleurs")).scalar() == 2


def test_rouvrir_est_possible_mais_pas_en_double(monde):
    """⚠️ ROUVRIR EST UN CAS RÉEL : une douleur qu'on croyait passée revient. On
    l'autorise — mais pas si une autre tient déjà la zone entre-temps."""
    premiere = _declarer().json()["id"]
    _client("ath-1").patch(f"/athletes/leg-1/douleurs/{premiere}", json={"fin": "2026-06-01"})
    seconde = _declarer(nom="Elle revient").json()["id"]

    r = _client("ath-1").patch(f"/athletes/leg-1/douleurs/{premiere}", json={"fin": None})
    assert r.status_code == 409

    _client("ath-1").patch(f"/athletes/leg-1/douleurs/{seconde}", json={"fin": "2026-09-01"})
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
    assert lue["derniere"] == {"date": "2026-09-22", "intensite": 3, "commentaire": "ça passe", "entrainement": None}


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
    close = _declarer(nom="Ancienne", zone="knees:gauche").json()["id"]
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
        {"date": "2026-09-22", "intensite": 1, "commentaire": "jour 22", "entrainement": None},
        {"date": "2026-09-20", "intensite": 4, "commentaire": "jour 20", "entrainement": None},
        {"date": "2026-09-18", "intensite": 7, "commentaire": "jour 18", "entrainement": None},
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
        {"date": "2026-09-22", "intensite": 3, "commentaire": "ça passe", "entrainement": None}]


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
        {"date": "2026-09-20", "intensite": 5, "commentaire": None, "entrainement": None}]


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
        {"date": "2026-09-20", "intensite": 6, "commentaire": None, "entrainement": True}]


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
