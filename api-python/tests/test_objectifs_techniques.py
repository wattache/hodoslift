"""LES OBJECTIFS TECHNIQUES PAR MOUVEMENT (FRE-122).

⚠️ CE QUE CES SPECS GARDENT, ET CE N'EST PAS « ça écrit et ça relit ». Trois
décisions qui ne se devinent pas :

  1. LECTURE et ÉCRITURE n'ont pas le même mode d'accès. L'athlète LIT (c'est
     pour lui) mais n'écrit pas (c'est une consigne, pas un mémo), et le kiné
     lit sans écrire (ce sont des objectifs de programmation) ;
  2. le mouvement est garanti par une CLÉ ÉTRANGÈRE vers la bibliothèque, pas
     par une liste recopiée en Python — et la route traduit la violation en 422
     lisible plutôt qu'en 500 ;
  3. clore n'efface pas, et `cree_le` ne bouge jamais : c'est ce qui distingue
     un journal d'un bloc-notes.
"""

import pytest
from sqlalchemy import text

_AUTH = {"Authorization": "Bearer x"}
_A1 = "aaaaaaaa-1111-1111-1111-111111111111"
_A2 = "aaaaaaaa-2222-2222-2222-222222222222"


@pytest.fixture
def monde(pg):
    """Deux athlètes, deux coachs, un kiné — et une BIBLIOTHÈQUE.

    ⚠️ LA BIBLIOTHÈQUE FAIT PARTIE DU MONDE, et c'est nouveau pour une fixture de
    ce projet. La colonne `mouvement` porte une clé étrangère : semer « SQUAT »
    sans l'entrée correspondante fait échouer l'insertion. Les anciennes fixtures
    inventaient des noms librement — elles reposaient sur une base que la
    production n'autorise pas (cf. FRE-123)."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1','c1@x.fr'), ('coach-2','c2@x.fr'), "
                    "('kine-1','k@x.fr'), ('uid-1','a1@x.fr'), ('uid-2','a2@x.fr'), "
                    "('intrus','i@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1'), ('coach-2')"))
    pg.execute(text("INSERT INTO kines (uid) VALUES ('kine-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, kine_uid, first_name, user_uid) "
        "VALUES (CAST(:a1 AS uuid),'a1','coach-1','kine-1','A','uid-1'),"
        "       (CAST(:a2 AS uuid),'a2','coach-2',NULL,'B','uid-2')"),
        {"a1": _A1, "a2": _A2})
    pg.execute(text(
        "INSERT INTO library_entries (category, name) VALUES "
        "('exercices','SQUAT'), ('exercices','MUSCLE UP') "
        # ⚠️ IDEMPOTENT depuis FRE-123 : `conftest` sème un référentiel minimal
        # (sans lui, la clé étrangère refuserait toute ligne d'exercice). Ce
        # fichier ajoute CE QUI LUI EST PROPRE par-dessus.
        "ON CONFLICT DO NOTHING"))
    return pg


def _poser(client, texte="Garde les coudes hauts", mouvement="SQUAT", athlete="a1"):
    return client.post(f"/athletes/{athlete}/objectifs-techniques",
                       json={"mouvement": mouvement, "texte": texte}, headers=_AUTH)


# --------------------------------------------------------------------------- #
# QUI LIT, QUI ÉCRIT — la règle d'affordance, côté serveur
# --------------------------------------------------------------------------- #

def test_le_coach_pose_un_objectif(auth_as, monde):
    r = _poser(auth_as(uid="coach-1"))
    assert r.status_code == 201, r.text[:300]
    corps = r.json()
    assert (corps["mouvement"], corps["texte"]) == ("SQUAT", "Garde les coudes hauts")
    assert corps["creePar"] == "coach-1"
    assert corps["closLe"] is None, "un objectif neuf est ouvert"


def test_l_athlete_LIT_ses_objectifs(auth_as, monde):
    """⚠️ C'EST TOUT L'INTÉRÊT DE LA FONCTIONNALITÉ. Un objectif que l'athlète ne
    verrait pas serait une note que le coach se prend à lui-même."""
    _poser(auth_as(uid="coach-1"))
    r = auth_as(uid="uid-1").get("/athletes/a1/objectifs-techniques", headers=_AUTH)
    assert r.status_code == 200
    assert [o["texte"] for o in r.json()] == ["Garde les coudes hauts"]


def test_l_athlete_N_ECRIT_PAS(auth_as, monde):
    """⚠️ LA RÈGLE D'AFFORDANCE TIENT ICI, PAS DANS L'ÉCRAN. Le front ne
    proposera aucun geste d'écriture à l'athlète — mais c'est parce que brokkr
    les refuse que la règle est vraie, et pas seulement respectée.

    Une consigne que son destinataire peut réécrire n'est plus une consigne."""
    r = _poser(auth_as(uid="uid-1"))
    assert r.status_code == 403
    assert r.json()["code"] == "athlete_hors_perimetre"


def test_le_kine_LIT_mais_N_ECRIT_PAS(auth_as, monde):
    """⚠️ LA SEULE FRONTIÈRE POSÉE DANS CE TICKET, et elle mérite sa spec : ce
    sont des objectifs de PROGRAMMATION. La règle maison « ouvrir large entre
    gens du staff » vaut pour ce qu'on regarde, pas pour ce qu'on prescrit."""
    _poser(auth_as(uid="coach-1"))
    kine = auth_as(uid="kine-1")

    assert kine.get("/athletes/a1/objectifs-techniques", headers=_AUTH).status_code == 200
    assert _poser(kine).status_code == 403


def test_un_AUTRE_coach_est_refuse(auth_as, monde):
    """Le mode est `coach` — SON coach, pas n'importe lequel. `coach-2` est bien
    un coach vérifié : c'est ce qui rend ce test utile."""
    assert _poser(auth_as(uid="coach-2")).status_code == 403


def test_un_quidam_ne_lit_rien(auth_as, monde):
    r = auth_as(uid="intrus").get("/athletes/a1/objectifs-techniques", headers=_AUTH)
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# LE MOUVEMENT VIENT DE LA BIBLIOTHÈQUE
# --------------------------------------------------------------------------- #

def test_un_mouvement_INCONNU_est_refuse_en_422(auth_as, monde):
    """⚠️ REFUSÉ PAR LA BASE, TRADUIT PAR LA ROUTE. La garantie vit dans la clé
    étrangère vers `library_entries` — une liste blanche recopiée en Python
    aurait divergé au premier ajout de la bibliothèque, sans que rien ne le dise.

    Mais sans la traduction, le client prendrait un 500 sur une faute de saisie
    parfaitement prévisible. Les deux moitiés comptent."""
    r = _poser(auth_as(uid="coach-1"), mouvement="TIRAGE MARTIEN")
    assert r.status_code == 422, r.text[:300]
    assert r.json()["code"] == "mouvement_inconnu"


def test_RENOMMER_le_mouvement_dans_la_bibliotheque_ENTRAINE_l_objectif(auth_as, monde):
    """⚠️ C'EST LA RAISON DU `ON UPDATE CASCADE`, et la raison de stocker le
    TEXTE plutôt qu'un `library_entry_id`.

    Un coach renomme « SQUAT » en « BACK SQUAT » : l'objectif suit. Sans la
    cascade il pointerait sur un nom qui n'existe plus ; avec un identifiant il
    aurait fallu résoudre `id → nom` à chaque lecture et à chaque rapprochement.

    ⚠️ CE QUE CETTE SPEC NE PROUVE PAS : que les LIGNES d'exercice suivent. Elles
    portent une copie texte et gardent l'ancien nom — défaut antérieur, sorti
    dans FRE-123."""
    _poser(auth_as(uid="coach-1"))
    monde.execute(text("UPDATE library_entries SET name = 'BACK SQUAT' "
                       "WHERE category = 'exercices' AND name = 'SQUAT'"))

    lus = auth_as(uid="coach-1").get("/athletes/a1/objectifs-techniques",
                                     headers=_AUTH).json()
    assert [o["mouvement"] for o in lus] == ["BACK SQUAT"]


# --------------------------------------------------------------------------- #
# UN JOURNAL, PAS UN BLOC-NOTES
# --------------------------------------------------------------------------- #

def test_clore_NE_SUPPRIME_PAS(auth_as, monde):
    """L'objectif reste dans le journal, avec la DATE de sa clôture. « Atteint »
    sans savoir quand ne raconte rien."""
    coach = auth_as(uid="coach-1")
    oid = _poser(coach).json()["id"]

    r = coach.patch(f"/athletes/a1/objectifs-techniques/{oid}",
                    json={"clos": True}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json()["closLe"] is not None

    lus = coach.get("/athletes/a1/objectifs-techniques", headers=_AUTH).json()
    assert len(lus) == 1, "clore n'efface pas"


def test_un_objectif_clos_se_ROUVRE(auth_as, monde):
    """La technique se perd. Reposer le même objectif en créerait un doublon daté
    d'aujourd'hui, qui mentirait sur depuis quand on le travaille."""
    coach = auth_as(uid="coach-1")
    oid = _poser(coach).json()["id"]
    coach.patch(f"/athletes/a1/objectifs-techniques/{oid}",
                json={"clos": True}, headers=_AUTH)

    r = coach.patch(f"/athletes/a1/objectifs-techniques/{oid}",
                    json={"clos": False}, headers=_AUTH)
    assert r.json()["closLe"] is None


def test_corriger_le_texte_ne_fait_PAS_remonter_l_objectif(auth_as, monde):
    """⚠️ `cree_le` NE BOUGE PAS. Ce qui ordonne un journal, c'est QUAND ça s'est
    passé — pas quand on a corrigé une faute de frappe. Sans cette garantie, le
    plus vieil objectif retouché passerait devant le plus récent."""
    coach = auth_as(uid="coach-1")
    oid = _poser(coach).json()["id"]
    avant = _poser(coach).json()["creeLe"]  # un second, plus récent
    del avant

    pose = coach.get("/athletes/a1/objectifs-techniques", headers=_AUTH).json()
    cree_le_initial = next(o["creeLe"] for o in pose if o["id"] == oid)

    coach.patch(f"/athletes/a1/objectifs-techniques/{oid}",
                json={"texte": "Coudes hauts, vraiment"}, headers=_AUTH)

    apres = coach.get("/athletes/a1/objectifs-techniques", headers=_AUTH).json()
    corrige = next(o for o in apres if o["id"] == oid)
    assert corrige["texte"] == "Coudes hauts, vraiment"
    assert corrige["creeLe"] == cree_le_initial
    assert apres[-1]["id"] == oid, "le corrigé reste le PLUS ANCIEN de la liste"


def test_la_liste_va_du_PLUS_RECENT_au_plus_ancien(auth_as, monde):
    coach = auth_as(uid="coach-1")
    _poser(coach, texte="premier")
    _poser(coach, texte="second", mouvement="MUSCLE UP")

    lus = coach.get("/athletes/a1/objectifs-techniques", headers=_AUTH).json()
    assert [o["texte"] for o in lus] == ["second", "premier"]


def test_supprimer_efface_vraiment(auth_as, monde):
    """La suppression existe pour les FAUTES — un objectif posé sur le mauvais
    mouvement n'a aucune histoire à garder. Un objectif travaillé, lui, se clôt."""
    coach = auth_as(uid="coach-1")
    oid = _poser(coach).json()["id"]

    assert coach.delete(f"/athletes/a1/objectifs-techniques/{oid}",
                        headers=_AUTH).status_code == 204
    assert coach.get("/athletes/a1/objectifs-techniques", headers=_AUTH).json() == []


# --------------------------------------------------------------------------- #
# LES FRONTIÈRES
# --------------------------------------------------------------------------- #

def test_l_objectif_d_un_AUTRE_athlete_est_un_404(auth_as, monde):
    """⚠️ 404 ET NON 403, et l'appartenance fait partie de la RECHERCHE. Chercher
    l'objectif puis comparer son athlète laisserait une fenêtre où l'on confirme
    l'existence d'un objectif qu'on n'a pas le droit de voir."""
    oid = _poser(auth_as(uid="coach-1")).json()["id"]
    r = auth_as(uid="coach-2").patch(f"/athletes/a2/objectifs-techniques/{oid}",
                                     json={"clos": True}, headers=_AUTH)
    assert r.status_code == 404
    assert r.json()["code"] == "objectif_introuvable"


def test_un_texte_VIDE_est_refuse(auth_as, monde):
    """«    » a une longueur de quatre et ne dit rien. Refusé par le contrat, pour
    que le client reçoive un 422 lisible plutôt que le 500 de la colonne."""
    r = _poser(auth_as(uid="coach-1"), texte="   ")
    assert r.status_code == 422


def test_une_correction_VIDE_est_refusee(auth_as, monde):
    """Un `PATCH {}` ne dit rien : ni le texte, ni l'état. C'est une requête qui
    a perdu son intention en route, pas un geste."""
    coach = auth_as(uid="coach-1")
    oid = _poser(coach).json()["id"]
    r = coach.patch(f"/athletes/a1/objectifs-techniques/{oid}", json={}, headers=_AUTH)
    assert r.status_code == 422


def test_un_texte_NUL_est_refuse(auth_as, monde):
    """⚠️ `null` N'EST PAS UNE VALEUR POUR CE CHAMP, et c'est la moitié de la
    règle qui manquait (FRE-186). `""` était refusé, `null` passait le contrat :
    le champ comptait comme FOURNI, mais ne produisait aucun fragment `SET`.
    La requête partait en `UPDATE … SET  WHERE …`, et la base rendait un 500.

    La colonne est `NOT NULL` : « effacer le texte » n'existe pas. Un objectif
    sans texte ne dit rien — on le SUPPRIME, on ne le vide pas."""
    coach = auth_as(uid="coach-1")
    oid = _poser(coach).json()["id"]
    r = coach.patch(f"/athletes/a1/objectifs-techniques/{oid}",
                    json={"texte": None}, headers=_AUTH)
    assert r.status_code == 422, r.text


def test_un_clos_NUL_ne_ROUVRE_PAS_en_silence(auth_as, monde):
    """⚠️ LE MÊME DÉFAUT, EN PIRE : ici `null` ne levait pas, il ÉCRIVAIT.

    `clos_le = clock_timestamp() if payload.clos else NULL` traite `None` comme
    `False` — un `PATCH {"clos": null}` rouvrait donc un objectif atteint, sans
    que personne ne l'ait demandé. Pas de 500, pas de trace : juste une date de
    clôture effacée.

    ⚠️ CETTE SPEC VÉRIFIE LA DATE, PAS LE CODE HTTP. Un 200 qui rouvre et un 422
    qui refuse se distinguent par ce qu'ils ont LAISSÉ en base, et c'est la seule
    question qui compte pour l'athlète."""
    coach = auth_as(uid="coach-1")
    oid = _poser(coach).json()["id"]
    coach.patch(f"/athletes/a1/objectifs-techniques/{oid}",
                json={"clos": True}, headers=_AUTH)

    r = coach.patch(f"/athletes/a1/objectifs-techniques/{oid}",
                    json={"clos": None}, headers=_AUTH)
    assert r.status_code == 422, r.text

    lus = coach.get("/athletes/a1/objectifs-techniques", headers=_AUTH).json()
    garde = next(o for o in lus if o["id"] == oid)
    assert garde["closLe"] is not None, "l'objectif a été rouvert sans qu'on le demande"


def test_un_athlete_inconnu_est_un_404(auth_as, monde):
    r = auth_as(uid="coach-1").get("/athletes/zzz/objectifs-techniques", headers=_AUTH)
    assert r.status_code == 404
