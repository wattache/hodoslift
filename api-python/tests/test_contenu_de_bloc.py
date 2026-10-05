"""`GET /programs/{p}/blocks/{b}/content` — le contenu d'un bloc (FRE-119).

⚠️ CETTE LECTURE SE DÉGRADE DANS TROIS DIRECTIONS, ET UNE SEULE FAIT DU BRUIT :

  * elle en dit TROP — le contenu d'un AUTRE bloc repasse dans la réponse, et
    les 512 Ko reviennent sans que rien ne casse. C'est le mode d'échec
    silencieux, celui qui annule le ticket en douce ;
  * elle REDIT ce que la charpente porte déjà — numéro, dates, athlète. Rien ne
    casse non plus : l'écran a simplement deux sources pour la même valeur, et
    elles se contredisent le jour où l'une est fraîche et l'autre en cache ;
  * elle en dit TROP PEU — une ligne manque, et l'écran se vide. Celui-là se
    voit tout de suite.

D'où trois familles d'assertions, et non une. La deuxième est la plus facile à
oublier, parce qu'elle protège d'un défaut qui n'a aucun symptôme immédiat.
"""

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.usefixtures("pg")

_AUTH = {"Authorization": "Bearer x"}


@pytest.fixture
def monde(pg):
    """Un programme à DEUX blocs, tous deux garnis — sans quoi « le contenu de
    l'autre bloc n'est pas là » ne prouverait rien."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','c@x.fr'), ('ath-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, user_uid, first_name, last_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','a1','coach-1','ath-1','Léa','Martin')"))
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                    "VALUES ('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    macro = pg.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number) "
        "VALUES ('p1','m1',1) RETURNING id")).scalar()

    def bloc(legacy, numero, jour):
        b = pg.execute(text(
            "INSERT INTO training_blocks (macro_id, legacy_id, number, name, day_split, "
            "s1_start_date) VALUES "
            f"('{macro}','{legacy}',{numero},'Bloc {numero}', "
            f"""CAST('[{{"day": "{jour}", "tiers": {{"1": 1}}}}]' AS jsonb), DATE '2026-05-01') """
            "RETURNING id")).scalar()
        pg.execute(text(
            "INSERT INTO training_base_principles (block_id, position, name, tier, sets, reps) "
            f"VALUES ('{b}',1,'SQUAT {numero}',1,'5','3')"))
        pg.execute(text(
            "INSERT INTO training_base_accessories (block_id, position, name, day, sets, reps) "
            f"VALUES ('{b}',1,'CURL {numero}','{jour}','3','12')"))
        return b

    b1 = bloc("b1", 1, "J1")
    b2 = bloc("b2", 2, "J2")

    def semaine(bloc_id, legacy, numero, debut):
        return pg.execute(text(
            "INSERT INTO training_weeks (block_id, legacy_id, number, name, start_date, end_date, "
            "athlete_weight_kg) "
            f"VALUES ('{bloc_id}','{legacy}',{numero},'Semaine {numero}', DATE '{debut}', "
            f"DATE '{debut}', 62) RETURNING id")).scalar()

    s1 = semaine(b1, "w1", 1, "2026-05-01")
    semaine(b1, "w2", 2, "2026-05-08")          # SEMAINE VIDE, exprès
    s3 = semaine(b2, "w3", 1, "2026-06-01")

    def seance(week, legacy, nom, mouvement):
        sid = pg.execute(text(
            "INSERT INTO training_sessions (week_id, legacy_id, position, name, form_of_the_day) "
            f"VALUES ('{week}','{legacy}',1,'{nom}', 4) RETURNING id")).scalar()
        pg.execute(text(
            "INSERT INTO training_exercises (session_id, position, name, sets, reps, tempo, "
            "reps_unit, kind) "
            f"VALUES ('{sid}',1,'{mouvement}','4','5','2010','count','rehab')"))
        return sid

    seance(s1, "sa", "Lundi", "SQUAT")
    seance(s3, "sb", "Mardi", "MUSCLE UP")
    return {"pg": pg, "b1": str(b1), "b2": str(b2), "s1": str(s1), "vide": None}


def _lire(client, bloc, programme="p1"):
    r = client.get(f"/programs/{programme}/blocks/{bloc}/content", headers=_AUTH)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def test_le_contenu_porte_les_SEANCES_et_la_TRAME_du_bloc(monde, auth_as):
    contenu = _lire(auth_as(uid="coach-1"), monde["b1"])

    assert [p["name"] for p in contenu["base"]["principles"]] == ["SQUAT 1"]
    assert [a["name"] for a in contenu["base"]["accessories"]] == ["CURL 1"]
    # ⚠️ `label` SORT MÊME QUAND IL EST NUL (FRE-187). Le front lit une ABSENCE de
    # libellé, pas une clé manquante : c'est la règle du projet sur `''` contre
    # `None`, tenue ici comme elle l'est pour `groupKind`. Le jour garde alors
    # son `J<n>` à l'affichage comme à la génération.
    assert contenu["base"]["daySplit"] == [{"day": "J1", "label": None, "tiers": {"1": 1}}]
    assert contenu["base"]["s1StartDate"] == "2026-05-01"

    seances = contenu["weeks"][0]["sessions"]
    assert [s["name"] for s in seances] == ["Lundi"]
    assert [e["name"] for e in seances[0]["exercises"]] == ["SQUAT"]
    # La ligne sort ENTIÈRE, dérivée comprise : c'est la même projection que
    # l'arbre, et `mechano` est ce qui le prouve le mieux — il ne vient d'aucune
    # colonne, il est recalculé à la lecture.
    assert seances[0]["exercises"][0]["mechano"] == 15
    assert seances[0]["formOfTheDay"] == 4


def test_le_contenu_de_L_AUTRE_bloc_n_y_est_PAS(monde, auth_as):
    """⚠️ LA SPEC QUI PROTÈGE LE TICKET. Un bloc de trop dans la réponse et
    l'écran retélécharge l'arbre entier, sans que rien ne casse ni ne s'affiche
    de travers — personne ne le verrait avant la prochaine mesure."""
    contenu = _lire(auth_as(uid="coach-1"), monde["b1"])

    mouvements = [e["name"] for w in contenu["weeks"]
                  for s in w["sessions"] for e in s["exercises"]]
    assert mouvements == ["SQUAT"], "une séance du bloc 2 est passée"
    assert [p["name"] for p in contenu["base"]["principles"]] == ["SQUAT 1"]
    assert len(contenu["weeks"]) == 2, "seules les semaines de CE bloc"


def test_le_contenu_ne_REDIT_PAS_ce_que_la_charpente_porte(monde, auth_as):
    """⚠️ LA SPEC SANS SYMPTÔME. Numéro, dates, athlète, nom : la charpente les
    sert déjà. Les redire ici donnerait à l'écran DEUX sources pour la même
    valeur — et deux sources se contredisent dès que l'une est en cache. Le
    ticket ne demande pas seulement moins d'octets, il demande UNE source."""
    semaine = _lire(auth_as(uid="coach-1"), monde["b1"])["weeks"][0]

    assert set(semaine) == {"id", "sessions"}, "la semaine n'est ici qu'un identifiant"


def test_une_semaine_VIDE_garde_sa_place_avec_une_liste_vide(monde, auth_as):
    """Le front recolle les deux lectures PAR IDENTIFIANT. Une semaine sans
    séance qui disparaîtrait de la réponse ne serait pas « vide » pour lui, mais
    « pas encore chargée » — et l'écran attendrait un contenu qui n'arrive
    jamais."""
    semaines = _lire(auth_as(uid="coach-1"), monde["b1"])["weeks"]

    assert [len(w["sessions"]) for w in semaines] == [1, 0]


def test_charpente_et_contenu_REMONTENT_l_arbre_a_l_identique(monde, auth_as):
    """⚠️ DEUX LECTURES, UNE SEULE VÉRITÉ. C'est la spec qui interdit aux trois
    routes de dériver : ce que l'écran recompose doit être exactement ce que
    `/training` aurait rendu, séance par séance et ligne par ligne."""
    client = auth_as(uid="coach-1")
    arbre = client.get("/programs/p1/training", headers=_AUTH).json()
    structure = client.get("/programs/p1/structure", headers=_AUTH).json()

    for bloc_arbre, bloc_struct in zip(arbre["macros"][0]["blocks"],
                                       structure["macros"][0]["blocks"], strict=True):
        contenu = _lire(client, bloc_struct["id"])
        assert contenu["base"] == bloc_arbre["base"]
        # Recomposition : la charpente donne la semaine, le contenu ses séances.
        par_id = {w["id"]: w["sessions"] for w in contenu["weeks"]}
        recompose = [{**w, "sessions": par_id[w["id"]]} for w in bloc_struct["weeks"]]
        for semaine in recompose:
            semaine.pop("sessionCount")
        assert recompose == bloc_arbre["weeks"]


def test_le_bloc_D_UN_AUTRE_PROGRAMME_est_INTROUVABLE(monde, auth_as):
    """⚠️ 404 ET PAS 403, et ce n'est pas un détail de vocabulaire. L'appelant a
    bien accès au programme de l'URL : c'est le BLOC qui n'est pas à lui. Sans
    cette vérification, l'autorisation porterait sur un programme et la réponse
    viendrait d'un autre — tous les ids sont des uuid que les coachs voient."""
    pg = monde["pg"]
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('autre','x@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('autre')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name) VALUES "
        "('22222222-2222-2222-2222-222222222222','a2','autre','Zoé')"))
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                    "VALUES ('p2','autre','22222222-2222-2222-2222-222222222222')"))
    macro = pg.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number) "
        "VALUES ('p2','m2',1) RETURNING id")).scalar()
    etranger = pg.execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number) "
        f"VALUES ('{macro}','b9',1) RETURNING id")).scalar()

    r = auth_as(uid="coach-1").get(
        f"/programs/p1/blocks/{etranger}/content", headers=_AUTH)
    assert r.status_code == 404
    assert r.json()["code"] == "objet_arbre_introuvable"


def test_un_id_QUI_N_EST_PAS_UN_UUID_rend_404_et_pas_500(monde, auth_as):
    """Une PWA restée sur un ancien bundle garde des ids Firestore en mémoire.
    Le `CAST(... AS uuid)` lèverait, et elle recevrait des 500 en rafale là où
    un 404 lui dit la vérité."""
    r = auth_as(uid="coach-1").get(
        "/programs/p1/blocks/AbCdEfGhIjKl123/content", headers=_AUTH)
    assert r.status_code == 404
    assert r.json()["code"] == "objet_arbre_introuvable"


def test_l_ATHLETE_lit_le_contenu_de_son_bloc(monde, auth_as):
    """C'est SON écran d'entraînement : la lecture par bloc doit lui être
    ouverte, sinon le découpage ne sert qu'au coach."""
    assert _lire(auth_as(uid="ath-1"), monde["b1"])["weeks"][0]["sessions"]


def test_un_ETRANGER_ne_lit_rien(monde, auth_as):
    """Même autorisation que `/training` : c'est la même donnée, découpée."""
    monde["pg"].execute(text("INSERT INTO users (uid, email) VALUES ('tiers','t@x.fr')"))
    monde["pg"].execute(text("INSERT INTO coaches (uid) VALUES ('tiers')"))
    r = auth_as(uid="tiers").get(
        f"/programs/p1/blocks/{monde['b1']}/content", headers=_AUTH)
    assert r.status_code == 403
    assert r.json()["code"] == "programme_hors_perimetre"


def test_un_bloc_NEUF_rend_une_trame_vide_et_aucune_semaine(monde, auth_as):
    """Un bloc naît sans semaine depuis le 22/08. Jamais de clé absente, même
    vide : le front lit `weeks` et `base` sans les tester."""
    macro = monde["pg"].execute(text(
        "SELECT id FROM training_macros WHERE program_id = 'p1'")).scalar()
    neuf = monde["pg"].execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number, name) "
        f"VALUES ('{macro}','b3',3,'Bloc neuf') RETURNING id")).scalar()

    contenu = _lire(auth_as(uid="coach-1"), str(neuf))
    assert contenu["weeks"] == []
    assert contenu["base"]["principles"] == [] and contenu["base"]["accessories"] == []
    # ⚠️ `None`, PAS `[]` : le coach n'a jamais configuré sa sélection, et le
    # front doit retomber sur l'ordre canonique de la bibliothèque. Les aplatir
    # a vidé l'éditeur de BASE de ses cinq sections le 17/08.
    assert contenu["base"]["selectedPrincipaux"] is None


def test_la_seance_COMPTE_le_travail_note_sans_ressenti(monde, auth_as):
    """FRE-160 : le seul trou de saisie qui rend service à signaler. Le serveur
    compte, avec la règle de `records.py` — pas le front, qui en ferait une
    seconde définition.

    Trois lignes : notée SANS ressenti (compte), RPE seul (l'usage nominal, ne
    compte pas), et rien du tout (une séance non faite n'est pas un oubli)."""
    pg = monde["pg"]
    sid = pg.execute(text(
        "SELECT s.id FROM training_sessions s WHERE s.week_id = CAST(:w AS uuid)"),
        {"w": monde["s1"]}).scalar()
    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, sets, reps, reps_done, weight_done) "
        "VALUES (:s, 2, 'PULL UP', '3', '8', '8', NULL), "
        "       (:s, 3, 'DIPS',    '3', '8', NULL, '40'), "
        "       (:s, 4, 'SQUAT',   '3', '8', NULL, NULL)"), {"s": sid})
    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, sets, reps, felt_rpe) "
        "VALUES (:s, 5, 'MUSCLE UP', '3', '8', '8')"), {"s": sid})
    # Par série aussi : une charge réelle notée série par série, sans ressenti.
    pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, sets, reps, weight_done_by_set) "
        "VALUES (:s, 6, 'DIPS', '2', '8', ARRAY['40','42'])"), {"s": sid})
    contenu = _lire(auth_as(uid="coach-1"), monde["b1"])
    [semaine] = [w for w in contenu["weeks"] if w["id"] == monde["s1"]]
    [seance] = semaine["sessions"]
    assert seance["lignesSansRessenti"] == 3
    # Et l'athlète le lit aussi : c'est lui qui peut compléter.
    contenu = _lire(auth_as(uid="ath-1"), monde["b1"])
    assert contenu["weeks"][0]["sessions"][0]["lignesSansRessenti"] == 3
