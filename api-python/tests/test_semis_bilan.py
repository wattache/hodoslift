"""Le SEMIS des 32 tests tient-il ses propres promesses ?

⚠️ CE QUE CES SPECS PROTÈGENT N'EST PAS DU CODE, C'EST DE LA DONNÉE TRANSCRITE À
LA MAIN. 32 tests recopiés d'un Google Form : la seule façon qu'une erreur a de se
voir, c'est qu'une spec la nomme. Et le semis n'a lieu qu'UNE fois — après, la
kiné retouche en base, et une coquille semée devient une coquille installée.

Elles ont d'ailleurs déjà servi : la spec annonçait « 7 en répétitions, 6 en
secondes » quand son propre tableau donnait 8 et 5. Le total (13) était juste, la
ventilation non — écart trouvé en écrivant `test_le_compte_par_MESURE`.
"""

import pytest
from sqlalchemy import text

from app.kine.semis_bilan import MODELE_NOM, RUBRIQUES, TESTS, Epreuve
from scripts.semer_modele_bilan import semer


def test_il_y_a_bien_32_tests():
    assert len(TESTS) == 32


def test_le_compte_par_FAMILLE():
    """§5 : 2 généraux, 15 de mobilité, 15 d'activation."""
    par_famille: dict[str, int] = {}
    for t in TESTS:
        par_famille[t.famille] = par_famille.get(t.famille, 0) + 1
    assert par_famille == {"general": 2, "mobilite": 15, "activation": 15}


def test_CHAQUE_FAMILLE_a_sa_rubrique():
    """⚠️ SINON DES TESTS NE SERAIENT JAMAIS SEMÉS, en silence : la boucle du semis
    parcourt les RUBRIQUES et filtre les tests par famille. Une famille orpheline
    ne lèverait aucune erreur — elle laisserait simplement des tests au sol."""
    familles_semees = {f for f, _ in RUBRIQUES}
    assert {t.famille for t in TESTS} == familles_semees


def test_le_compte_par_MESURE():
    """⚠️ LA SPEC SE CONTREDISAIT ICI, et c'est ce test qui l'a montré.

    Son §5 dit « 13 mesurés (7 en répétitions, 6 en secondes) » ; son tableau
    donne 8 en répétitions et 5 en secondes. Le total est bon, la ventilation
    non. Le TABLEAU fait foi — c'est lui qui porte le détail test par test, donc
    lui qu'on a transcrit."""
    reps = [t.code for t in TESTS if t.mesure == "reps"]
    secondes = [t.code for t in TESTS if t.mesure == "secondes"]
    sans = [t.code for t in TESTS if t.mesure is None]

    assert len(reps) == 8, sorted(reps)
    assert len(secondes) == 5, sorted(secondes)
    assert len(reps) + len(secondes) == 13, "le total du §5, lui, est juste"
    assert len(sans) == 19  # 15 mobilité + 2 généraux + grand pectoral + grand dorsal


def test_AUCUNE_mobilite_ne_porte_de_mesure():
    """Le ressenti seul, par construction : ces tests observent un mouvement, ils
    ne le chiffrent pas. Une mesure qui apparaîtrait ici serait une erreur de
    transcription, pas une évolution du protocole."""
    for t in TESTS:
        if t.famille == "mobilite":
            assert t.mesure is None, f"{t.code} porte une mesure"
            assert not t.bilateral, f"{t.code} est déclaré bilatéral"


def test_les_DEUX_tests_de_TRONC_ne_sont_pas_bilateraux():
    """⚠️ §3.5 — LE DÉFAUT VENU DU FORMULAIRE. Il demandait « Droite/Gauche » sur
    l'érecteur du rachis et le transverse : un artefact de copier-coller sur des
    tests de TRONC, qui n'ont pas de côté.

    Les laisser bilatéraux remplirait `mesure_droite` au hasard sur ces tests-là,
    pour des années, et personne ne s'en apercevrait avant d'essayer de comparer."""
    par_code = {t.code: t for t in TESTS}
    assert par_code["erecteur_rachis"].bilateral is False
    assert par_code["transverse_grands_droits"].bilateral is False


def test_un_test_BILATERAL_est_forcement_MESURE():
    """Deux résultats n'ont de sens que s'il y a quelque chose à mettre dedans.
    Un test bilatéral sans mesure serait deux cases de ressenti — ce que le modèle
    ne prévoit pas (`bilan_resultats` porte UN ressenti par test)."""
    for t in TESTS:
        if t.bilateral:
            assert t.mesure is not None, f"{t.code} est bilatéral sans mesure"


def test_toute_CHARGE_est_positive_et_toute_CIBLE_va_avec_un_maintien():
    for t in TESTS:
        if t.charge_kg is not None:
            assert t.charge_kg > 0, f"{t.code} : charge {t.charge_kg}"
        if t.cible is not None:
            assert t.mesure == "secondes", f"{t.code} : cible sans maintien"


def test_chaque_test_porte_un_protocole_et_une_vue():
    """Sans protocole, l'athlète ne sait pas quoi faire ; sans vue, il ne sait pas
    comment se filmer. Les deux font partie de ce qui s'affiche, même si la vidéo
    elle-même est hors périmètre du lot A."""
    for t in TESTS:
        assert t.protocole.strip(), f"{t.code} sans protocole"
        assert t.vues, f"{t.code} sans angle de vue"


def test_les_codes_sont_UNIQUES():
    """Les codes ne partent pas en base — la vérité y est portée par des uuid.
    Ils restent la clé de lecture DU SEMIS : deux tests qui partageraient un code
    signaleraient un copier-coller inachevé dans la transcription."""
    codes = [t.code for t in TESTS]
    assert len(codes) == len(set(codes))
    for c in codes:
        assert c == c.lower().strip() and " " not in c


def test_le_semis_est_IMMUABLE_en_mémoire():
    """Un semis qu'un appel pourrait modifier en mémoire ne serait plus une
    référence. `frozen=True` le dit ; ce test le prouve."""
    with pytest.raises(Exception):
        TESTS[0].charge_kg = 20  # type: ignore[misc]
    assert isinstance(TESTS[0], Epreuve)


# --------------------------------------------------------------------------- #
# Le semis, exécuté pour de vrai
# --------------------------------------------------------------------------- #

def test_SEMER_produit_le_modèle_attendu(pg):
    """⚠️ LA TRANSCRIPTION NE VAUT QUE SI ELLE ARRIVE EN BASE. Les specs ci-dessus
    gardent la donnée dans le fichier ; celle-ci garde le TRAJET — l'ordre des
    rubriques, le filtrage par famille, et la conversion `None` → `'aucune'` que la
    colonne exige."""
    modele_id, total = semer(pg)
    assert total == 32

    rubriques = pg.execute(text(
        "SELECT libelle, ordre FROM bilan_rubriques WHERE modele_id = CAST(:m AS uuid) "
        "ORDER BY ordre"), {"m": modele_id}).all()
    assert [r[0] for r in rubriques] == [libelle for _, libelle in RUBRIQUES]

    nom = pg.execute(text("SELECT nom FROM bilan_modeles WHERE id = CAST(:m AS uuid)"),
                     {"m": modele_id}).scalar()
    assert nom == MODELE_NOM

    grip = pg.execute(text(
        "SELECT mesure, bilateral, charge_kg, materiel, vues, cible FROM bilan_tests t "
        "JOIN bilan_rubriques r ON r.id = t.rubrique_id "
        "WHERE r.modele_id = CAST(:m AS uuid) AND t.libelle = 'Grip'"),
        {"m": modele_id}).mappings().first()
    assert grip["mesure"] == "secondes" and grip["bilateral"] is True
    assert float(grip["charge_kg"]) == 15 and grip["materiel"] == "disque"
    assert list(grip["vues"]) == ["profil"]


def test_un_test_SANS_MESURE_est_semé_en_aucune_pas_en_NULL(pg):
    """⚠️ LA COLONNE EST `NOT NULL` — un `None` transmis tel quel ferait échouer le
    semis à mi-parcours. Et sémantiquement, « aucune » se lit ; un NULL se
    devine, et chaque lecteur le devinerait à sa façon."""
    modele_id, _ = semer(pg)
    sans = pg.execute(text(
        "SELECT count(*) FROM bilan_tests t JOIN bilan_rubriques r ON r.id = t.rubrique_id "
        "WHERE r.modele_id = CAST(:m AS uuid) AND t.mesure = 'aucune'"),
        {"m": modele_id}).scalar()
    assert sans == 19
