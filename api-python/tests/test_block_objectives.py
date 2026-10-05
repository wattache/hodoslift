"""Objectifs de bloc — portés sur le modèle relationnel (FRE-12).

Ce fichier testait une route qui désignait le bloc par son id FIRESTORE, dans une
table qui portait aussi le programme et le macro pour lever l'ambiguïté : un id
documentaire n'est pas unique entre programmes. Depuis la clé étrangère, le bloc
se désigne par son uuid et la base tient l'intégrité.

Ce qui NE change pas, et qui est l'essentiel : un PUT remplace la liste
intégralement. Un objectif n'a pas d'identité côté client — c'est sa POSITION qui
le désigne — donc un DELETE + INSERT dans la transaction, jamais un diff.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app
from tests.chargeur_arbre import Arbre, load
from tests.fixtures_training import arbre_de_test

_AUTH = {"Authorization": "Bearer x"}


@pytest.fixture
def monde(pg):
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','a@x.fr'), ('ath-1','b@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name, last_name, user_uid) VALUES "
        "('11111111-1111-1111-1111-111111111111','coach-1','A','Un','ath-1')"))
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
                    "('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    load(pg, Arbre(macros=arbre_de_test("p1")))
    return pg


def _client(uid: str = "coach-1") -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def _bloc(conn, position: int = 0) -> str:
    ids = [str(r[0]) for r in conn.execute(text(
        "SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'p1' ORDER BY b.number")).all()]
    return ids[position]


def _lignes(conn, bloc: str):
    return conn.execute(text(
        "SELECT position, exercise FROM block_objectives WHERE block_id = CAST(:b AS uuid) "
        "ORDER BY position"), {"b": bloc}).all()


def _version(c: TestClient, bloc: str) -> str:
    """La version que la CHARPENTE vient de rendre — le geste exact du front.
    Aucune spec ne la fabrique à la main (FRE-163)."""
    macros = c.get("/programs/p1/structure", headers=_AUTH).json()["macros"]
    return next(b["objectivesVersion"] for m in macros for b in m["blocks"] if b["id"] == bloc)


def _put(c: TestClient, bloc: str, objectifs: list, version: str | None = None):
    """Un PUT tel que le front le fait : la version lue juste avant."""
    return c.put(f"/programs/p1/blocks/{bloc}/objectives", headers=_AUTH,
                 json={"objectives": objectifs, "version": version or _version(c, bloc)})


def _obj(exercise: str) -> dict:
    return {"exercise": exercise, "variant": "", "format": "", "sets": "5", "reps": "3",
            "weightMin": "", "weightMax": "", "assistance": ""}


def test_put_remplace_integralement(monde):
    """Remplacement, pas fusion : la seconde liste efface la première."""
    bloc = _bloc(monde)
    c = _client()
    _put(c, bloc, [_obj("A"), _obj("B")])
    _put(c, bloc, [_obj("C")])
    assert _lignes(monde, bloc) == [(0, "C")]


def test_put_reordonne_sans_orphelin(monde):
    """Les positions sont RÉUTILISÉES : il ne reste pas de ligne fantôme."""
    bloc = _bloc(monde)
    c = _client()
    _put(c, bloc, [_obj("A"), _obj("B"), _obj("C")])
    _put(c, bloc, [_obj("C"), _obj("B"), _obj("A")])
    assert [e for _, e in _lignes(monde, bloc)] == ["C", "B", "A"]


def test_put_tous_les_champs_font_l_aller_retour(monde):
    bloc = _bloc(monde)
    envoye = {"exercise": "SQUAT", "variant": "COMP", "format": "EMOM", "sets": "5",
              "reps": "3", "weightMin": "100", "weightMax": "120", "assistance": "RB30",
              "atteintLe": "2026-08-30"}
    r = _put(_client(), bloc, [envoye])
    assert r.status_code == 200
    rendu = r.json()["objectives"][0]
    assert {k: rendu[k] for k in envoye} == envoye


def test_un_objectif_NON_ATTEINT_n_a_pas_de_date(monde):
    """⚠️ NULL VEUT DIRE « PAS ATTEINT », et rien d'autre n'a besoin d'être écrit.

    C'est une COCHE, pas un suivi (décision de William, 02/09) : « c'est une
    satisfaction, c'est pédagogique. Pas pour du tracking : le tableau des PR le
    fait. » D'où l'absence d'un « réalisé » en face du prescrit — ce serait la
    forme d'une mesure, et ce n'en est pas une."""
    bloc = _bloc(monde)
    r = _put(_client(), bloc, [{"exercise": "SQUAT"}])
    assert r.json()["objectives"][0]["atteintLe"] is None


def test_DECOCHER_un_objectif_efface_sa_date(monde):
    """⚠️ L'ÉCRITURE EST UN REMPLACEMENT COMPLET, donc décocher se dit en
    RENVOYANT la liste sans la date. Il n'y a pas de route à part, et c'est ce
    qui rend le geste réversible sans code supplémentaire.

    Le piège qu'elle garde : un `INSERT` qui omettrait la colonne laisserait
    l'ancienne valeur si l'écriture devenait un `UPDATE` un jour."""
    bloc = _bloc(monde)
    c = _client()
    _put(c, bloc, [{"exercise": "SQUAT", "atteintLe": "2026-08-30"}])

    r = _put(c, bloc, [{"exercise": "SQUAT"}])
    assert r.json()["objectives"][0]["atteintLe"] is None


def test_DECOCHER_depuis_l_ecran_envoie_une_chaine_VIDE(monde):
    """⚠️ LE DÉFAUT LE PLUS RÉCURRENT DU PROJET, à sa frontière habituelle. La
    colonne est une `date` ; l'écran, lui, décoche une case et envoie `''`.
    Postgres refuse la chaîne vide là où il attend un jour — le geste le plus
    banal serait sorti en 500.

    La conversion vit dans le CONTRAT (`vide_en_none`), pas dans la route : c'est
    la frontière où l'on sait encore que `''` voulait dire « rien »."""
    bloc = _bloc(monde)
    c = _client()
    _put(c, bloc, [{"exercise": "SQUAT", "atteintLe": "2026-08-30"}])

    r = _put(c, bloc, [{"exercise": "SQUAT", "atteintLe": ""}])
    assert r.status_code == 200, r.text[:300]
    assert r.json()["objectives"][0]["atteintLe"] is None


def test_put_liste_vide_efface_tout(monde):
    bloc = _bloc(monde)
    c = _client()
    _put(c, bloc, [_obj("A")])
    _put(c, bloc, [])
    assert _lignes(monde, bloc) == []


def test_put_bloc_d_un_autre_programme_404(monde):
    """Un uuid valide mais étranger au programme reste introuvable."""
    assert _client().put(
        "/programs/p1/blocks/99999999-9999-9999-9999-999999999999/objectives",
        json={"objectives": [], "version": "x"}, headers=_AUTH).status_code == 404


def test_put_non_coach_403(monde):
    bloc = _bloc(monde)
    assert _client("ath-1").put(f"/programs/p1/blocks/{bloc}/objectives",
                                json={"objectives": [], "version": "x"}, headers=_AUTH).status_code == 403


def test_supprimer_le_bloc_emporte_ses_objectifs(monde):
    """Ce que la clé étrangère fait désormais toute seule. Avant, une cascade
    MANUELLE s'en chargeait — et devait s'exécuter avant la suppression Firestore,
    puisque les deux magasins ne partageaient pas de transaction."""
    bloc = _bloc(monde, 1)     # le second : le premier est le dernier survivant
    _put(_client(), bloc, [_obj("A")])
    assert len(_lignes(monde, bloc)) == 1
    assert _client().delete(f"/programs/p1/blocks/{bloc}", headers=_AUTH).status_code == 200
    assert _lignes(monde, bloc) == []


# --------------------------------------------------------------------------- #
# LE CONTRAT D'ÉCRITURE, ENFIN BRANCHÉ (FRE-124)
#
# ⚠️ CETTE ROUTE NE VALIDAIT RIEN. Elle prenait un `dict[str, Any]` brut pendant
# que `ObjectivesReplace` et `ObjectiveIn` existaient, déclarés pour elle et
# importés NULLE PART — un fichier de schéma qui n'était pas un contrat, mais un
# document. Le front tenait une discipline que le serveur ignorait, l'inverse
# exact de la règle maison.
#
# Ces specs disent ce qu'elle refuse MAINTENANT, et chacune était acceptée hier.
# --------------------------------------------------------------------------- #

def test_position_est_REFUSEE_comme_le_docstring_l_annonce(monde):
    """⚠️ LE DOCSTRING DE `block_objectives.py` L'AFFIRMAIT DÉJÀ : « `position` se
    dérive de l'index du tableau — elle n'est donc PAS acceptée en entrée
    (`extra="forbid"` ⇒ 422 si envoyée) ». C'était FAUX : la route l'acceptait et
    l'ignorait en silence.

    Un client qui aurait tenu à son ordre n'aurait rien vu du refus."""
    bloc = _bloc(monde)
    r = _put(_client(), bloc, [{"exercise": "SQUAT", "position": 3}])
    assert r.status_code == 422


def test_un_champ_INCONNU_est_refusé(monde):
    """`extra="forbid"` : une faute de frappe est une faute du client, pas une
    donnée à transporter."""
    bloc = _bloc(monde)
    r = _put(_client(), bloc, [{"exercice": "SQUAT"}])
    assert r.status_code == 422


def test_une_chaine_DEMESUREE_est_refusée(monde):
    """`_STR_MAX = 2000`, déclaré et jusqu'ici sans effet. Mesuré : le champ le
    plus long de la production fait NEUF caractères."""
    bloc = _bloc(monde)
    r = _put(_client(), bloc, [{"exercise": "X" * 2001}])
    assert r.status_code == 422


def test_la_borne_est_celle_du_CONTRAT_pas_celle_de_la_route(monde):
    """⚠️ DEUX BORNES VIVAIENT POUR LA MÊME CHOSE : `max_length=50` dans le
    modèle, et un `if len(...) > 200` écrit à la main dans la route. C'est la
    seconde qui gagnait — celle qui n'était pas déclarée.

    Mesuré avant de trancher : le bloc le plus fourni de la production porte
    QUATRE objectifs. Les deux bornes étaient hors de portée, donc le choix était
    libre ; on garde la déclarée."""
    bloc = _bloc(monde)
    r = _put(_client(), bloc, [{"exercise": "SQUAT"}] * 51)
    assert r.status_code == 422

    r = _put(_client(), bloc, [{"exercise": "SQUAT"}] * 50)
    assert r.status_code == 200, "cinquante passent : la borne refuse au-delà, pas en deçà"


def test_ce_que_le_FRONT_envoie_passe_toujours(monde):
    """⚠️ LA SPEC QUI PROTÈGE LE DÉPLOIEMENT. Brancher un contrat fait passer en
    422 des requêtes hier acceptées : le vrai risque était de casser l'écran des
    objectifs.

    Le front envoie la ligne LUE, moins son `id` (`training-editor.ts`,
    `saveObjectives`) — donc exactement les neuf champs ci-dessous, chaînes
    vides comprises. Vérifié avant de brancher, gardé après."""
    bloc = _bloc(monde)
    r = _put(_client(), bloc, [{
        "exercise": "SQUAT", "variant": "", "format": "",
        "sets": "5", "reps": "3", "weightMin": "100",
        "weightMax": "", "assistance": "", "atteintLe": None,
    }])
    assert r.status_code == 200, r.text[:300]


# --------------------------------------------------------------------------- #
# FRE-163 — une liste périmée ne remplace plus la liste en base
# --------------------------------------------------------------------------- #

def test_un_onglet_PERIME_ne_defait_plus_la_coche_posee_ailleurs(monde):
    """Le cas vécu : le coach a la base ouverte sur l'ordinateur, et coche
    « atteint » depuis son téléphone. L'onglet de l'ordinateur, resté sur sa
    lecture, renvoie sa liste — sans la coche. Il effaçait en silence ; il est
    désormais refusé, et la coche reste.

    MUTATION QUI ROUGIT : retirer la comparaison de version dans
    `replace_objectives`."""
    bloc = _bloc(monde)
    c = _client()
    _put(c, bloc, [_obj("SQUAT")])
    lue_sur_l_ordinateur = _version(c, bloc)

    # Le téléphone coche.
    assert _put(c, bloc, [{**_obj("SQUAT"), "atteintLe": "2026-09-14"}]).status_code == 200

    # L'ordinateur modifie les séries, sur sa lecture d'avant la coche.
    r = _put(c, bloc, [{**_obj("SQUAT"), "sets": "4"}], version=lue_sur_l_ordinateur)
    assert r.status_code == 409
    assert r.json()["code"] == "objectifs_perimes"
    assert monde.execute(text(
        "SELECT atteint_le::text, sets FROM block_objectives WHERE block_id = CAST(:b AS uuid)"),
        {"b": bloc}).all() == [("2026-09-14", "5")]


def test_la_version_RENDUE_par_l_ecriture_est_celle_que_la_lecture_rendra(monde):
    """Le front enchaîne ses écritures sans relire entre deux : la réponse lui
    donne la version suivante. Si elle différait de la lecture, sa seconde
    écriture serait refusée — un 409 contre lui-même."""
    bloc = _bloc(monde)
    c = _client()
    r = _put(c, bloc, [_obj("A"), {**_obj("B"), "atteintLe": "2026-09-01"}])
    assert r.json()["version"] == _version(c, bloc)
    assert _put(c, bloc, [_obj("A")], version=r.json()["version"]).status_code == 200


def test_la_lecture_de_l_ARBRE_rend_la_meme_version_que_la_charpente(monde):
    """Deux lectures portent les objectifs (charpente et arbre entier) : une seule
    définition de la version, sinon l'éditeur de BASE, qui lit l'arbre, serait
    refusé."""
    bloc = _bloc(monde)
    c = _client()
    _put(c, bloc, [_obj("A")])
    arbre = c.get("/programs/p1/training", headers=_AUTH).json()["macros"]
    version_arbre = next(b["objectivesVersion"] for m in arbre for b in m["blocks"] if b["id"] == bloc)
    assert version_arbre == _version(c, bloc)
