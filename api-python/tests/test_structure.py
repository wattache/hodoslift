"""`GET /programs/{id}/structure` — la charpente, sans le contenu (FRE-119).

⚠️ CE QUE CES SPECS PROTÈGENT, ET POURQUOI ELLES SONT DEUX FOIS PLUS SÉVÈRES
QU'IL N'Y PARAÎT. Une lecture allégée se dégrade dans DEUX directions, et une
seule des deux se voit :

  * elle en dit TROP — une séance qui repasse dans la réponse, et les 512 Ko
    reviennent sans que rien ne casse. C'est le mode d'échec silencieux, celui
    qui annule le ticket en douce ;
  * elle en dit TROP PEU — un champ que le calendrier lit disparaît, et la frise
    se vide. Celui-là se voit tout de suite.

D'où deux familles d'assertions : ce qui DOIT être là (ce que la frise lit), et
ce qui NE DOIT PAS y être (les séances, les lignes, la BASE).
"""

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.usefixtures("pg")

_AUTH = {"Authorization": "Bearer x"}


@pytest.fixture
def monde(pg):
    """Un programme avec deux blocs, dont un a une semaine VIDE — l'état que
    `sessionCount` doit savoir distinguer."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','c@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','a1','coach-1','Léa','Martin')"))
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                    "VALUES ('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    macro = pg.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number, name) "
        "VALUES ('p1','m1',1,'Prépa') RETURNING id")).scalar()
    bloc = pg.execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number, name, start_date, end_date) "
        f"VALUES ('{macro}','b1',1,'Intensification', DATE '2026-05-01', DATE '2026-05-28') "
        "RETURNING id")).scalar()
    pleine = pg.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number, name, start_date, end_date, "
        "athlete_weight_kg, athlete_height_cm) "
        f"VALUES ('{bloc}','w1',1,'Semaine 1', DATE '2026-05-01', DATE '2026-05-07', 62, 168) "
        "RETURNING id")).scalar()
    pg.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number, start_date, end_date) "
        f"VALUES ('{bloc}','w2',2, DATE '2026-05-08', DATE '2026-05-14')"))
    seance = pg.execute(text(
        "INSERT INTO training_sessions (week_id, legacy_id, position, name) "
        f"VALUES ('{pleine}','s1',1,'Lundi') RETURNING id")).scalar()
    for i, nom in enumerate(("SQUAT", "MUSCLE UP"), start=1):
        pg.execute(text(
            "INSERT INTO training_exercises (session_id, position, name, sets, reps) "
            f"VALUES ('{seance}',{i},'{nom}','4','5')"))
    pg.execute(text(
        "INSERT INTO block_objectives (block_id, position, exercise, sets, reps) "
        f"VALUES ('{bloc}',1,'SQUAT','5','3')"))
    return pg


def _lire(client):
    r = client.get("/programs/p1/structure", headers=_AUTH)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def test_la_charpente_porte_ce_que_la_frise_LIT(monde, auth_as):
    """Le calendrier dessine des blocs et des semaines datés, avec les objectifs
    du bloc — c'est tout, et il doit tout trouver ici.

    ⚠️ LA PÉRIODE D'UN BLOC EST CELLE DE SES SEMAINES (William, 24/09). Le décor
    stocke exprès une fin de bloc au 28 mai dans `training_blocks.end_date`,
    alors que ses semaines s'arrêtent au 14 : c'est la divergence réelle qui
    laissait un trou d'un mois dans la frise (un bloc borné à sa seule S1). Ce
    qui sort, c'est le 14.

    MUTATION QUI ROUGIT : rendre `b["end_date"]` au lieu de `_bornes`."""
    structure = _lire(auth_as(uid="coach-1"))

    macro = structure["macros"][0]
    assert (macro["macroNumber"], macro["name"]) == (1, "Prépa")
    bloc = macro["blocks"][0]
    assert (bloc["name"], bloc["startDate"], bloc["endDate"]) == (
        "Intensification", "2026-05-01", "2026-05-14")
    assert [o["exercise"] for o in bloc["objectives"]] == ["SQUAT"]
    assert [(w["weekNumber"], w["startDate"]) for w in bloc["weeks"]] == [
        (1, "2026-05-01"), (2, "2026-05-08")]
    # Le poids et la taille sont des mesures DATÉES de la semaine : la frise les
    # ignore, mais le contrat les porte déjà et les retirer serait une perte.
    assert bloc["weeks"][0]["athlete"] == {
        "firstName": "Léa", "lastName": "Martin", "weight": 62.0, "height": 168.0}


def test_le_CONTENU_n_y_est_PAS(monde, auth_as):
    """⚠️ LA SPEC QUI PROTÈGE LE TICKET. Une séance qui repasse dans la réponse
    ramène les 512 Ko sans rien casser — personne ne le verrait avant la
    prochaine mesure. `extra="forbid"` sur le modèle refuserait la clé au
    sérialiseur ; ceci l'affirme sur la réponse RÉELLE, celle qui part sur le
    fil."""
    structure = _lire(auth_as(uid="coach-1"))
    bloc = structure["macros"][0]["blocks"][0]

    assert "base" not in bloc, "la BASE ferait passer la réponse de 10 à 56 Ko"
    for semaine in bloc["weeks"]:
        assert "sessions" not in semaine
        assert "exercises" not in semaine


def test_sessionCount_distingue_une_semaine_VIDE(monde, auth_as):
    """C'est la seule chose que la barre a besoin de savoir du contenu : la
    pastille d'une semaine sans séance s'éteint."""
    semaines = _lire(auth_as(uid="coach-1"))["macros"][0]["blocks"][0]["weeks"]
    assert [w["sessionCount"] for w in semaines] == [1, 0]


def test_la_charpente_dit_la_MEME_chose_que_l_arbre(monde, auth_as):
    """⚠️ DEUX LECTURES, UNE SEULE VÉRITÉ. Elles partagent leurs requêtes et
    leurs conventions de sortie ; cette spec le VÉRIFIE au lieu de l'espérer —
    c'est ce qui empêche les deux routes de dériver l'une de l'autre."""
    client = auth_as(uid="coach-1")
    structure = _lire(client)
    arbre = client.get("/programs/p1/training", headers=_AUTH).json()

    def charpente(noeuds, cles):
        return [{k: n[k] for k in cles} for n in noeuds]

    assert charpente(structure["macros"], ("id", "macroNumber", "name")) \
        == charpente(arbre["macros"], ("id", "macroNumber", "name"))
    bs, ba = structure["macros"][0]["blocks"], arbre["macros"][0]["blocks"]
    assert charpente(bs, ("id", "blockNumber", "name", "startDate", "endDate")) \
        == charpente(ba, ("id", "blockNumber", "name", "startDate", "endDate"))
    assert bs[0]["objectives"] == ba[0]["objectives"]
    cles_semaine = ("id", "weekNumber", "name", "hidden", "startDate", "endDate", "athlete")
    assert charpente(bs[0]["weeks"], cles_semaine) == charpente(ba[0]["weeks"], cles_semaine)
    # …et le compte correspond bien aux séances que l'autre route détaille.
    assert [w["sessionCount"] for w in bs[0]["weeks"]] \
        == [len(w["sessions"]) for w in ba[0]["weeks"]]


def test_un_programme_ETRANGER_est_refuse(monde, auth_as):
    """Même autorisation que `/training` : c'est la même donnée, en moins
    détaillée. Une lecture allégée n'est pas une lecture publique."""
    pg = monde
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('autre','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('autre')"))
    r = auth_as(uid="autre").get("/programs/p1/structure", headers=_AUTH)
    assert r.status_code == 403
    assert r.json()["code"] == "programme_hors_perimetre"


def test_un_bloc_SANS_semaine_ni_objectif_rend_des_listes_vides(monde, auth_as):
    """Jamais de clé absente, même vide : le front lit `weeks` et `objectives`
    sans les tester — c'est la convention de `read_tree`, et la charpente doit
    la tenir aussi. Un bloc neuf naît justement sans semaine (22/08)."""
    macro = monde.execute(text(
        "SELECT id FROM training_macros WHERE program_id = 'p1'")).scalar()
    monde.execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number, name) "
        f"VALUES ('{macro}','b2',2,'Bloc neuf')"))

    neuf = next(b for b in _lire(auth_as(uid="coach-1"))["macros"][0]["blocks"]
                if b["name"] == "Bloc neuf")
    assert neuf["weeks"] == [] and neuf["objectives"] == []


def test_hasBase_dit_quels_blocs_portent_une_TRAME(monde, auth_as):
    """⚠️ LA RÈGLE EST ICI, PLUS DANS LE FRONT (FRE-119). Le menu « dupliquer une
    base » doit savoir lesquels en portent une ; il le déduisait en TypeScript,
    sur un arbre qu'il fallait donc charger ENTIER — 512 Ko pour une liste de
    libellés.

    QUATRE MORCEAUX FONT UNE TRAME, et pas seulement les lignes : une grille de
    jours ou une sélection de mouvements suffisent. C'est une trame commencée, et
    elle vaut d'être dupliquée — c'est le cas de 48 BASE réelles sur 111, qui
    n'ont aucune sélection stockée."""
    macro = monde.execute(text(
        "SELECT id FROM training_macros WHERE program_id = 'p1'")).scalar()

    def poser(legacy, numero, colonnes="", valeurs=""):
        return monde.execute(text(
            f"INSERT INTO training_blocks (macro_id, legacy_id, number{colonnes}) "
            f"VALUES ('{macro}','{legacy}',{numero}{valeurs}) RETURNING id")).scalar()

    nu = poser("bn", 5)
    grille = poser("bg", 6, ", day_split",
                   """, CAST('[{"day": "Lundi", "tiers": {}}]' AS jsonb)""")
    selection = poser("bs", 7, ", selected_principals", ", ARRAY['SQUAT']")
    lignes = poser("bl", 8)
    monde.execute(text(
        "INSERT INTO training_base_accessories (block_id, position, name, day) "
        f"VALUES ('{lignes}',1,'CURL','Lundi')"))
    # Une grille VIDE n'est pas une trame : `[]` est un geste, mais il ne porte
    # rien à dupliquer. `null` et `[]` ne se confondent pas ici non plus.
    grille_vide = poser("bv", 9, ", day_split", ", CAST('[]' AS jsonb)")

    par_id = {b["id"]: b["hasBase"]
              for b in _lire(auth_as(uid="coach-1"))["macros"][0]["blocks"]}
    assert par_id[str(nu)] is False
    assert par_id[str(grille_vide)] is False
    assert par_id[str(grille)] is True
    assert par_id[str(selection)] is True
    assert par_id[str(lignes)] is True
