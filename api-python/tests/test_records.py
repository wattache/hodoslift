"""LE TABLEAU DES RECORDS — porté du front le 26/08 (FRE-71 §9).

⚠️ CE QUE CES SPECS GARDENT, ET CE N'EST PAS « ça rend le max ». Le calcul porte
cinq décisions produit qui ne se devinent pas, et que le front avait accumulées
au fil des signalements :

  1. un record est ce qui a été FAIT — la trace, sinon une semaine programmée
     d'avance produit un PR (c'est le défaut d'origine, signalé le 18/08) ;
  2. le RÉALISÉ prime sur le prescrit, SUR LES DEUX AXES — un 6 prescrit réalisé
     en 8 est un record à 8, pas à 6 ;
  3. un FAIL n'annule que ce qu'il SUIT — un 4×4 noté `9 · 9,5 · 10 · FAIL`
     vaut trois séries de 4 (FRE-110) ; sans détail par série on ne sait pas
     où l'échec s'est produit, donc la ligne sort ;
  4. toutes les variantes comptent (décision coach du 02/08) — l'ancienne liste
     blanche écartait 35 % des séries chargées ;
  5. les reps sont bornées à 1–10, et l'emplacement se compose avec des replis.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app
from app.entrainement.records import lire_records

_AUTH = {"Authorization": "Bearer x"}


@pytest.fixture
def monde(pg):
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','c@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','a1','coach-1','A')"))
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
        "('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    macro = pg.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number, name) "
        "VALUES ('p1','m1',1,'ROAD TO 100') RETURNING id")).scalar()
    bloc = pg.execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number, name) "
        "VALUES (:m,'b1',2,'') RETURNING id"), {"m": macro}).scalar()
    return {"pg": pg, "bloc": str(bloc)}


def _semaine(monde, numero=3, debut="2026-01-05", nom=""):
    return monde["pg"].execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number, name, hidden, start_date) "
        "VALUES (CAST(:b AS uuid), :l, :n, :nom, false, CAST(:d AS date)) RETURNING id"),
        {"b": monde["bloc"], "l": f"w{numero}", "n": numero, "nom": nom, "d": debut}).scalar()


def _ligne(monde, semaine, **c):
    seance = monde["pg"].execute(text(
        "INSERT INTO training_sessions (week_id, legacy_id, position, name, session_date) "
        "VALUES (:w, gen_random_uuid()::text, 0, 'Lundi', CAST(:d AS date)) RETURNING id"),
        {"w": semaine, "d": c.get("date", "2026-01-05")}).scalar()
    monde["pg"].execute(text(
        "INSERT INTO training_exercises (session_id, position, name, sets, reps, weight, "
        "reps_done, weight_done, felt_rpe, felt_rpe_by_set, aimed_rpe, variant, format, "
        "reps_done_by_set, weight_done_by_set) "
        "VALUES (:s, 0, :nom, :sets, :reps, :poids, :rd, :pd, :rpe, :rps, :cible, :var, :fmt, "
        "        :rds, :pds)"),
        {"s": seance, "nom": c.get("name", "SQUAT"), "sets": c.get("sets", "3"),
         "reps": c.get("reps", "3"), "poids": c.get("weight", "100"),
         "rd": c.get("reps_done"), "pd": c.get("weight_done"),
         "rpe": c.get("felt_rpe", "8"), "rps": c.get("felt_rpe_by_set"),
         "cible": c.get("aimed_rpe", "8"), "var": c.get("variant", []),
         # ⚠️ `None` ET NON `''` : depuis FRE-137, la base REFUSE la chaîne vide
         # sur `format`. Ce décor la posait par défaut sur chaque ligne — 29
         # specs sont tombées d'un coup au lot TIÈDE, sans qu'aucune règle de
         # records ne soit en cause. Une absence s'écrit comme une absence.
         "fmt": c.get("format") or None,
         "rds": c.get("reps_done_by_set"), "pds": c.get("weight_done_by_set")})


def _records(monde):
    return {(r["movement"], r["reps"]): r for r in lire_records(monde["pg"], "p1")}


# --------------------------------------------------------------------------- #
# LA RÈGLE CENTRALE — un record est ce qui a été FAIT
# --------------------------------------------------------------------------- #

def test_une_ligne_SANS_RPE_ne_fait_pas_un_record(monde):
    """⚠️ LE DÉFAUT D'ORIGINE, signalé par William le 18/08 : le tableau affichait
    des records jamais soulevés. Une ligne « SQUAT 3×3 @ 140 » posée par le coach
    pour dans trois semaines produisait un PR à 140 kg immédiatement.

    Le code disait pourtant déjà la bonne règle, trois lignes plus haut : « un
    record est ce qui a été soulevé, pas ce qui était prévu »."""
    s = _semaine(monde)
    _ligne(monde, s, weight="140", felt_rpe=None, aimed_rpe=None)
    assert _records(monde) == {}


def test_un_RPE_PAR_SERIE_suffit(monde):
    s = _semaine(monde)
    _ligne(monde, s, weight="140", felt_rpe=None, felt_rpe_by_set=["7"])
    assert _records(monde)[("SQUAT", 3)]["weight"] == 140


def test_une_ligne_datée_DEMAIN_ne_compte_pas(monde):
    """La copie d'une semaine reporte les valeurs prescrites : sans garde-fou de
    date, une semaine future portant un RPE recopié ferait un record."""
    s = _semaine(monde, debut="2099-01-04")
    _ligne(monde, s, weight="200", date="2099-01-05")
    assert _records(monde) == {}


# --------------------------------------------------------------------------- #
# LE RÉALISÉ PRIME — sur les DEUX axes
# --------------------------------------------------------------------------- #

def test_la_charge_RÉALISÉE_prime_sur_la_prescrite(monde):
    s = _semaine(monde)
    _ligne(monde, s, weight="100", weight_done="105")
    assert _records(monde)[("SQUAT", 3)]["weight"] == 105


def test_les_REPS_réalisées_prime_aussi(monde):
    """⚠️ LES DEUX COORDONNÉES SUIVENT LA MÊME RÈGLE. Un 6 prescrit réalisé en 8
    est un record À 8 — sinon la cellule mélange le fait et la consigne."""
    s = _semaine(monde)
    _ligne(monde, s, reps="6", reps_done="8", weight="90")
    r = _records(monde)
    assert (("SQUAT", 8) in r) and (("SQUAT", 6) not in r)


def test_une_charge_écrite_à_la_VIRGULE_est_lue(monde):
    """Les coachs écrivent « 47,5 » aussi souvent que « 47.5 ». C'est `ff_charge`
    qui tranche — la MÊME fonction que la projection analytique, pas une seconde
    façon de lire un nombre."""
    s = _semaine(monde)
    _ligne(monde, s, weight="47,5")
    assert _records(monde)[("SQUAT", 3)]["weight"] == 47.5


def test_une_charge_au_POIDS_DE_CORPS_ne_fait_pas_un_record(monde):
    """« PDC » est une charge légitime, mais pas un nombre : la ligne existe, elle
    n'a simplement pas de charge à comparer."""
    s = _semaine(monde)
    _ligne(monde, s, weight="PDC")
    assert _records(monde) == {}


# --------------------------------------------------------------------------- #
# LES ÉCHECS ET LES BORNES
# --------------------------------------------------------------------------- #

def test_un_FAIL_déclaré_SANS_DÉTAIL_n_est_pas_un_record(monde):
    """⚠️ SANS DÉTAIL PAR SÉRIE, ON NE SAIT RIEN. Un FAIL global peut vouloir dire
    « rien n'est passé » comme « échoué à la dernière » — 45 lignes de production
    sont dans ce cas, et rien ne permet de trancher. Elles restent écartées."""
    s = _semaine(monde)
    _ligne(monde, s, weight="150", felt_rpe="FAIL")
    assert _records(monde) == {}


def test_un_ÉCHEC_EN_FIN_DE_SÉRIE_garde_LES_SÉRIES_TENUES(monde):
    """⚠️ NEUF CELLULES DE PRODUCTION ÉTAIENT FAUSSES PAR DÉFAUT (FRE-110).

    Jusqu'au 01/09, un `FAIL` global effaçait la ligne entière. Or le détail par
    série dit CE QUI A ÉTÉ TENU : sur un 4×4 noté `9 · 9,5 · 10 · FAIL`,
    l'athlète a tenu trois séries de 4 à cette charge — c'est un record, et il
    n'apparaissait pas. Kevin affichait 80 kg aux dips en 4 reps alors qu'il a
    tenu une série à 90 ; Nicolas 2,5 kg au muscle-up quand il en a fait trois
    à 7,5.

    Ce ne sont pas des lignes quelconques : on échoue sur un maximum, pas sur de
    l'échauffement. Ce sont donc par construction les tentatives les plus lourdes.

    ⚠️ LA CHARGE ET LES REPS NE BOUGENT PAS — seul le nombre de séries. Ce sont
    les deux clés du record ; le compte de séries n'entre que dans le libellé de
    la cellule (« 3x4 @ 9 »)."""
    s = _semaine(monde)
    _ligne(monde, s, name="DIPS", sets="4", reps="4", weight="90",
           felt_rpe="FAIL", felt_rpe_by_set=["9", "9.5", "10", "FAIL"])

    record = _records(monde)[("DIPS", 4)]
    assert record["weight"] == 90
    assert record["sets"] == "3", "trois séries tenues avant l'échec, pas quatre"


def test_QUE_DES_ÉCHECS_ne_garde_rien(monde):
    """Rien n'a été tenu à cette charge : la ligne sort, comme avant.

    ⚠️ C'EST LE CAS MAJORITAIRE, et c'est ce qui borne l'intérêt du ticket : sur
    les 100 lignes de production qui portent un détail par série avec un échec,
    65 n'ont aucune série notée hors échec. La règle n'en réécrit que 35."""
    s = _semaine(monde)
    _ligne(monde, s, weight="150", felt_rpe="FAIL", felt_rpe_by_set=["FAIL", "FAIL"])
    assert _records(monde) == {}


def test_les_séries_tenues_APRÈS_un_échec_comptent_aussi(monde):
    """⚠️ ON NE S'ARRÊTE PAS AU PREMIER ÉCHEC, ET C'EST LA PRODUCTION QUI L'A DIT.

    La première écriture de cette règle comptait « tout ce qui précède le premier
    FAIL ». Elle supposait qu'un athlète range ses affaires après un échec — or
    NEUF lignes sur 100 portent des valeurs APRÈS un FAIL. Il baisse la charge,
    souffle, et repart.

    Le cas ci-dessous est le plus dur pour l'ancienne formule : l'échec est en
    PREMIER, et deux séries suivent. Elle rendait zéro, donc la ligne entière
    disparaissait alors que deux séries ont bien été tenues."""
    s = _semaine(monde)
    _ligne(monde, s, name="SQUAT", sets="3", reps="3", weight="120",
           felt_rpe="FAIL", felt_rpe_by_set=["FAIL", "8", "9.5"])

    record = _records(monde)[("SQUAT", 3)]
    assert record["weight"] == 120
    assert record["sets"] == "2", "deux séries notées hors échec"


def test_les_séries_NON_NOTÉES_ne_se_déduisent_PAS_du_prescrit(monde):
    """⚠️ LA FORMULE QUI VIENT ENSUITE, ET QU'IL FAUT REFUSER : `sets` moins le
    nombre de FAIL. Sur `sets = 3` noté `['FAIL']` — DIX lignes réelles — elle
    affirmerait deux séries tenues dont rien ne porte la trace. Elle invente.

    On ne compte que ce qui est NOTÉ, quitte à sous-estimer quand l'athlète n'a
    rempli qu'une case. Sous-estimer est le bon sens de l'erreur : un record se
    prouve, il ne se présume pas."""
    s = _semaine(monde)
    _ligne(monde, s, sets="3", weight="150", felt_rpe="FAIL", felt_rpe_by_set=["FAIL"])
    assert _records(monde) == {}, "aucune série notée hors échec : rien de prouvé"


def test_le_DÉTAIL_par_série_l_emporte_sur_le_ressenti_GLOBAL(monde):
    """⚠️ Y COMPRIS QUAND IL EST PLUS SÉVÈRE, et ce n'est pas un cas d'école : une
    ligne notée `10` en global mais `['FAIL']` en détail passait le filtre — il ne
    regardait que le global — et TENAIT un record. C'était le cas d'Ulysse, 17,5 kg
    au muscle-up en 4 reps sur une unique série échouée ; sa cellule redescend à
    la vraie valeur.

    Le détail est la source la plus précise : il dit série par série ce qui s'est
    passé. Le global, lui, est parfois une moyenne, parfois une saisie à part."""
    s = _semaine(monde)
    _ligne(monde, s, name="MUSCLE UP", sets="1", reps="4", weight="17.5",
           felt_rpe="10", felt_rpe_by_set=["FAIL"])
    _ligne(monde, s, name="MUSCLE UP", sets="1", reps="4", weight="15",
           felt_rpe="9", felt_rpe_by_set=["9"])

    assert _records(monde)[("MUSCLE UP", 4)]["weight"] == 15


@pytest.mark.parametrize("reps", ["0", "11", "15"])
def test_les_reps_hors_de_1_à_10_sont_écartées(monde, reps):
    """Le tableau a dix colonnes. Au-delà, ce n'est plus de la force — et un
    « 3×15 » d'accessoire n'a rien à y faire."""
    s = _semaine(monde)
    _ligne(monde, s, reps=reps, weight="60")
    assert _records(monde) == {}


def test_un_mouvement_HORS_des_cinq_n_a_pas_de_colonne(monde):
    s = _semaine(monde)
    _ligne(monde, s, name="CURL BICEPS", weight="30")
    assert _records(monde) == {}


# --------------------------------------------------------------------------- #
# CE QUE LA CELLULE AFFICHE
# --------------------------------------------------------------------------- #

def test_le_record_garde_TOUTES_les_variantes(monde):
    """⚠️ DÉCISION COACH DU 02/08 : toutes les variantes comptent. La liste
    blanche d'avant (vide / COMP / DS) écartait 35 % des séries chargées et
    vidait des colonnes entières — les 21 dips d'une athlète, toutes en RAW,
    qui n'est pas une variation mais la condition de compétition par défaut.

    Le contexte n'est pas perdu : la cellule affiche le libellé."""
    s = _semaine(monde)
    _ligne(monde, s, weight="120", variant=["DS", "PAUSE"])
    assert _records(monde)[("SQUAT", 3)]["variant"] == "DS + PAUSE"


def test_l_emplacement_se_REPLIE_sur_les_numéros(monde):
    """⚠️ `''` ET NON NULL : brokkr rend la chaîne vide pour un niveau sans nom.
    Le front utilisait `??`, dont le repli ne se déclenche jamais sur `''` — et
    l'emplacement s'affichait « ROAD TO 100 ·  ·  »."""
    s = _semaine(monde, numero=3, nom="")
    _ligne(monde, s, weight="120")
    assert _records(monde)[("SQUAT", 3)]["location"] == "ROAD TO 100 · Bloc 2 · S3"


def test_le_record_est_la_MEILLEURE_charge_de_sa_case(monde):
    s = _semaine(monde)
    _ligne(monde, s, weight="100")
    _ligne(monde, s, weight="130")
    _ligne(monde, s, weight="115")
    assert _records(monde)[("SQUAT", 3)]["weight"] == 130


# --------------------------------------------------------------------------- #
# LA ROUTE
# --------------------------------------------------------------------------- #

def test_la_route_rend_les_records_de_l_athlète(monde):
    s = _semaine(monde)
    _ligne(monde, s, weight="140", reps="5")

    app.dependency_overrides[verify_token] = lambda: {"uid": "coach-1"}
    r = TestClient(app).get("/athletes/a1/records", headers=_AUTH)
    assert r.status_code == 200, r.text[:300]
    assert [(x["movement"], x["reps"], x["weight"]) for x in r.json()] == [("SQUAT", 5, 140)]
    app.dependency_overrides.clear()


def test_un_QUIDAM_n_atteint_pas_les_records(monde):
    monde["pg"].execute(text("INSERT INTO users (uid, email) VALUES ('intrus','i@x.fr')"))
    app.dependency_overrides[verify_token] = lambda: {"uid": "intrus"}
    assert TestClient(app).get("/athletes/a1/records", headers=_AUTH).status_code == 403
    app.dependency_overrides.clear()


# --------------------------------------------------------------------------- #
# UN RECORD EST UNE PROPRIÉTÉ DE SÉRIE, PAS DE LIGNE (FRE-136)
# --------------------------------------------------------------------------- #


def test_le_record_vient_de_la_MEILLEURE_SERIE_pas_de_la_moyenne(monde):
    """⚠️ LE DÉFAUT EXACT, ET IL EST DÉJÀ DANS LA DONNÉE. Depuis la saisie par
    série, `reps_done` est la MOYENNE des séries calculée par le navigateur. Dix
    puis dix répétitions donnent `reps_done = '9'` — un record à 9 que personne
    n'a fait. Deux lignes de production le portent déjà : `['8','7','7']` rendu
    `7.3`, et `['41','42']` rendu `41.5`.

    La bonne lecture est la SÉRIE : huit puis dix répétitions ont eu lieu, donc
    deux records, à 8 et à 10. Jamais à 9.

    (Le domaine des records s'arrête à dix répétitions — `reps BETWEEN 1 AND 10`
    plus bas dans la requête —, d'où ce choix de valeurs.)"""
    _ligne(monde, _semaine(monde), name="SQUAT", sets="2", reps="8", weight="40",
           reps_done="9", reps_done_by_set=["8", "10"],
           felt_rpe="8", felt_rpe_by_set=["8", "9"])

    records = _records(monde)
    assert ("SQUAT", 10) in records, "la série de 10 fait record"
    assert ("SQUAT", 8) in records, "celle de 8 aussi, à sa ligne"
    assert ("SQUAT", 9) not in records, "9 est une moyenne, personne ne l'a fait"


def test_chaque_serie_porte_SA_charge(monde):
    """Une série montée en charge est un record à SA charge, pas à la moyenne de
    la ligne — sinon la série lourde disparaît sous la légère."""
    _ligne(monde, _semaine(monde), name="SQUAT", sets="2", reps="5", weight="100",
           reps_done_by_set=["5", "5"], weight_done_by_set=["100", "120"],
           weight_done="110", felt_rpe="8", felt_rpe_by_set=["8", "9"])

    assert float(_records(monde)[("SQUAT", 5)]["weight"]) == 120


def test_une_serie_ECHOUEE_ne_concourt_pas(monde):
    """⚠️ POSITION PAR POSITION, la même lecture que les séries tenues (FRE-110).
    La série lourde a été tentée et manquée : elle ne fait pas record, et les
    séries tenues avant elle en font un."""
    _ligne(monde, _semaine(monde), name="SQUAT", sets="3", reps="5", weight="100",
           reps_done_by_set=["5", "5", "5"], weight_done_by_set=["100", "100", "150"],
           felt_rpe="8", felt_rpe_by_set=["8", "9", "FAIL"])

    assert float(_records(monde)[("SQUAT", 5)]["weight"]) == 100, \
        "150 kg a été tenté, pas tenu"


def test_une_ligne_SANS_detail_par_serie_ne_bouge_pas(monde):
    """⚠️ LA GARANTIE DE NON-RÉGRESSION, et c'est la spec la plus importante des
    quatre. La branche « sans détail » est l'expression d'avant, mot pour mot :
    une ligne classique doit donner exactement le record d'hier.

    Vérifié aussi sur la production avant d'écrire — les 929 records des 70
    programmes, zéro écart."""
    _ligne(monde, _semaine(monde), name="SQUAT", sets="3", reps="5", weight="100",
           reps_done="6", weight_done="110", felt_rpe="8")

    r = _records(monde)[("SQUAT", 6)]
    assert float(r["weight"]) == 110 and r["sets"] == "3"


def test_deux_series_INEGALES_font_DEUX_records(monde):
    """La question de William, le 07/09 : « 2×8 @ 10 kg de prévu. Si 1×8 @ 12 de
    fait et 1×7 @ 5, le tableau prendra bien les deux ? »

    Oui — et c'est tout l'intérêt de lire la SÉRIE. Chaque série tenue concourt à
    SON nombre de répétitions, avec SA charge : la lourde fait record à 8, la
    légère à 7. La moyenne de la ligne (7,5 rép. @ 8,5 kg) n'aurait produit ni
    l'une ni l'autre — elle aurait inventé une performance qui n'a pas eu lieu,
    et perdu les deux qui ont eu lieu."""
    _ligne(monde, _semaine(monde), name="SQUAT", sets="2", reps="8", weight="10",
           reps_done_by_set=["8", "7"], weight_done_by_set=["12", "5"],
           felt_rpe="8", felt_rpe_by_set=["8", "9"])

    records = _records(monde)
    assert float(records[("SQUAT", 8)]["weight"]) == 12, "la série lourde, à 8 rép."
    assert float(records[("SQUAT", 7)]["weight"]) == 5, "la légère, à 7 rép."
    assert ("SQUAT", 7.5) not in records, "la moyenne n'est une performance de personne"


# --------------------------------------------------------------------------- #
# QUI REMPLIT PAR SÉRIE N'EST PLUS LU EN GLOBAL (FRE-156)
#
# Règle de William, 09/09 : « soit l'athlète remplit au global et on prend ces
# infos, soit il commence à remplir par série et seules les séries remplies
# comptent ».
# --------------------------------------------------------------------------- #

def test_une_serie_SANS_repetitions_notees_ne_concourt_pas(monde):
    """⚠️ LA MOYENNE FABRIQUAIT UNE SÉRIE QUI N'A PAS EU LIEU. Le scalaire
    `reps_done` est, dès qu'un tableau par série existe, la MOYENNE que le
    serveur en dérive. Le lire à une position vide mariait les répétitions des
    autres séries à la charge de celle-ci.

    Le cas est réel : une ligne de production porte des répétitions sur deux
    séries et des charges sur trois. La troisième ne doit rien produire — on ne
    sait pas combien de répétitions elle a portées."""
    s = _semaine(monde)
    _ligne(monde, s, sets="3", reps="10", weight="80",
           reps_done="8", reps_done_by_set=["8", "8"],
           weight_done="85", weight_done_by_set=["80", "87.5", "95"],
           felt_rpe_by_set=["7", "7", "7"])

    records = _records(monde)
    # Les deux séries NOTÉES concourent, avec leurs propres charges.
    assert records[("SQUAT", 8)]["weight"] == 87.5, (
        "la meilleure charge des séries notées est celle de la deuxième")
    # ⚠️ ET 95 N'APPARAÎT NULLE PART : c'est la charge de la série dont les
    # répétitions sont inconnues. Avant, elle sortait à 8 répétitions, empruntées
    # aux deux premières séries.
    assert all(r["weight"] != 95 for r in records.values()), records


def test_des_CHARGES_par_serie_sans_repetitions_par_serie_gardent_le_global(monde):
    """⚠️ LE PENDANT, ET IL PORTE 24 LIGNES DE PRODUCTION. L'athlète fait varier
    la charge et note ses répétitions UNE fois : `reps_done` est alors ce qu'il a
    TAPÉ, pas une moyenne — aucun tableau n'existe pour en dériver une. Le
    supprimer remplacerait un fait par la consigne du coach.

    Les trois tableaux sont indépendants : la règle se lit champ par champ."""
    s = _semaine(monde)
    _ligne(monde, s, sets="3", reps="10", weight="80",
           reps_done="8", weight_done_by_set=["80", "90", "100"],
           felt_rpe_by_set=["7", "8", "9"])

    records = _records(monde)
    assert records[("SQUAT", 8)]["weight"] == 100, (
        "les trois séries comptent, avec les 8 répétitions notées en global")


def test_une_serie_SANS_charge_notee_ne_concourt_pas_non_plus(monde):
    """La même règle sur l'autre champ : un tableau de charges qui existe et
    laisse une case vide ne se complète pas par la moyenne."""
    s = _semaine(monde)
    # ⚠️ LA CHARGE DU TROU EST PLUS LOURDE QUE CELLE NOTÉE, à dessein : sinon le
    # mauvais candidat perdrait de toute façon, et la spec passerait au vert avec
    # ou sans le correctif — elle ne prouverait rien.
    _ligne(monde, s, sets="2", reps="5", weight="60",
           weight_done="120", weight_done_by_set=["80", ""],
           reps_done="5", felt_rpe_by_set=["8", "8"])

    records = _records(monde)
    assert records[("SQUAT", 5)]["weight"] == 80, (
        "seule la série notée compte : 120 est la moyenne, pas une charge tenue")
