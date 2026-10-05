"""LES NOTES DE SUIVI DU KINÉ (FRE-102) — contre un VRAI Postgres.

Ce qui se joue ici tient en deux moitiés, et la seconde compte plus que la
première : que le journal fonctionne, et que **personne d'autre que le kiné de
cet athlète ne le voie**.

⚠️ C'est le mode d'accès le plus étroit du produit — le seul qui exclue l'athlète
lui-même. Une garde qui s'élargit par mégarde ne se remarque pas : tout continue
de marcher, simplement quelqu'un lit ce qui ne le regarde pas. D'où une
assertion par profil, plutôt qu'un test « ça marche » et la confiance.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app

_AUTH = {"Authorization": "Bearer x"}
_ATHLETE = "11111111-1111-1111-1111-111111111111"


@pytest.fixture
def monde(pg):
    """Un athlète, son coach, SON kiné, et un kiné TIERS.

    ⚠️ LE KINÉ TIERS N'EST PAS DÉCORATIF. Ce qui ouvre l'accès n'est pas le fait
    d'être kiné mais le LIEN `athletes.kine_uid` : sans un second praticien en
    règle, on ne testerait que « kiné ou pas », jamais « CE kiné-là »."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1','c@x.fr'), ('kine-1','k@x.fr'), "
                    "('kine-2','k2@x.fr'), ('ath-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text("INSERT INTO kines (uid) VALUES ('kine-1'), ('kine-2')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, kine_uid, user_uid, first_name) "
        "VALUES (CAST(:a AS uuid), 'lea', 'coach-1', 'kine-1', 'ath-1', 'Léa')"),
        {"a": _ATHLETE})
    return pg


def _client(uid: str) -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def _url(suffixe: str = "") -> str:
    return f"/athletes/lea/notes-kine{suffixe}"


# --------------------------------------------------------------------------- #
# Le journal
# --------------------------------------------------------------------------- #

def test_le_kine_ecrit_et_relit_sa_note(monde):
    c = _client("kine-1")
    r = c.post(_url(), headers=_AUTH, json={"contenu": "Épaule droite douloureuse en fin d’amplitude"})
    assert r.status_code == 201, r.text[:300]
    assert r.json()["kineUid"] == "kine-1"

    lues = c.get(_url(), headers=_AUTH).json()
    assert [n["contenu"] for n in lues] == ["Épaule droite douloureuse en fin d’amplitude"]


def test_le_journal_va_du_PLUS_RECENT_au_plus_ancien(monde):
    """⚠️ L'ORDRE EST LA FONCTIONNALITÉ, pas une préférence d'affichage. « Il sait
    où il en est » veut dire que l'état courant se lit EN PREMIER ; un journal
    trié à l'endroit obligerait à faire défiler tout l'historique pour trouver la
    dernière observation."""
    c = _client("kine-1")
    for texte in ("la plus ancienne", "celle du milieu", "la plus récente"):
        assert c.post(_url(), headers=_AUTH, json={"contenu": texte}).status_code == 201
        # `now()` est figé DANS une transaction Postgres : sans décalage explicite
        # les trois notes partagent le même `cree_le` et l'ordre devient arbitraire.
        monde.execute(text("UPDATE kine_notes SET cree_le = cree_le - interval '1 hour' "
                           "WHERE contenu <> :dernier"), {"dernier": texte})

    assert [n["contenu"] for n in c.get(_url(), headers=_AUTH).json()][0] == "la plus récente"


def test_corriger_une_note_ne_la_fait_PAS_remonter(monde):
    """⚠️ `modifie_le` BOUGE, `cree_le` NON. Corriger une faute d'orthographe sur
    une note de trois semaines ne doit pas la propulser en tête du suivi : ce qui
    ordonne un journal, c'est QUAND ça s'est passé, pas quand on l'a retouché."""
    c = _client("kine-1")
    vieille = c.post(_url(), headers=_AUTH, json={"contenu": "vieille"}).json()
    monde.execute(text("UPDATE kine_notes SET cree_le = cree_le - interval '3 weeks'"))
    c.post(_url(), headers=_AUTH, json={"contenu": "récente"})

    # ⚠️ RELUE APRÈS LE DÉCALAGE, sinon on comparerait la date d'AVANT le vieillissement
    # artificiel et le test échouerait sur son propre dispositif, pas sur le code.
    avant_correction = next(n for n in c.get(_url(), headers=_AUTH).json()
                            if n["id"] == vieille["id"])

    corrigee = c.patch(_url(f"/{vieille['id']}"), headers=_AUTH,
                       json={"contenu": "vieille, corrigée"})
    assert corrigee.status_code == 200, corrigee.text[:300]
    assert corrigee.json()["creeLe"] == avant_correction["creeLe"]
    assert corrigee.json()["modifieLe"] != avant_correction["modifieLe"]

    assert [n["contenu"] for n in c.get(_url(), headers=_AUTH).json()] \
        == ["récente", "vieille, corrigée"]


def test_supprimer_une_note(monde):
    c = _client("kine-1")
    note = c.post(_url(), headers=_AUTH, json={"contenu": "à retirer"}).json()
    assert c.delete(_url(f"/{note['id']}"), headers=_AUTH).status_code == 204
    assert c.get(_url(), headers=_AUTH).json() == []


@pytest.mark.parametrize("contenu", ["", "   ", "\n\t "])
def test_une_note_VIDE_est_refusee(monde, contenu):
    """Une note sans texte est un clic de trop, pas une information — et elle
    encombrerait le journal qu'elle est censée éclairer. Refusée en 422 par le
    schéma, AVANT d'atteindre le CHECK de la colonne : le client reçoit un motif
    lisible plutôt qu'un 500."""
    assert _client("kine-1").post(_url(), headers=_AUTH,
                                 json={"contenu": contenu}).status_code == 422


def test_le_contenu_est_DETOURE_a_l_ecriture(monde):
    c = _client("kine-1")
    r = c.post(_url(), headers=_AUTH, json={"contenu": "   espaces autour   "})
    assert r.json()["contenu"] == "espaces autour"


# --------------------------------------------------------------------------- #
# ⚠️ QUI LIT — LA MOITIÉ QUI COMPTE
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("uid,qui", [
    ("coach-1", "le coach, même gérant de cet athlète"),
    ("ath-1", "l’athlète LUI-MÊME"),
    ("kine-2", "un autre kiné, pourtant kiné en règle"),
    ("inconnu", "un compte sans lien"),
])
def test_personne_d_autre_que_SON_kine_ne_lit_les_notes(monde, uid, qui):
    """⚠️ QUATRE PROFILS, ET CHACUN EST UN CAS DISTINCT.

    Le coach — parce que c'est le seul domaine du produit dont il est exclu, et
    que la règle maison « ouvrir large entre gens du staff » pousse à l'inverse.

    L'athlète — parce que les BILANS lui sont ouverts (`owner_or_kine`) et qu'il
    serait naturel d'aligner les deux. Non : un bilan se remplit AVEC lui, une
    note de suivi est l'observation du praticien. « Suspicion de tendinopathie,
    à surveiller » est une hypothèse ; la lui montrer l'inquiéterait sans
    contexte et censurerait ce que le kiné écrit.

    Le kiné TIERS — parce que ce qui ouvre l'accès est le LIEN, pas le rôle. Un
    kiné en règle n'a rigoureusement rien sur un athlète qu'il ne suit pas.

    ⚠️ ET C'EST BIEN 403, PAS UNE LISTE VIDE : rendre `[]` laisserait croire que
    l'athlète n'a pas de notes, ce qui est une réponse fausse. Le refus doit se
    dire."""
    c = _client(uid)
    assert c.get(_url(), headers=_AUTH).status_code == 403, qui
    assert c.post(_url(), headers=_AUTH, json={"contenu": "x"}).status_code == 403, qui


def test_une_note_d_un_AUTRE_athlete_est_introuvable(monde):
    """⚠️ L'APPARTENANCE FAIT PARTIE DE LA RECHERCHE, pas d'un test qui suivrait.
    Chercher la note puis comparer son `athlete_id` confirmerait au passage
    qu'elle EXISTE — la même fuite par différence de réponse que l'ordre
    404-puis-403 évite ailleurs."""
    monde.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, kine_uid, first_name) VALUES "
        "('22222222-2222-2222-2222-222222222222','autre','coach-1','kine-1','Autre')"))
    c = _client("kine-1")
    ailleurs = c.post("/athletes/autre/notes-kine", headers=_AUTH,
                      json={"contenu": "chez l’autre"}).json()

    assert c.patch(_url(f"/{ailleurs['id']}"), headers=_AUTH,
                   json={"contenu": "détournée"}).status_code == 404
    assert c.delete(_url(f"/{ailleurs['id']}"), headers=_AUTH).status_code == 404
    # Et elle est toujours là, chez son athlète.
    assert len(c.get("/athletes/autre/notes-kine", headers=_AUTH).json()) == 1


def test_un_athlete_sans_kine_refuse_tout_le_monde(monde):
    """Le lien est ce qui ouvre : sans `kine_uid`, il n'y a personne à autoriser —
    pas même un kiné en règle."""
    monde.execute(text("UPDATE athletes SET kine_uid = NULL WHERE legacy_id = 'lea'"))
    for uid in ("kine-1", "kine-2", "coach-1", "ath-1"):
        assert _client(uid).get(_url(), headers=_AUTH).status_code == 403, uid


# --------------------------------------------------------------------------- #
# ⚠️ CE QUE `ON DELETE RESTRICT` PRODUIT À L'ÉCRAN
# --------------------------------------------------------------------------- #

def test_retrograder_un_kine_qui_a_des_NOTES_PASSE(monde):
    """⚠️ LE TEST A CHANGÉ DE SENS LE 26/08, ET IL FAUT DIRE POURQUOI.

    Il gardait l'inverse : une rétrogradation REFUSÉE tant que des notes
    existaient, parce que `kine_notes.kine_uid` pointait vers `kines(uid)` avec
    un ON DELETE RESTRICT.

    William l'a pris en défaut d'une phrase : « je ne peux pas supprimer un kiné
    s'il a des notes, mais je peux le supprimer même s'il a uploadé des
    photos ? » Les deux comportements étaient incohérents, et mauvais tous les
    deux pour la même raison — la clé désignait un RÔLE là où l'auteur est une
    PERSONNE.

    Conséquence absurde de l'ancien RESTRICT : le seul moyen de rétrograder
    quelqu'un était de SUPPRIMER ses notes cliniques. Une contrainte posée pour
    protéger la donnée forçait à la détruire. Le projet avait déjà payé ce bug
    côté coach — `library_entries.created_by`, corrigé le 20/08 avec ce constat :
    « une trace d'audit que personne ne lit n'a pas à empêcher un départ »."""
    monde.execute(text("INSERT INTO users (uid, email, is_admin) VALUES "
                       "('boss','b@x.fr', true)"))
    c = _client("kine-1")
    c.post(_url(), headers=_AUTH, json={"contenu": "une observation"})
    monde.execute(text("UPDATE athletes SET kine_uid = NULL WHERE legacy_id = 'lea'"))

    r = _client("boss").put("/users/kine-1/kine", headers=_AUTH, json={"isKine": False})
    assert r.status_code == 200, r.text[:300]

    # ⚠️ ET LES NOTES SURVIVENT, ATTRIBUÉES. C'est la moitié qui compte : perdre
    # l'auteur serait aussi faux que bloquer le départ — la personne existe
    # toujours dans `users`, à un SELECT de distance.
    restantes = monde.execute(text(
        "SELECT kine_uid FROM kine_notes")).mappings().all()
    assert [n["kine_uid"] for n in restantes] == ["kine-1"]


def test_retrograder_un_kine_qui_a_des_ATHLETES_dit_l_autre_motif(monde):
    """L'autre moitié : le motif d'origine doit survivre à l'ajout du second.
    Sans cette assertion, remplacer un message par l'autre passerait inaperçu."""
    monde.execute(text("INSERT INTO users (uid, email, is_admin) VALUES "
                       "('boss','b@x.fr', true)"))
    r = _client("boss").put("/users/kine-1/kine", headers=_AUTH, json={"isKine": False})
    assert r.status_code == 409
    assert r.json()["code"] == "kine_a_des_athletes"
