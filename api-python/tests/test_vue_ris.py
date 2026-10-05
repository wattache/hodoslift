"""La vue `competition_scores` agrège-t-elle selon les bonnes règles ? (FRE-92)

⚠️ CES SPECS ONT DÉMÉNAGÉ, et le déménagement est le sujet. Le total du barème a
d'abord été écrit en Python, à côté de la vue qui le calculait déjà en SQL :
deux définitions d'une même règle, exactement le défaut que ce projet répète.
Python ne garde plus que le barème (dix constantes, du métier) ; l'agrégation
vit ici, et les specs l'ont suivie.

⚠️ ET LE SCORE N'EST PAS LE TOTAL DU BARÈME. Le premier additionne TOUS les
mouvements disputés, le second n'en retient que quatre places. La même vue rend
les deux, et c'est voulu : ils parcourent les mêmes lignes.
"""

import pytest
from sqlalchemy import text

_COMP = "cccccccc-0000-0000-0000-000000000001"


@pytest.fixture
def compet(pg):
    """Une compétition, un participant, et de quoi lui poser des essais."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','c@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO competitions (id, name, start_date, end_date, created_by) "
        "VALUES (CAST(:c AS uuid), 'Open', DATE '2026-05-01', DATE '2026-05-01', 'coach-1')"),
        {"c": _COMP})
    pid = pg.execute(text(
        "INSERT INTO competition_participants (competition_id, name, bodyweight_kg, gender) "
        "VALUES (CAST(:c AS uuid), 'Bob', 80, 'M') RETURNING id"), {"c": _COMP}).scalar()
    # ⚠️ LES QUATRE PLACES SONT DÉCLARÉES, ESSAIS OU PAS (FRE-147). Le barème ne
    # s'applique qu'à une compétition qui dispute ce qu'il note ; les specs
    # d'ici n'inscrivaient qu'un ou deux mouvements, décrivant des épreuves qui
    # n'existent pas — les 8 compétitions de production disputent toutes les
    # quatre. Déclarer sans essai ne change AUCUN total : `meilleurs` ne porte
    # que des essais réussis, et le LEFT JOIN ne compte que ses lignes.
    for position, mouvement in enumerate(
            ("MUSCLE UP", "PULL UP", "DIPS", "SQUAT"), start=10):
        pg.execute(text(
            "INSERT INTO competition_movements (competition_id, movement, position) "
            "VALUES (CAST(:c AS uuid), :m, :p) ON CONFLICT DO NOTHING"),
            {"c": _COMP, "m": mouvement, "p": position})
    return {"pg": pg, "participant": pid}


def _essai(monde, mouvement: str, poids: float, result: str = "rep", position: int = 1):
    mid = monde["pg"].execute(text(
        "INSERT INTO competition_movements (competition_id, movement, position) "
        "VALUES (CAST(:c AS uuid), :m, :p) "
        "ON CONFLICT DO NOTHING RETURNING id"),
        {"c": _COMP, "m": mouvement, "p": position}).scalar()
    if mid is None:
        mid = monde["pg"].execute(text(
            "SELECT id FROM competition_movements WHERE competition_id = CAST(:c AS uuid) "
            "AND movement = :m"), {"c": _COMP, "m": mouvement}).scalar()
    n = monde["pg"].execute(text(
        "SELECT coalesce(max(attempt_index), 0) + 1 FROM competition_attempts "
        "WHERE participant_id = :p AND movement_id = :m"), {"p": monde["participant"], "m": mid}).scalar()
    monde["pg"].execute(text(
        "INSERT INTO competition_attempts (participant_id, movement_id, attempt_index, "
        "weight_kg, result) VALUES (:p, :m, :i, :w, CAST(:r AS attempt_result))"),
        {"p": monde["participant"], "m": mid, "i": n, "w": poids, "r": result})


def _lire(monde) -> dict:
    return monde["pg"].execute(text(
        "SELECT score, total_bareme_kg, bodyweight_kg, gender FROM competition_scores "
        "WHERE participant_id = :p"), {"p": monde["participant"]}).mappings().one()


def test_le_PULL_UP_et_le_CHIN_UP_se_disputent_UNE_place(compet):
    """⚠️ QUATRE PLACES, CINQ MOUVEMENTS — règle de la fédération, et LE FRONT NE
    LA SUIT PAS : il écarte purement le chin up.

    Ce n'est pas anodin. Mesuré le 21/08 sur la vraie donnée : 58 athlètes ont un
    1RM au chin up, et ONZE y sont plus forts qu'au pull up. Leur total, donc
    leur RIS, donc leur rang, est sous-estimé depuis toujours — en silence, parce
    qu'un score bas ne se remarque pas comme un score absent.

    (C'était vrai du RIS « table RM », qui n'existe plus. En compétition, aucun
    chin up n'a encore été disputé au 22/08 : la règle attend sa première
    épreuve — raison de plus pour qu'elle soit écrite ici avant.)"""
    _essai(compet, "SQUAT", 160, position=1)
    _essai(compet, "PULL UP", 60, position=2)
    _essai(compet, "CHIN UP", 70, position=3)

    ligne = _lire(compet)
    assert ligne["total_bareme_kg"] == 230, "le plus lourd des deux, pas les deux"
    assert ligne["score"] == 290, "le SCORE, lui, additionne bien les trois"


def test_un_chin_up_SEUL_compte_quand_même(compet):
    """Une concurrence, pas une condition : un athlète qui ne fait que du chin up
    n'a pas un trou dans son total."""
    _essai(compet, "CHIN UP", 70)
    assert _lire(compet)["total_bareme_kg"] == 70


def test_un_mouvement_ANNEXE_entre_dans_le_score_mais_PAS_dans_le_barème(compet):
    """La raison d'être des deux colonnes. Réutiliser le score comme total
    gonflerait le RIS de tout mouvement annexe inscrit à l'épreuve."""
    _essai(compet, "SQUAT", 100, position=1)
    _essai(compet, "BENCH PRESS", 120, position=2)

    ligne = _lire(compet)
    assert ligne["score"] == 220
    assert ligne["total_bareme_kg"] == 100


def test_seuls_les_essais_RÉUSSIS_comptent(compet):
    _essai(compet, "DIPS", 80, "rep")
    _essai(compet, "DIPS", 200, "norep")      # raté, aussi lourd soit-il
    _essai(compet, "DIPS", 90, "rep")
    assert _lire(compet)["total_bareme_kg"] == 90


def test_la_CASSE_du_mouvement_n_empêche_pas_de_compter(compet):
    """Le nom est du texte libre validé contre la bibliothèque, « comparaison
    insensible casse » dit le schéma. La vue doit suivre la même règle, sinon un
    « Squat » saisi ainsi sortirait du barème sans que personne ne le voie."""
    _essai(compet, "Squat", 160)
    assert _lire(compet)["total_bareme_kg"] == 160


def test_un_participant_SANS_essai_a_un_total_nul(compet):
    """Il est inscrit, il n'a rien soulevé : zéro, et pas d'absence de ligne —
    c'est ce qui permet de le distinguer d'un athlète sans compétition."""
    ligne = _lire(compet)
    assert ligne["score"] == 0 and ligne["total_bareme_kg"] == 0


def test_une_epreuve_qui_ne_dispute_PAS_les_quatre_places_n_a_PAS_de_barème(pg):
    """FRE-147 — la seule conséquence d'avoir ouvert le deadlift à la compétition.

    ⚠️ LE SCORE EST GÉNÉRIQUE, LE BARÈME NE L'EST PAS. Une street à quatre
    mouvements et une SBD à trois donnent chacune leur SCORE, sans liste en dur.
    Mais `total_bareme_kg` note QUATRE PLACES NOMMÉES : sur une SBD, il ne
    trouverait que le squat et rendrait un tiers du total — que
    `_RIS_CANDIDATS_SQL` retiendrait, ne filtrant que sur `> 0`. Un RIS bâti sur
    un squat, présenté comme un RIS.

    Zéro, donc : « pas de total au barème » et non « un petit total ». C'est la
    distinction vide/NULL du projet, ici sur un score.

    ⚠️ ET ÇA NE PEUT PAS SE TESTER SUR LA FIXTURE `compet`, qui déclare
    désormais les quatre places — d'où une compétition à elle."""
    autre = "cccccccc-0000-0000-0000-000000000002"
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-2','c2@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-2')"))
    pg.execute(text(
        "INSERT INTO competitions (id, name, start_date, end_date, created_by) "
        "VALUES (CAST(:c AS uuid), 'SBD', DATE '2026-06-01', DATE '2026-06-01', 'coach-2')"),
        {"c": autre})
    pid = pg.execute(text(
        "INSERT INTO competition_participants (competition_id, name, bodyweight_kg, gender) "
        "VALUES (CAST(:c AS uuid), 'Bob', 80, 'M') RETURNING id"), {"c": autre}).scalar()
    for position, (mouvement, poids) in enumerate(
            (("SQUAT", 160), ("BENCH", 100), ("DEADLIFT", 200)), start=1):
        mid = pg.execute(text(
            "INSERT INTO competition_movements (competition_id, movement, position) "
            "VALUES (CAST(:c AS uuid), :m, :p) RETURNING id"),
            {"c": autre, "m": mouvement, "p": position}).scalar()
        pg.execute(text(
            "INSERT INTO competition_attempts (participant_id, movement_id, attempt_index, "
            "weight_kg, result) VALUES (:p, :m, 1, :w, 'rep')"),
            {"p": pid, "m": mid, "w": poids})

    ligne = pg.execute(text(
        "SELECT score, total_bareme_kg FROM competition_scores WHERE participant_id = :p"),
        {"p": pid}).mappings().one()
    assert ligne["score"] == 460, "le score, lui, additionne les trois — sans rien savoir du SBD"
    assert ligne["total_bareme_kg"] == 0, "le barème street ne note pas une épreuve de SBD"


def test_un_mouvement_annexe_ne_PRIVE_pas_de_barème(compet):
    """⚠️ LA RÈGLE EST POSITIVE, ET C'EST CETTE SPEC QUI LE DIT. « Le barème
    s'applique quand l'épreuve dispute ce qu'il note » — pas « quand elle ne
    dispute rien d'autre ». Écrite en négatif, la borne aurait effacé le RIS
    d'une street qui inscrit un mouvement en bonus, alors que le barème sait
    parfaitement l'ignorer : c'est même sa définition, et
    `test_un_mouvement_ANNEXE_entre_dans_le_score_mais_PAS_dans_le_barème` le
    tenait déjà."""
    _essai(compet, "SQUAT", 160, position=1)
    _essai(compet, "PULL UP", 60, position=2)
    _essai(compet, "DEADLIFT", 220, position=3)   # le bonus, désormais possible

    ligne = _lire(compet)
    assert ligne["score"] == 440
    assert ligne["total_bareme_kg"] == 220, "le squat et le tirage, sans le deadlift"


def test_la_vue_rend_le_POIDS_et_le_GENRE_du_jour(compet):
    """⚠️ LES DEUX ENTRÉES DU BARÈME, figées par la participation. C'est ce couple
    qui rend le RIS honnête : le total et le poids y sont enregistrés par le même
    acte, ce que la table des 1RM ne pourra jamais garantir."""
    ligne = _lire(compet)
    assert ligne["bodyweight_kg"] == 80 and ligne["gender"] == "M"
