"""LA GÉNÉRATION D'UNE SEMAINE DEPUIS LA BASE — portée du front le 26/08.

⚠️ CE QUE CES SPECS GARDENT EN PRIORITÉ, ET CE N'EST PAS « ça génère » :

  1. L'ORDRE DES LIGNES. C'est la décision produit la plus fine de tout le
     domaine (FRE-29) : une séance se lit muscle up → traction → dips → squat,
     le tier ne départageant que deux lignes d'un MÊME mouvement. Et le repli
     sur l'ordre canonique quand `selectedPrincipaux` vaut NULL — 48 BASE sur
     111 — est ce qui faisait que le coach voyait une chose et en générait une
     autre.
  2. LA GARDE DE FRE-84. On ne génère que sur une semaine VIDE. Sur les 443
     semaines de production, 423 portent du réalisé : une régénération qui
     passerait outre effacerait le travail d'un athlète sans trace.
  3. L'APERÇU DIT LA MÊME CHOSE QUE LA GÉNÉRATION. C'est la raison d'être du
     déplacement : une règle en deux langues finit par diverger, et personne ne
     s'en aperçoit avant que ça compte.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app

_AUTH = {"Authorization": "Bearer x"}
_P = "p1"


def _principe(nom, tier, **extra):
    return {"name": nom, "tier": tier, "variant": [], "kind": None, "format": "",
            "clusterMode": "", "clusterRest": "", "tempo": "", "sets": "5", "reps": "3",
            "repsUnit": "count", "weight": "", "weightLocked": False, "assistance": "",
            "aimedRPE": "", "rest": "", "coachNote": "", "increment": "",
            "incrementUnit": "kg", "incrementRef": "", **extra}


def _accessoire(nom, jour, **extra):
    return {**_principe(nom, 1), "day": jour, "groupId": "", **extra}


def _base(**over):
    """⚠️ LE DÉCOR PORTE DES DATES DE S1 DEPUIS FRE-138, et ce n'était pas le cas.
    Les vingt specs de ce fichier composaient une trame SANS dates — le même angle
    mort que la production, où 85 blocs sur 173 n'en ont pas et fabriquent 97 % du
    réalisé qui n'entre dans aucune courbe.

    La génération les EXIGE désormais. Le refus a sa propre spec
    (`test_generer_SANS_dates_de_S1_est_refuse`) ; ici on veut le cas nominal, et
    donc une trame datée — ce qu'un coach a de toute façon sous les yeux."""
    return {"daySplit": [], "principles": [], "accessories": [],
            "selectedPrincipaux": None, "granularity": {},
            "s1StartDate": "2026-09-07", "s1EndDate": "2026-09-13", **over}


def _client(uid: str = "coach-1") -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def _poser_la_base(monde, base: dict) -> None:
    """Enregistre la BASE par la route qui l'écrit — pas en SQL direct.

    ⚠️ VOLONTAIREMENT PAR LA ROUTE : ce qui est éprouvé ensuite, c'est que la
    génération relit ce que l'ÉDITEUR a écrit. Semer en SQL pourrait poser une
    forme que l'écriture réelle ne produit jamais, et le test passerait sur un
    cas qui n'existe pas."""
    r = _client().put(f"/programs/{_P}/blocks/{monde['bloc']}/base",
                      headers=_AUTH, json={"base": base})
    assert r.status_code == 200, r.text[:300]


def _generer(monde):
    return _client().post(f"/programs/{_P}/blocks/{monde['bloc']}/generate-week",
                          headers=_AUTH)


def _noms(semaine: dict, i: int = 0) -> list[str]:
    return [l["name"] for l in semaine["sessions"][i]["exercises"]]


# --------------------------------------------------------------------------- #
# L'ORDRE — la décision produit que ce code porte
# --------------------------------------------------------------------------- #

def test_l_ordre_suit_les_MOUVEMENTS_pas_les_tiers(monde):
    """⚠️ FRE-29, DÉCISION WILLIAM DU 13/08. Un vendredi SQUAT tier 1 +
    MUSCLE UP tier 2 sortait le squat en tête tant que le tier primait. C'était
    défendable — la priorité du jour se fait à frais — mais imprévisible à la
    lecture : 138 jours sur 394 s'ordonnaient à rebours de l'ordre attendu."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"SQUAT": 1, "MUSCLE UP": 2}}],
        principles=[_principe("SQUAT", 1), _principe("MUSCLE UP", 2)],
    ))
    r = _generer(monde)
    assert r.status_code == 201, r.text[:300]
    assert _noms(r.json()) == ["MUSCLE UP", "SQUAT"]


def test_sans_selection_l_ordre_CANONIQUE_s_applique(monde):
    """⚠️ LE REPLI QUI MANQUAIT, et la vraie cause du désordre historique.
    `selectedPrincipaux` est NULL dans 48 BASE sur 111. Sans repli, le rang vaut
    « après tout le monde » pour chacun et l'ordre retombe sur celui d'AJOUT des
    principes — alors que l'éditeur, lui, affiche l'ordre canonique. Le coach
    voyait une chose et en générait une autre."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"DIPS": 1, "PULL UP": 1, "MUSCLE UP": 1}}],
        # Ajoutés dans le DÉSORDRE : c'est ce qui piège si le repli manque.
        principles=[_principe("DIPS", 1), _principe("PULL UP", 1), _principe("MUSCLE UP", 1)],
        selectedPrincipaux=None,
    ))
    assert _noms(_generer(monde).json()) == ["MUSCLE UP", "PULL UP", "DIPS"]


def test_la_selection_du_coach_l_emporte_sur_le_canonique(monde):
    """Le canonique n'est qu'un DÉFAUT : réordonner les chips dans l'éditeur doit
    changer la génération, sinon ce geste serait un décor."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"MUSCLE UP": 1, "SQUAT": 1}}],
        principles=[_principe("MUSCLE UP", 1), _principe("SQUAT", 1)],
        selectedPrincipaux=["SQUAT", "MUSCLE UP"],
    ))
    assert _noms(_generer(monde).json()) == ["SQUAT", "MUSCLE UP"]


def test_une_selection_VIDE_ne_declenche_PAS_le_repli(monde):
    """⚠️ LA LISTE VIDE ET `None` SONT DEUX ÉTATS, PAS UN SEUL. `[]` dit « le
    coach a retiré ses mouvements un par un » ; `None` dit « jamais configuré ».
    Le correctif `c66483c` a justement appris à la LECTURE à ne plus les
    confondre — et le repli écrit ici le 26/08 (`selection if selection else`)
    les réunissait aussitôt, `[]` étant falsy en Python.

    LE DÉCOR EST CELUI DU TEST CANONIQUE, aux principes ajoutés dans le désordre
    près : les deux ordres attendus sont donc l'exact miroir l'un de l'autre, et
    une sélection vide traitée comme absente fait rougir cette ligne."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"DIPS": 1, "PULL UP": 1, "MUSCLE UP": 1}}],
        principles=[_principe("DIPS", 1), _principe("PULL UP", 1), _principe("MUSCLE UP", 1)],
        selectedPrincipaux=[],
    ))
    # Aucun mouvement n'a de rang : l'ordre retombe sur celui d'AJOUT des
    # principes — et surtout PAS sur ["MUSCLE UP", "PULL UP", "DIPS"].
    assert _noms(_generer(monde).json()) == ["DIPS", "PULL UP", "MUSCLE UP"]


def test_le_tier_ne_departage_QUE_deux_lignes_du_meme_mouvement(monde):
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"PULL UP": 2}}],
        principles=[_principe("PULL UP", 2, sets="4"), _principe("PULL UP", 2, sets="6")],
    ))
    lignes = _generer(monde).json()["sessions"][0]["exercises"]
    # Deux principes du MÊME couple (mouvement, tier) : les deux sortent, dans
    # l'ordre de la BASE.
    assert [l["sets"] for l in lignes] == ["4", "6"]


def test_les_jours_sortent_dans_l_ordre_du_CYCLE(monde):
    """La grille est un tableau libre en base : son ordre de stockage ne dit rien.
    J3 ne doit pas s'afficher avant J1.

    ⚠️ ET J10 VIENT APRÈS J9 (20/09) : le rang se lit comme un NOMBRE. Un tri de
    chaînes rangerait « J10 » entre « J1 » et « J2 » — le défaut qu'un cycle de
    plus de neuf jours révélerait le premier jour où quelqu'un en configure un."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J10", "tiers": {"SQUAT": 1}},
                  {"day": "J3", "tiers": {"DIPS": 1}},
                  {"day": "J9", "tiers": {"PULL UP": 1}},
                  {"day": "J1", "tiers": {"MUSCLE UP": 1}}],
        principles=[_principe("SQUAT", 1), _principe("DIPS", 1),
                    _principe("PULL UP", 1), _principe("MUSCLE UP", 1)],
    ))
    assert [s["name"] for s in _generer(monde).json()["sessions"]] == ["J1", "J3", "J9", "J10"]


def test_la_seance_engendree_porte_le_LIBELLE_du_jour(monde):
    """Le coach nomme ses jours dans la trame, et la génération s'en sert (FRE-187).

    ⚠️ LE LIBELLÉ NE REMPLACE PAS `day`, IL S'AJOUTE À CÔTÉ. `day` reste
    l'identité du jour : il rattache les accessoires par égalité de chaîne, il
    donne le rang du cycle, et il entre dans l'identifiant des groupes engendrés.
    Un libellé qui l'écraserait délierait les trois d'un coup.

    Un jour sans libellé garde son `J<n>` — c'est le défaut, pas un manque.

    MUTATION QUI ROUGIT : rendre `jour["day"]` au lieu du libellé — la séance
    s'appelle « J1 » alors que la trame dit « Haut du corps »."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "label": "Haut du corps", "tiers": {"MUSCLE UP": 1}},
                  {"day": "J2", "tiers": {"SQUAT": 1}}],
        principles=[_principe("MUSCLE UP", 1), _principe("SQUAT", 1)],
    ))
    assert [s["name"] for s in _generer(monde).json()["sessions"]] == ["Haut du corps", "J2"]


def test_un_libelle_VIDE_laisse_le_jour_de_cycle(monde):
    """⚠️ `''` N'EST PAS UN NOM, c'est le défaut le plus répété du projet. Une case
    ouverte puis refermée sans rien écrire laisse une chaîne vide dans la trame :
    la prendre au mot donnerait une séance SANS NOM, que plus rien ne désigne à
    l'écran — et la semaine suivante se recopie par ce nom.

    MUTATION QUI ROUGIT : tester `is not None` au lieu de la chaîne nettoyée."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "label": "   ", "tiers": {"MUSCLE UP": 1}}],
        principles=[_principe("MUSCLE UP", 1)],
    ))
    assert [s["name"] for s in _generer(monde).json()["sessions"]] == ["J1"]


def test_les_accessoires_viennent_APRES_les_principes(monde):
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"SQUAT": 1}}],
        principles=[_principe("SQUAT", 1)],
        accessories=[_accessoire("LEG CURL", "J1")],
    ))
    assert _noms(_generer(monde).json()) == ["SQUAT", "LEG CURL"]


def test_un_jour_SANS_ligne_ne_fait_pas_de_seance(monde):
    """Une séance vide n'a aucun sens : le jour est dans la grille mais aucun
    principe ne correspond au couple demandé."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"SQUAT": 1}},
                  {"day": "J2", "tiers": {"DIPS": 3}}],
        principles=[_principe("SQUAT", 1)],
    ))
    assert [s["name"] for s in _generer(monde).json()["sessions"]] == ["J1"]


# --------------------------------------------------------------------------- #
# CE QUE LA LIGNE EMPORTE — garanties reprises des e2e du front, qui les
# tenaient par l'aperçu tant que la génération vivait là-bas.
# --------------------------------------------------------------------------- #

def test_la_NATURE_d_un_principe_se_reporte_dans_la_semaine(monde):
    """⚠️ FRE-10. Marquer une ligne « échauffement » dans le MODÈLE la marque dans
    chaque semaine qu'il engendre. Sans ce report, le coach referait le travail
    chaque semaine — et la BASE régénérerait des lignes d'entraînement
    par-dessus.

    `null` reste `null` : c'est « entraînement », et le contrat d'écriture
    REJETTE la chaîne vide (`kind: ''` faisait tomber la semaine entière en 422)."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"SQUAT": 1, "DIPS": 1}}],
        principles=[_principe("SQUAT", 1, kind="warmup"), _principe("DIPS", 1)],
    ))
    lignes = _generer(monde).json()["sessions"][0]["exercises"]
    assert {l["name"]: l["kind"] for l in lignes} == {"SQUAT": "warmup", "DIPS": None}


def test_les_VARIANTES_cumulées_suivent_la_génération(monde):
    """⚠️ FRE-33 : plusieurs variantes par ligne — « DS » + « PAUSE » plutôt qu'une
    entrée de plus au référentiel. Elles doivent traverser la génération dans
    leur ORDRE de saisie, qui est celui que le coach lit."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"PULL UP": 1}}],
        principles=[_principe("PULL UP", 1, variant=["Lesté", "Strict"])],
    ))
    assert _generer(monde).json()["sessions"][0]["exercises"][0]["variant"] == ["Lesté", "Strict"]


def test_la_semaine_générée_ne_PARTAGE_pas_les_listes_de_la_BASE(monde):
    """⚠️ LA COPIE DÉFENSIVE, invisible jusqu'au jour où elle manque. Sans
    `list(...)`, la ligne générée partagerait le tableau de variantes de la BASE :
    éditer l'une modifierait l'autre. C'est le défaut FRE-33, retrouvé en portant
    le code — et ici il se prouve par la BASE qui n'a pas bougé."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"PULL UP": 1}}],
        principles=[_principe("PULL UP", 1, variant=["Lesté"])],
    ))
    ligne = _generer(monde).json()["sessions"][0]["exercises"][0]
    _client().patch(f"/programs/{_P}/exercises/{ligne['id']}", headers=_AUTH,
                    json={"variant": ["Strict", "Pause"]})

    arbre = _client().get(f"/programs/{_P}/training", headers=_AUTH).json()
    base_relue = arbre["macros"][0]["blocks"][0]["base"]
    assert base_relue["principles"][0]["variant"] == ["Lesté"], "la BASE a suivi la semaine"


# --------------------------------------------------------------------------- #
# LES BI-SETS
# --------------------------------------------------------------------------- #

def test_un_bi_set_de_la_BASE_se_refabrique_dans_la_semaine(monde):
    """⚠️ UN IDENTIFIANT NEUF, JAMAIS CELUI DE LA BASE : le sien lui est local, et
    deux semaines générées porteraient sinon le même — les lignes de l'une se
    lieraient à celles de l'autre."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {}}],
        accessories=[_accessoire("CURL", "J1", groupId="g1"),
                     _accessoire("EXTENSION", "J1", groupId="g1")],
    ))
    lignes = _generer(monde).json()["sessions"][0]["exercises"]
    gids = {l["groupId"] for l in lignes}
    assert len(gids) == 1 and gids != {""}, "les deux membres partagent UN groupe neuf"
    assert "g1" not in gids, "l'identifiant de la BASE ne doit pas ressortir"


def test_un_groupe_resté_SEUL_ne_lie_rien(monde):
    """⚠️ ON NE RECRÉE PAS LES ORPHELINS. Un accessoire supprimé de la BASE laisse
    son partenaire avec un `groupId` qui ne relie plus rien — 5 lignes en
    production, invisibles à l'écran puisque l'affichage exige deux membres
    (FRE-31)."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {}}],
        accessories=[_accessoire("CURL", "J1", groupId="orphelin")],
    ))
    lignes = _generer(monde).json()["sessions"][0]["exercises"]
    assert lignes[0]["groupId"] is None


# --------------------------------------------------------------------------- #
# ⚠️ LA GARDE DE FRE-84 — ce qui protège le travail d'un athlète
# --------------------------------------------------------------------------- #

def test_une_semaine_DEJA_REMPLIE_ne_se_regenere_pas(monde):
    """Sur les 443 semaines de production, 423 portent du réalisé. Régénérer
    par-dessus les réinsérerait SANS les colonnes de réalisé — reps, charge, RPE
    ressenti, retour de l'athlète — et sans trace. Le geste destructeur doit être
    explicite : supprimer la semaine, puis générer (décision du 22/08)."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"SQUAT": 1}}],
        principles=[_principe("SQUAT", 1)],
    ))
    assert _generer(monde).status_code == 201

    r = _generer(monde)
    assert r.status_code == 409
    assert r.json()["code"] == "semaine_deja_remplie"


def test_generer_DEUX_FOIS_n_ajoute_pas_de_semaine(monde):
    """Le corollaire qu'on oublie : le refus ne doit pas laisser une semaine
    fantôme derrière lui."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {"SQUAT": 1}}],
        principles=[_principe("SQUAT", 1)],
    ))
    _generer(monde)
    _generer(monde)
    assert monde["pg"].execute(text(
        "SELECT count(*) FROM training_weeks w JOIN training_blocks b ON b.id = w.block_id "
        "WHERE b.id = CAST(:b AS uuid)"), {"b": monde["bloc"]}).scalar() == 1


# --------------------------------------------------------------------------- #
# L'APERÇU — la raison du déplacement
# --------------------------------------------------------------------------- #

def test_l_apercu_dit_EXACTEMENT_ce_que_la_generation_ecrira(monde):
    """⚠️ LA SPEC QUI JUSTIFIE TOUT LE CHANTIER. L'aperçu vivait en TypeScript,
    la génération allait vivre en Python : deux écritures de la même règle, qui
    ne divergent qu'un jour, et en silence. Ici les deux appellent la même
    fonction — ce test le VÉRIFIE plutôt que de le supposer.

    On compare la PRESCRIPTION, pas les identités : l'aperçu n'écrit rien, donc
    ses ids sont des étiquettes d'affichage."""
    base = _base(
        daySplit=[{"day": "J1", "tiers": {"SQUAT": 1, "MUSCLE UP": 2}},
                  {"day": "J4", "tiers": {"PULL UP": 1}}],
        principles=[_principe("SQUAT", 1), _principe("MUSCLE UP", 2), _principe("PULL UP", 1)],
        accessories=[_accessoire("CURL", "J1", groupId="g1"),
                     _accessoire("EXTENSION", "J1", groupId="g1")],
    )
    apercu = _client().post(f"/programs/{_P}/blocks/{monde['bloc']}/base/preview-week",
                            headers=_AUTH, json={"base": base})
    assert apercu.status_code == 200, apercu.text[:300]

    _poser_la_base(monde, base)
    generee = _generer(monde).json()

    def forme(semaine):
        return [(s["name"], [(l["name"], l["tier"], l["sets"]) for l in s["exercises"]])
                for s in semaine["sessions"]]

    assert forme(apercu.json()) == forme(generee)


def test_l_apercu_n_ECRIT_RIEN(monde):
    """Il porte sur un brouillon NON enregistré : s'il créait une semaine, chaque
    frappe dans l'éditeur de BASE en produirait une."""
    _client().post(f"/programs/{_P}/blocks/{monde['bloc']}/base/preview-week", headers=_AUTH,
                   json={"base": _base(daySplit=[{"day": "J1", "tiers": {"SQUAT": 1}}],
                                       principles=[_principe("SQUAT", 1)])})
    assert monde["pg"].execute(text("SELECT count(*) FROM training_weeks")).scalar() == 0


# --------------------------------------------------------------------------- #
# LA PORTE
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("chemin", ["generate-week", "base/preview-week"])
def test_un_coach_ETRANGER_ne_genere_pas(monde, chemin):
    """Même garde que le reste de la structure : le programme de l'URL ne dit
    rien du droit sur l'objet visé."""
    monde["pg"].execute(text("INSERT INTO users (uid, email) VALUES ('coach-2','b@x.fr')"))
    monde["pg"].execute(text("INSERT INTO coaches (uid) VALUES ('coach-2')"))
    r = _client("coach-2").post(f"/programs/{_P}/blocks/{monde['bloc']}/{chemin}",
                                headers=_AUTH, json={"base": _base()})
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# LA NATURE DU GROUPE TRAVERSE LA GÉNÉRATION (FRE-36)
# --------------------------------------------------------------------------- #

def test_un_DROPSET_de_la_BASE_reste_un_dropset_dans_la_semaine(monde):
    """⚠️ SANS ÇA, RÉGÉNÉRER REBASCULE UN DROPSET EN BI-SET. La BASE porte la
    nature, la semaine générée est refabriquée de zéro : le champ non recopié
    disparaît en silence, et le coach retrouve un bi-set là où il avait prescrit
    des descentes. C'est le défaut que ce projet répète — quelque chose ne casse
    pas, quelque chose s'efface."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {}}],
        accessories=[_accessoire("BACK EXTENSION", "J1", groupId="g1", groupKind="dropset"),
                     _accessoire("BACK EXTENSION", "J1", groupId="g1", groupKind="dropset")],
    ))
    lignes = _generer(monde).json()["sessions"][0]["exercises"]
    assert {l["groupKind"] for l in lignes} == {"dropset"}


def test_un_EMOM_de_la_BASE_reste_un_EMOM_avec_son_intervalle(monde):
    """La génération recopie la nature et le temps du groupe (FRE-116). Sans ça,
    régénérer transformerait un EMOM en rotation en bi-set sans temps.

    MUTATION QUI ROUGIT : le `Literal` de nature sans `emom` — l'éditeur de BASE
    refuse alors la trame."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {}}],
        accessories=[_accessoire("CURL", "J1", groupId="g1", groupKind="emom",
                                 format="EMOM", clusterMode="60"),
                     _accessoire("EXTENSION", "J1", groupId="g1", groupKind="emom")],
    ))
    lignes = _generer(monde).json()["sessions"][0]["exercises"]
    assert {l["groupKind"] for l in lignes} == {"emom"}
    assert {l["clusterMode"] for l in lignes} == {"60"}
    assert {l["format"] for l in lignes} == {None}


def test_le_lien_UNBROKEN_de_la_BASE_passe_dans_la_semaine(monde):
    """Le coach pose « sans lâcher » dans sa trame : la semaine générée doit le
    porter, et jamais sur la dernière ligne du groupe (FRE-116).

    MUTATION QUI ROUGIT : ne pas recopier `unbroken` à la génération."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {}}],
        accessories=[_accessoire("CURL", "J1", groupId="g1", groupKind="circuit", unbroken=True),
                     _accessoire("EXTENSION", "J1", groupId="g1", groupKind="circuit", unbroken=True),
                     _accessoire("LEG CURL", "J1", groupId="g1", groupKind="circuit", unbroken=True)],
    ))
    lignes = _generer(monde).json()["sessions"][0]["exercises"]
    assert [l["unbroken"] for l in lignes] == [True, True, False]


def test_un_groupe_SANS_nature_sort_en_bi_set(monde):
    """Le FILET de lecture : un groupe sans nature reste lisible.

    Les groupes de production portent tous la leur depuis la reprise du 29/08,
    mais un import ou une fixture peut encore en produire un sans — et l'écran
    doit alors montrer quelque chose de juste plutôt que rien."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {}}],
        accessories=[_accessoire("CURL", "J1", groupId="g1"),
                     _accessoire("EXTENSION", "J1", groupId="g1")],
    ))
    lignes = _generer(monde).json()["sessions"][0]["exercises"]
    assert {l["groupKind"] for l in lignes} == {"biset"}


def test_l_identifiant_genere_PORTE_la_nature(monde):
    """⚠️ PAS COSMÉTIQUE. Ces identifiants se lisent dans la base et dans les
    journaux ; un dropset nommé `biset-…` mentirait à la première personne qui
    l'inspecte — le genre de faux indice qui coûte une heure."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {}}],
        accessories=[_accessoire("BACK EXTENSION", "J1", groupId="g1", groupKind="dropset"),
                     _accessoire("BACK EXTENSION", "J1", groupId="g1", groupKind="dropset")],
    ))
    lignes = _generer(monde).json()["sessions"][0]["exercises"]
    assert all(l["groupId"].startswith("dropset-") for l in lignes)


def test_une_ligne_HORS_groupe_sort_sans_nature(monde):
    """⚠️ `''` ET NON « biset » : une ligne libre n'est pas un groupe d'un seul
    membre. Lui donner une nature ferait croire à l'écran qu'il y a un groupe à
    afficher."""
    _poser_la_base(monde, _base(
        daySplit=[{"day": "J1", "tiers": {}}],
        accessories=[_accessoire("CURL", "J1")],
    ))
    lignes = _generer(monde).json()["sessions"][0]["exercises"]
    assert lignes[0]["groupKind"] is None


# --------------------------------------------------------------------------- #
# LA TRAME DOIT PORTER SES DATES (FRE-138)
# --------------------------------------------------------------------------- #

def test_generer_SANS_dates_de_S1_est_refuse(monde):
    """⚠️ CE REFUS FERME LA SOURCE D'UN DÉFAUT MESURÉ, il ne protège pas un
    invariant théorique. La date de S1 est la SEULE origine des dates de semaine :
    la génération la recopie, `blockWeekDates` en dérive les suivantes, et le
    suivi projette sur `coalesce(session_date, week.start_date)`. Sans elle, la
    chaîne entière est nue et la ligne réalisée n'existe pour aucun agrégat.

    Mesuré sur la production le 08/09 : 3 687 lignes portant une trace de
    réalisation sont hors de toute projection, et 3 568 — 97 % — viennent d'un
    bloc sans date de S1. C'est la cause, pas une corrélation.

    ⚠️ ET IL EST POSÉ ICI, PAS SUR `PUT /base`. La trame se compose par petits
    gestes, dont chacun renvoie la BASE entière : exiger les dates à l'écriture
    rendrait la composition impossible avant qu'elle ait commencé, et 85 blocs
    existants n'en ont pas. La contrainte se pose au moment où le vide devient
    coûteux — celui où une semaine naît.

    ⚠️ LES DEUX DATES SONT EXIGÉES, ET LA FIN N'EST PAS UN DOUBLON DU DÉBUT
    (décision William, 09/09). Elle ne dit pas seulement quand S1 s'arrête : c'est
    elle qui donne la LONGUEUR que la cascade applique à TOUTES les semaines du
    bloc (`blockWeekDates`, `lengthDays`). Sans elle, le front retombe sur
    « début + 6 jours », donc impose sept jours à tout le bloc sans que personne
    l'ait demandé — et dix semaines de production n'en font pas sept.

    La première rédaction ne demandait que le début, en arguant que le repli
    « est une semaine ». C'est vrai et hors sujet : le repli n'est pas faux, il
    est MUET, et il décide à la place du coach."""
    _poser_la_base(monde, _base(s1StartDate="", s1EndDate="",
                                daySplit=[{"day": "J1", "tiers": {"SQUAT": 1}}],
                                principles=[_principe("SQUAT", 1)]))
    r = _generer(monde)
    assert r.status_code == 409
    assert r.json()["code"] == "base_sans_dates"

    # ⚠️ ET RIEN N'A ÉTÉ ÉCRIT. Un refus rendu APRÈS coup ne vaudrait rien : le
    # bloc repartirait avec une semaine à moitié faite, que le coach devrait
    # supprimer avant de réessayer.
    assert monde["pg"].execute(text(
        "SELECT count(*) FROM training_weeks WHERE block_id = CAST(:b AS uuid)"),
        {"b": monde["bloc"]}).scalar() == 0


def test_generer_avec_la_SEULE_date_de_debut_est_refuse_AUSSI(monde):
    """⚠️ LE CAS QUI DIT QUELLE MOITIÉ DE LA RÈGLE ON TIENT. Une trame à moitié
    datée est le cas RÉEL — quatre blocs de production portent un début sans fin,
    zéro l'inverse. C'est donc lui qu'il faut éprouver, pas la trame entièrement
    nue, qui tomberait sur la première condition quoi qu'il arrive."""
    _poser_la_base(monde, _base(s1StartDate="2026-09-07", s1EndDate="",
                                daySplit=[{"day": "J1", "tiers": {"SQUAT": 1}}],
                                principles=[_principe("SQUAT", 1)]))
    r = _generer(monde)
    assert r.status_code == 409
    assert r.json()["code"] == "base_sans_dates"


# --------------------------------------------------------------------------- #
# LE NOM D'UN JOUR — la semaine par défaut sur sept jours (30/09)
# --------------------------------------------------------------------------- #

def test_un_cycle_de_sept_jours_nomme_ses_jours_comme_la_semaine():
    """Les 202 trames de production font sept jours, et 3 seulement portaient des
    noms : le geste qui les posait était oublié. MUTATION QUI ROUGIT : rendre
    `jour["day"]` sans regarder la longueur du cycle."""
    from app.entrainement.generation_semaine import nom_du_jour
    assert [nom_du_jour({"day": f"J{i}"}, 7) for i in range(1, 8)] == [
        "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]


def test_le_libelle_du_coach_prime_et_une_chaine_d_espaces_n_en_est_pas_un():
    from app.entrainement.generation_semaine import nom_du_jour
    assert nom_du_jour({"day": "J1", "label": "Jambes"}, 7) == "Jambes"
    assert nom_du_jour({"day": "J1", "label": "   "}, 7) == "Lundi"


def test_un_autre_cycle_garde_ses_J():
    """Nommer J8 « lundi » n'aurait aucun sens : hors de sept jours, `J<n>`."""
    from app.entrainement.generation_semaine import nom_du_jour
    assert nom_du_jour({"day": "J1"}, 9) == "J1"
    assert nom_du_jour({"day": "J3"}, 5) == "J3"


def test_la_seance_generee_porte_le_nom_du_jour(monde):
    """Le chemin réel : une trame de sept jours sans libellé génère « Lundi »."""
    jours = [{"day": f"J{i}", "tiers": {"SQUAT": 1} if i == 1 else {}} for i in range(1, 8)]
    _poser_la_base(monde, _base(daySplit=jours, principles=[_principe("SQUAT", 1)]))
    r = _generer(monde)
    assert r.status_code == 201, r.text[:200]
    assert [s["name"] for s in r.json()["sessions"]] == ["Lundi"]
