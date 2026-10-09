"""Suivi de progression (`GET /athletes/{id}/tracking`).

⚠️ PORTÉ SUR LE VRAI POSTGRES (fixture `pg`) le 2026-08-20, et c'est ce qui change
tout pour ce fichier. Il tournait sur un stub SQLite, où l'agrégat hebdomadaire est
INEXÉCUTABLE : `date_trunc`, `FILTER (WHERE …)` et `count(DISTINCT (a, b))` sur un
row n'y existent pas. Les tests ne pouvaient donc exercer que le chemin « aucune
donnée », qui court-circuite AVANT l'agrégat — ils passaient tous sans jamais
produire une seule réponse peuplée.

Ce n'était pas qu'un manque de couverture. Le `response_model` de FRE-70 valide à
l'EXÉCUTION : un modèle faux aurait rendu 500 sur l'écran que les coachs ouvrent le
plus, sans qu'aucun test ne le voie. Il a fallu le vérifier contre la production
(`scripts/verifier_tracking_contrat.py`) faute de pouvoir le tester ici.

Le bac à sable Postgres existait pourtant déjà — `test_authz.py` et
`test_daily_logs.py` s'en servent. Le stub n'était plus une simplification, juste
une habitude.
"""

import pytest
from sqlalchemy import text

_A1 = "aaaaaaaa-1111-1111-1111-111111111111"
_A2 = "aaaaaaaa-2222-2222-2222-222222222222"


@pytest.fixture
def sql(pg):
    """L'athlète a1 (géré par coach-1, lié à uid-1) et a2, pour la frontière."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1','c1@x.fr'), ('coach-2','c2@x.fr'), "
                    "('uid-1','a1@x.fr'), ('uid-2','a2@x.fr'), ('intrus','i@x.fr')"))
    # ⚠️ LES COACHS D'ABORD : `athletes.coach_uid` est une VRAIE clé étrangère vers
    # `coaches`, contrainte que le stub SQLite n'avait pas. C'est le genre d'écart
    # qui laisse un test passer sur une base impossible.
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1'), ('coach-2')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name, user_uid) "
        "VALUES (CAST(:a1 AS uuid),'a1','coach-1','A','Un','uid-1'),"
        "       (CAST(:a2 AS uuid),'a2','coach-2','B','Deux','uid-2')"),
        {"a1": _A1, "a2": _A2})
    return pg


_AUTH = {"Authorization": "Bearer x"}


def _seed_exercise(conn, exercise: str, n: int = 1):
    """N lignes d'un mouvement, avec une TRACE de réalisation : depuis le 17/08 le
    sélecteur n'affiche que les mouvements réellement travaillés, et une ligne sans
    trace est du programme, pas de l'entraînement fait.

    ⚠️ LA TRACE EST LE RPE DEPUIS LE 26/08 — `reps_done` ne suffit plus. Ce
    helper sert une quinzaine de specs : y laisser l'ancienne trace les aurait
    toutes fait passer sur une donnée que la règle écarte désormais, c'est-à-dire
    pour de mauvaises raisons.

    Les colonnes NOT NULL de la vraie table (`program_id`, `session_index`,
    `exercise_index`) sont posées ici — le stub SQLite ne les exigeait pas, et
    c'est typiquement ce qu'un schéma de test recopié laisse filer."""
    for i in range(n):
        conn.execute(text(
            "INSERT INTO training_sets (athlete_id, program_id, session_index, "
            "exercise_index, exercise, reps_done, felt_rpe_raw) "
            "VALUES ('a1', 'p1', 0, :i, :ex, 5, '8')"), {"i": i, "ex": exercise})


# --------------------------------------------------------------------------- #
# Autorisation — volontairement LARGE : tout coach explore tout athlète
# (cf. en-tête du routeur ; à scoper quand les structures existeront).
# --------------------------------------------------------------------------- #


def _coach(conn, uid):
    """Idempotent : la fixture pose déjà les deux coachs (contrainte de clé
    étrangère). Les tests continuent d'appeler ce helper pour DIRE que le rôle
    compte dans leur scénario — c'est de la documentation exécutable."""
    conn.execute(text(
        "INSERT INTO coaches (uid) VALUES (:u) ON CONFLICT DO NOTHING"), {"u": uid})


def test_coach_gerant_autorise(auth_as, sql):
    _coach(sql, "coach-1")
    r = auth_as(uid="coach-1").get("/athletes/a1/tracking", headers=_AUTH)
    assert r.status_code == 200


def test_autre_coach_refuse_403(auth_as, sql):
    """Un coach qui ne gère PAS cet athlète n'y accède pas — 17/08.

    Ce test affirmait l'INVERSE : l'accès était ouvert à tout coach vérifié
    (« outil d'exploration », décision du 28/07). La surface qui s'en servait —
    le sélecteur d'athlète du graphe, ouvert à l'annuaire entier — a disparu en
    fusionnant dans le Tracker, qui suit la barre latérale. Plus rien ne
    consommait cette largeur, et elle jurait avec le reste de la page : les
    `daily_logs` du même écran étaient déjà en `owner_or_coach`.

    ⚠️ Être coach ne suffit donc plus : l'ancienne garde testait le RÔLE
    (`is_coach(uid)`), pas le LIEN. `coach-2` est bien un coach vérifié ici —
    c'est précisément ce qui rend ce test utile."""
    _coach(sql, "coach-2")
    r = auth_as(uid="coach-2").get("/athletes/a1/tracking", headers=_AUTH)
    assert r.status_code == 403


def test_athlete_voit_son_suivi(auth_as, sql):
    r = auth_as(uid="uid-1").get("/athletes/a1/tracking", headers=_AUTH)
    assert r.status_code == 200


def test_autre_athlete_refuse_403(auth_as, sql):
    """L'ouverture vaut pour les COACHS, pas entre athlètes."""
    r = auth_as(uid="uid-2").get("/athletes/a1/tracking", headers=_AUTH)
    assert r.status_code == 403


def test_quidam_refuse_403(auth_as, sql):
    r = auth_as(uid="intrus").get("/athletes/a1/tracking", headers=_AUTH)
    assert r.status_code == 403


def test_athlete_inconnu_404(auth_as, sql):
    _coach(sql, "coach-1")
    r = auth_as(uid="coach-1").get("/athletes/zzz/tracking", headers=_AUTH)
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# Contenu
# --------------------------------------------------------------------------- #


def test_aucune_donnee_reponse_vide(auth_as, sql):
    """Projection vide (ETL jamais joué, ou athlète sans entraînement) : réponse
    exploitable, pas une erreur — le front affiche un état vide."""
    _coach(sql, "coach-1")
    body = auth_as(uid="coach-1").get("/athletes/a1/tracking", headers=_AUTH).json()
    assert body == {"exercise": None, "exercises": [], "weeks": [], "courbes": [], "athleteWeeks": [],
                    "rpeBlocks": [], "lastSessionDate": None, "oneRmKg": None,
                    "setsByMovement": []}


def _seance(conn, exercise, semaine, **c):
    """Une SÉANCE réalisée, datée — donc comptée par l'agrégat hebdomadaire.

    ⚠️ `felt_rpe` **ET** `felt_rpe_raw`, et c'était un PIÈGE DE FIXTURE signalé
    dès le 21/08 (FRE-71 §5) : ce helper n'écrivait que le numérique, une
    combinaison qui n'existe sur AUCUNE des 15 060 lignes de production. Elle a
    fait passer des tests pour de mauvaises raisons le jour du premier
    changement de règle, et elle les a fait échouer au second — la trace se lit
    sur le brut, parce qu'un FAIL se saisit en toutes lettres et laisse le
    numérique NULL."""
    conn.execute(text(
        "INSERT INTO training_sets (athlete_id, program_id, session_index, "
        "exercise_index, exercise, session_date, date_exact, week_number, "
        "macro_number, block_number, sets, reps, reps_done, weight_kg, "
        "weight_done_kg, tonnage_kg, aimed_rpe, felt_rpe, felt_rpe_raw, variant, tempo, format) "
        "VALUES ('a1','p1',0,0,:ex,CAST(:d AS date),true,:w,1,1,"
        "        :sets,:reps,:reps,:kg,:kg,:tonnage,:aimed,:felt,CAST(:felt AS text),"
        "        :variant,:tempo,:format)"),
        {"ex": exercise, "d": semaine, "w": c.get("week", 1),
         "variant": c.get("variant"), "tempo": c.get("tempo"), "format": c.get("format"),
         "sets": c.get("sets", 5), "reps": c.get("reps", 3),
         "kg": c.get("kg", 100), "tonnage": c.get("tonnage", 1500),
         "aimed": c.get("aimed", 8), "felt": c.get("felt", 9)})


def _semer_une_ligne_vivante(conn, exercise: str, sets: str = "5") -> None:
    """Le plus court chemin de l'athlète a1 à une ligne d'exercice réalisée."""
    athlete = conn.execute(text(
        "SELECT id FROM athletes WHERE legacy_id = 'a1'")).scalar()
    conn.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                      "VALUES ('p-a1','coach-1',:a)"), {"a": athlete})
    macro = conn.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number) "
        "VALUES ('p-a1','m-a1',1) RETURNING id")).scalar()
    bloc = conn.execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number) "
        "VALUES (:m,'b-a1',1) RETURNING id"), {"m": macro}).scalar()
    semaine = conn.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number, start_date) "
        "VALUES (:b,'w-a1',1, date_trunc('week', current_date)) RETURNING id"),
        {"b": bloc}).scalar()
    seance = conn.execute(text(
        "INSERT INTO training_sessions (week_id, legacy_id, position, name) "
        "VALUES (:w,'s-a1',0,'Séance') RETURNING id"), {"w": semaine}).scalar()
    conn.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, sets, reps, felt_rpe) "
        "VALUES (:s, 0, :ex, :sets, '3', '8')"),
        {"s": seance, "ex": exercise, "sets": sets})


def test_UNE_REPONSE_PEUPLEE_porte_TOUS_ses_champs(auth_as, sql):
    """⚠️ LE TEST QUI ÉTAIT IMPOSSIBLE AVANT LE PORTAGE, et celui qui manquait le
    plus.

    L'agrégat hebdomadaire est Postgres-only : sur le stub SQLite, aucun test ne
    pouvait produire une réponse REMPLIE. Les 17 autres passent tous par le chemin
    « aucune donnée », qui court-circuite avant. Le `response_model` de FRE-70
    n'était donc confronté à aucune valeur réelle — et comme il VALIDE à
    l'exécution, un modèle faux aurait rendu 500 en silence jusqu'en production.

    Celui-ci sème deux séances datées, traverse l'agrégat, et fige l'ensemble EXACT
    des clés aux quatre niveaux : la réponse, une semaine du mouvement, une semaine
    d'athlète, un bloc de RPE."""
    _seance(sql, "SQUAT", "2026-01-05", week=1, felt=9, aimed=8)
    _seance(sql, "SQUAT", "2026-01-12", week=2, felt=7, aimed=8)
    # ⚠️ ET UN ARBRE, parce que `setsByMovement` ne lit PAS la projection (FRE-148
    # corrigé le 07/09) : il lit les tables vivantes, comme le tableau des
    # records. Sans ces lignes, la cinquième série sortirait vide et cette spec
    # cesserait de confronter le `response_model` à une vraie valeur — ce pour
    # quoi elle existe.
    _semer_une_ligne_vivante(sql, "SQUAT")

    body = auth_as(uid="coach-1").get("/athletes/a1/tracking", headers=_AUTH).json()

    assert set(body) == {"exercise", "exercises", "lastSessionDate", "oneRmKg",
                         "rpeBlocks", "athleteWeeks", "weeks", "courbes", "setsByMovement"}
    assert set(body["courbes"][0]) == {"variant", "tempo", "format", "series", "weeks"}
    assert set(body["courbes"][0]["weeks"][0]) == {
        "week", "chargeMaxKg", "topSetFormat", "tonnageTotalKg", "sessions", "fails"}
    assert body["exercise"] == "SQUAT"
    assert body["weeks"], "l'agrégat n'a rien rendu : ce test ne prouverait rien"
    assert set(body["weeks"][0]) == {
        "week", "chargeMaxKg", "tonnageAtMaxKg", "topSetFormat", "tonnageTotalKg",
        "tonnagePrevuTotalKg", "repsPrevuTotal",
        "repsTotal", "feltRpe", "aimedRpe", "sessions", "fails", "failsAtMax",
        "macroNumber", "blockNumber"}
    assert set(body["athleteWeeks"][0]) == {
        "week", "feltRpe", "aimedRpe", "sessions", "macroNumber", "blockNumber"}
    assert set(body["rpeBlocks"][0]) == {
        "macroNumber", "blockNumber", "from", "to", "weeks", "feltRpe", "aimedRpe",
        "gap", "rated"}
    # ⚠️ SQUAT EST UN LIFT DE COMPÉTITION dans la bibliothèque semée par
    # `conftest`, donc la cinquième série est peuplée elle aussi — sans ça,
    # `set(body["setsByMovement"][0])` lèverait un IndexError plutôt que
    # d'affirmer quoi que ce soit.
    assert body["setsByMovement"], "la série des lifts n'a rien rendu"
    assert set(body["setsByMovement"][0]) == {
        "week", "movement", "setsDone", "setsPlanned"}
    # Et les VALEURS suivent : deux semaines agrégées, la charge relue.
    assert len(body["weeks"]) == 2
    assert body["weeks"][0]["chargeMaxKg"] == 100


def test_liste_mouvements_triee_par_volume(sql):
    """Le sélecteur propose le plus travaillé en premier — c'est lui qui décide du
    mouvement affiché par défaut à l'ouverture du Tracker."""
    from app.suivi.metier_tracking import EXERCISES_SQL

    _seed_exercise(sql, "SQUAT", 3)
    _seed_exercise(sql, "DIPS", 7)
    rows = sql.execute(EXERCISES_SQL, {"legacy": "a1"}).all()
    assert [(r.exercise, r.n) for r in rows] == [("DIPS", 7), ("SQUAT", 3)]


# --------------------------------------------------------------------------- #
# Choix du mouvement (fonction pure)
# --------------------------------------------------------------------------- #

_EXOS = [{"name": "DIPS", "count": 7}, {"name": "SQUAT", "count": 3}]


def test_pick_defaut_le_plus_travaille():
    from app.suivi.metier_tracking import pick_exercise

    assert pick_exercise(_EXOS, None) == "DIPS"


def test_pick_respecte_la_demande():
    from app.suivi.metier_tracking import pick_exercise

    assert pick_exercise(_EXOS, "SQUAT") == "SQUAT"


def test_pick_mouvement_inconnu_retombe_sur_le_defaut():
    """Un exercice jamais fait par l'athlète ne doit pas produire une page vide
    silencieuse : on retombe sur son mouvement principal."""
    from app.suivi.metier_tracking import pick_exercise

    assert pick_exercise(_EXOS, "SAUT A LA CORDE") == "DIPS"


def test_pick_aucun_mouvement():
    from app.suivi.metier_tracking import pick_exercise

    assert pick_exercise([], "SQUAT") is None


# --------------------------------------------------------------------------- #
# 1RM de référence
# --------------------------------------------------------------------------- #


def test_one_rm_key_mouvements_de_compet():
    from app.suivi.metier_tracking import one_rm_key

    assert one_rm_key("SQUAT") == "squat"
    assert one_rm_key("DIPS") == "dip"
    assert one_rm_key("PULL UP") == "pullUp"
    assert one_rm_key("MUSCLE UP") == "muscleUp"
    assert one_rm_key("CHIN UP") == "chinUp"


def test_one_rm_key_insensible_casse_espaces():
    from app.suivi.metier_tracking import one_rm_key

    assert one_rm_key("  squat ") == "squat"


def test_one_rm_key_mouvement_sans_1rm():
    """Un renforcement n'a pas de 1RM de programmation : pas de ligne de
    référence, plutôt qu'une valeur empruntée à un autre mouvement."""
    from app.suivi.metier_tracking import one_rm_key

    assert one_rm_key("LEG CURL") is None
    assert one_rm_key("BACK EXTENSION") is None


# --------------------------------------------------------------------------- #
# LE FUTUR N'EST PAS DU SUIVI — sur le VRAI Postgres.
#
# Ces agrégats sont Postgres-only (`date_trunc`, `FILTER`, `count(DISTINCT (a,b))`
# sur un row) et n'étaient donc couverts par AUCUN test : « validés à part contre
# Neon », disait l'en-tête. C'est exactement là que le défaut s'est logé — les
# semaines PLANIFIÉES entraient dans les courbes avec leur prescription, et le
# Tracking annonçait des données jusqu'au 21 septembre le 17 août.
# --------------------------------------------------------------------------- #

from app.suivi.metier_tracking import LAST_SESSION_SQL, WEEKS_SQL  # noqa: E402


@pytest.fixture
def suivi(pg):
    """Trois séances de SQUAT, qui couvrent les trois cas :
      · passée AVEC trace (l'athlète a saisi ses reps)      → comptée
      · AUJOURD'HUI sans trace                              → écartée
      · programmée dans un mois                             → écartée

    Le cas du milieu est celui que la seule date laissait passer : le repli date
    toute la semaine à son lundi, donc le lundi le programme de la semaine porte
    la date du jour. C'est ce que William a vu le 17/08 sur ses DIPS."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','ath-1','coach-1','A')"))
    # ⚠️ LA TRACE EST LE RPE RESSENTI, et lui seul (26/08). La ligne passée en
    # porte un ; celle du jour et celle du mois prochain n'en ont pas — ce sont
    # des séances PROGRAMMÉES, elles ne doivent entrer nulle part.
    for jours, charge, rpe in ((-7, 100, "8"), (0, 150, None), (+30, 200, None)):
        pg.execute(text(
            "INSERT INTO training_sets (athlete_id, program_id, session_index, "
            "  exercise_index, exercise, session_date, date_exact, week_number, "
            "  sets, reps, felt_rpe_raw, weight_kg, tonnage_kg) "
            "VALUES ('ath-1','p1',0,0,'SQUAT', current_date + :j, false, 1, "
            "        3, 5, :rpe, :w, 3*5*:w)"),
            {"j": jours, "w": charge, "rpe": rpe})
    return pg


def test_seules_les_seances_avec_une_trace_comptent(suivi):
    lignes = suivi.execute(WEEKS_SQL, {"legacy": "ath-1", "exercise": "SQUAT"}).all()
    assert len(lignes) == 1
    # Celle de la semaine passée, à 100 kg — ni le programme du jour (150),
    # ni celui du mois prochain (200).
    assert float(lignes[0].charge_max_kg) == 100


def test_une_seance_LANCEE_sans_saisie_ne_compte_PAS(suivi):
    """⚠️ DÉCISION INVERSÉE LE 26/08, et c'est la plus importante du lot.

    `date_exact` disait « la séance porte sa propre date », écrite au LANCEMENT
    en même temps que la forme du jour. On en concluait qu'elle avait eu lieu.
    Or on peut ouvrir l'app, noter 3/5 et repartir : toutes les lignes de la
    séance comptaient alors comme réalisées, avec leur charge PRESCRITE.

    C'était un signal de SÉANCE utilisé pour trancher sur une LIGNE. 531 lignes
    de production ne tenaient que sur lui, dont 197 chargées."""
    suivi.execute(text(
        "UPDATE training_sets SET date_exact = true WHERE weight_kg = 150"))
    charges = {float(r.charge_max_kg) for r in
               suivi.execute(WEEKS_SQL, {"legacy": "ath-1", "exercise": "SQUAT"}).all()}
    assert charges == {100}, "la séance du jour n'a qu'un lancement, pas un RPE"


def test_un_RPE_PAR_SERIE_suffit_aussi(suivi):
    """L'autre moitié de la trace : le RPE se saisit série par série, et un seul
    suffit à prouver que la ligne a eu lieu."""
    suivi.execute(text(
        "UPDATE training_sets SET rpe_by_set = ARRAY[7]::numeric[], felt_rpe_by_set_raw = ARRAY['7'] "
        "WHERE weight_kg = 150"))
    charges = {float(r.charge_max_kg) for r in
               suivi.execute(WEEKS_SQL, {"legacy": "ath-1", "exercise": "SQUAT"}).all()}
    assert charges == {100, 150}


def test_un_ECHEC_par_serie_est_une_trace_aussi(suivi):
    """⚠️ `['FAIL']` EST UNE TRACE : la série a eu lieu, et a échoué (FRE-216).
    Le dialecte de la projection la perdait — `rpe_by_set IS NOT NULL`, et
    `ff_rpe_by_set` écarte ce qui n'est pas un nombre — là où l'arbre la voyait.
    `tracee` se déduit du BRUT, par `ff_tracee`, comme l'arbre.

    MUTATION QUI ROUGIT : engendrer `tracee` depuis `rpe_by_set`."""
    suivi.execute(text(
        "UPDATE training_sets SET felt_rpe_by_set_raw = ARRAY['FAIL'] WHERE weight_kg = 150"))
    charges = {float(r.charge_max_kg) for r in
               suivi.execute(WEEKS_SQL, {"legacy": "ath-1", "exercise": "SQUAT"}).all()}
    assert charges == {100, 150}


@pytest.mark.parametrize("felt_rpe, par_serie, tracee", [
    ("8", None, True),
    (" ", None, False),
    (None, ["FAIL"], True),
    (None, ["7", ""], True),
    (None, [], False),
    (None, None, False),
])
def test_ff_tracee_est_LA_definition_de_realise(pg, felt_rpe, par_serie, tracee):
    """Un ressenti — global ou par série, FAIL compris — et rien d'autre ; `{}`
    et le blanc ne sont pas des traces."""
    assert pg.execute(text("SELECT ff_tracee(:g, CAST(:s AS text[]))"),
                      {"g": felt_rpe, "s": par_serie}).scalar() is tracee


def test_une_CHARGE_REALISEE_seule_ne_suffit_plus(suivi):
    """⚠️ ELLE PEUT ÊTRE PRÉ-REMPLIE OU CORRIGÉE PAR LE COACH — un RPE ressenti,
    non : c'est une sensation. Mesuré avant de trancher : seules 47 lignes sur
    8 736 portaient une charge ou des reps réalisées SANS aucun RPE."""
    suivi.execute(text(
        "UPDATE training_sets SET weight_done_kg = 160, reps_done = 5 WHERE weight_kg = 150"))
    charges = {float(r.charge_max_kg) for r in
               suivi.execute(WEEKS_SQL, {"legacy": "ath-1", "exercise": "SQUAT"}).all()}
    assert charges == {100}


def test_un_COMMENTAIRE_seul_ne_suffit_plus(suivi):
    """⚠️ IL SE TROMPAIT UNE FOIS SUR DEUX : 36 lignes apportées en production,
    dont 19 disant explicitement « Pas fait » — comptées comme réalisées, pour
    ~3 600 kg de tonnage fantôme."""
    suivi.execute(text(
        "UPDATE training_sets SET athlete_feedback = 'Pas fait, épaule' WHERE weight_kg = 150"))
    charges = {float(r.charge_max_kg) for r in
               suivi.execute(WEEKS_SQL, {"legacy": "ath-1", "exercise": "SQUAT"}).all()}
    assert charges == {100}


def test_la_fraicheur_annoncee_ne_devance_pas_le_jour(suivi):
    """`lastSessionDate` dit « jusqu'où va la donnée » : l'annoncer dans le futur
    faisait promettre au front une fraîcheur que les courbes ne montraient pas."""
    from datetime import date, timedelta
    assert suivi.execute(LAST_SESSION_SQL, {"legacy": "ath-1"}).scalar() \
        == date.today() - timedelta(days=7)


# --------------------------------------------------------------------------- #
# LES SÉRIES PAR SEMAINE, SUR LES LIFTS DE COMPÉTITION (FRE-148)
#
# ⚠️ CE CALCUL RÉPOND À LA QUESTION INVERSE DE `WEEKS_SQL`. Celui-là creuse UN
# mouvement sur toutes ses métriques ; celui-ci compare TOUS les lifts sur une
# seule. D'où une fixture à part : celle du dessus ne sème qu'un mouvement, et
# ne porte aucune série PRESCRITE — or c'est le couple fait/prescrit qui est le
# sujet.
# --------------------------------------------------------------------------- #

from app.suivi.metier_tracking import SERIES_PAR_LIFT_SQL  # noqa: E402


@pytest.fixture
def series(pg):
    """L'ARBRE VIVANT, pas la projection — c'est là que ce calcul lit désormais.

    ⚠️ ET C'EST UN MEILLEUR BANC D'ESSAI. Semer `training_sets` revenait à
    éprouver le calcul sur une donnée déjà DÉRIVÉE : les séries tenues y sont un
    entier tout prêt, alors que la règle de FRE-110 est justement ce que la
    lecture doit appliquer. Ici on écrit ce que l'athlète écrit — « 5 » et un
    tableau de RPE — et `ff_series_tenues` fait le reste."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-2','s@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-2')"))
    athlete = pg.execute(text(
        "INSERT INTO athletes (legacy_id, coach_uid, first_name) "
        "VALUES ('ath-2','coach-2','B') RETURNING id")).scalar()
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                    "VALUES ('p2','coach-2',:a)"), {"a": athlete})
    macro = pg.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number) "
        "VALUES ('p2','m2',1) RETURNING id")).scalar()
    bloc = pg.execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number) "
        "VALUES (:m,'b2',1) RETURNING id"), {"m": macro}).scalar()

    seances: dict[int, str] = {}

    def semaine_et_seance(jours: int) -> str:
        """Une séance par décalage, sous une semaine datée en conséquence.

        ⚠️ `jours` SE COMPTE DEPUIS LE LUNDI DE LA SEMAINE EN COURS, pas depuis
        aujourd'hui : `current_date - 7` tombe dans la semaine précédente un
        lundi et dans celle-ci un dimanche. Une suite qui passe le mardi et
        échoue le samedi ne dit plus rien."""
        if jours not in seances:
            n = len(seances) + 1
            sem = pg.execute(text(
                "INSERT INTO training_weeks (block_id, legacy_id, number, start_date) "
                "VALUES (:b, :l, :n, "
                "        date_trunc('week', current_date) + make_interval(days => :j)) "
                "RETURNING id"), {"b": bloc, "l": f"w{n}", "n": n, "j": jours}).scalar()
            seances[jours] = pg.execute(text(
                "INSERT INTO training_sessions (week_id, legacy_id, position, name) "
                "VALUES (:w, :l, 0, 'Séance') RETURNING id"),
                {"w": sem, "l": f"seance{n}"}).scalar()
        return seances[jours]

    def ligne(exercise, jours, sets, prevus, rpe, **c):
        """`sets` est ce que l'athlète a TENU, `prevus` ce qui était écrit.

        Quand les deux diffèrent, on écrit le tableau de RPE par série qui
        produit l'écart — un `FAIL` par série manquée. C'est la forme RÉELLE de
        la donnée : `sets` n'est pas un compte de séries tenues dans l'arbre,
        c'est la prescription, et les séries tenues s'en DÉDUISENT."""
        par_serie = c.get("rpe_by_set")
        if par_serie is None and rpe is not None and sets < prevus:
            par_serie = ["8"] * sets + ["FAIL"] * (prevus - sets)
        pg.execute(text(
            "INSERT INTO training_exercises (session_id, position, name, sets, reps, "
            "  reps_unit, kind, felt_rpe, felt_rpe_by_set) "
            "VALUES (:s, :pos, :ex, :prevus, '5', :unit, :kind, :rpe, "
            "        CAST(:par_serie AS text[]))"),
            {"s": semaine_et_seance(jours), "pos": c.get("ei", 0), "ex": exercise,
             "prevus": str(prevus), "rpe": rpe, "par_serie": par_serie,
             "unit": c.get("unit", "count"), "kind": c.get("kind")})
    return pg, ligne


def _lire(pg, ):
    return {(r.mouvement, r.semaine): (r.sets_faits, r.sets_prescrits)
            for r in pg.execute(SERIES_PAR_LIFT_SQL, {"legacy": "ath-2"}).all()}


def test_un_tableau_VIDE_par_serie_n_est_pas_une_trace(series):
    """`{}` n'est pas un ressenti : rien n'est fait. La formulation en ligne de
    cette requête (`felt_rpe_by_set IS NOT NULL`) le comptait comme une trace ;
    `ff_tracee` ne le fait pas (FRE-216).

    MUTATION QUI ROUGIT : remettre `IS NOT NULL` à la place de `ff_tracee`."""
    pg, ligne = series
    ligne("SQUAT", -7, 3, 3, None, rpe_by_set=[])
    assert list(_lire(pg).values()) == [(0, 3)]


def test_une_serie_calee_se_lit_dans_l_ECART_avec_le_prescrit(series):
    """⚠️ `sets` COMPTE LES SÉRIES TENUES, PAS PRESCRITES (FRE-110). Sans le
    second nombre en face, une semaine où l'athlète a calé se lit « il en a fait
    moins » — sans jamais dire qu'il a essayé."""
    pg, ligne = series
    ligne("SQUAT", -7, sets=6, prevus=7, rpe="8")

    (faits, prescrits), = _lire(pg).values()
    assert (faits, prescrits) == (6, 7)


def test_une_semaine_JAMAIS_REALISEE_garde_son_PRESCRIT(series):
    """⚠️ LA SPEC QUI GARDE LE PIÈGE DE CE CALCUL, et il est facile à reproduire :
    le filtre de trace ne porte QUE sur le fait.

    La projection GARDE les lignes non réalisées — 3 704 sur 14 966, mesuré le
    07/09 — et ce sont les agrégats qui les écartent. Réutiliser `_REALISE` des
    deux côtés, le réflexe, rendrait `0 / 0` sur toute semaine où l'athlète n'est
    pas venu. Or c'est exactement le couple qui distingue les trois situations :

      0 / 0 → rien n'était prévu     0 / 7 → prévu, pas fait     6 / 7 → calé

    Et sans cette spec, l'erreur passerait : la fonctionnalité aurait l'air de
    marcher partout où l'athlète s'entraîne."""
    pg, ligne = series
    ligne("SQUAT", -7, sets=0, prevus=7, rpe=None)     # il n'est pas venu

    (faits, prescrits), = _lire(pg).values()
    assert faits == 0, "aucune série tenue"
    assert prescrits == 7, "mais elles étaient au programme, et ça se voit"


def test_le_PROGRAMME_A_VENIR_n_est_pas_un_manquement(series):
    """⚠️ `session_date <= current_date` RESTE DES DEUX CÔTÉS. Les trames futures
    sont déjà en base — la première semaine sans réalisation trouvée en
    production est en OCTOBRE. Sans cette borne, le tableau afficherait le
    programme du mois prochain comme des séries non faites."""
    pg, ligne = series
    ligne("SQUAT", +30, sets=0, prevus=9, rpe=None)
    assert _lire(pg) == {}


def test_une_ISOMETRIE_compte_ses_series(series):
    """⚠️ ET C'EST L'INVERSE DE LA RÈGLE DES RÉPÉTITIONS. `reps_total` exclut
    `reps_unit = 'sec'` (FRE-20 : « 3 × 60 s » valait 180 répétitions jamais
    exécutées). Une SÉRIE reste une série quelle que soit son unité — un gainage
    3 × 60 s, c'est trois séries. Recopier ce filtre par symétrie, le geste
    naturel, en ferait disparaître 22 de la production sans raison."""
    pg, ligne = series
    ligne("DIPS", -7, sets=3, prevus=3, rpe="7", unit="sec")

    (faits, prescrits), = _lire(pg).values()
    assert (faits, prescrits) == (3, 3)


def test_seuls_les_LIFTS_DE_COMPETITION_entrent(series):
    """La bibliothèque est la spécification : `competition = true`, et rien
    d'énuméré dans le SQL."""
    pg, ligne = series
    ligne("SQUAT", -7, sets=5, prevus=5, rpe="8")
    ligne("ROWING", -7, sets=4, prevus=4, rpe="8", ei=1)   # renforcement

    assert set(m for m, _ in _lire(pg)) == {"SQUAT"}


def test_un_lift_AJOUTE_A_LA_BIBLIOTHEQUE_apparait_SANS_toucher_au_code(series):
    """⚠️ LA SPEC QUI INTERDIT LA SEPTIÈME LISTE EN DUR. La liste des mouvements
    vivait à cinq endroits, FRE-147 en a découvert un sixième oublié — et le
    schéma annonce depuis toujours que `library_entries.competition` « remplace
    la constante front PRINCIPAL_MOVEMENTS codée en dur ». Énumérer les lifts
    dans ce SQL rendrait cette spec rouge, ce qui est tout ce qu'on lui demande."""
    pg, ligne = series
    ligne("ROWING", -7, sets=4, prevus=4, rpe="8")
    assert _lire(pg) == {}, "le rowing n'est pas un lift de compétition"

    pg.execute(text("UPDATE library_entries SET competition = true "
                    "WHERE category = 'exercices' AND name = 'ROWING'"))

    (faits, prescrits), = _lire(pg).values()
    assert (faits, prescrits) == (4, 4)


def test_l_ECHAUFFEMENT_ne_gonfle_pas_le_compte(series):
    """FRE-10 : seul l'ENTRAÎNEMENT compte. Une série d'échauffement est une
    série faite, mais pas une série de travail — la compter ferait croire à un
    volume qui n'a pas été programmé."""
    pg, ligne = series
    ligne("SQUAT", -7, sets=5, prevus=5, rpe="8")
    ligne("SQUAT", -7, sets=3, prevus=3, rpe="5", ei=1, kind="warmup")

    (faits, prescrits), = _lire(pg).values()
    assert (faits, prescrits) == (5, 5)


# --------------------------------------------------------------------------- #
# UNE COURBE PAR COMBINAISON (FRE-182)
# --------------------------------------------------------------------------- #

def test_une_courbe_par_variante_tempo_format_la_plus_travaillee_d_abord(auth_as, sql):
    """BENCH PRESS mêlait l'haltère (30 kg) et la barre de compétition (113 kg)
    dans une seule courbe. Chaque combinaison a désormais la sienne, et les
    semaines ne se mélangent pas.

    ⚠️ `{PAUSE, BARBELL}` ET `{BARBELL, PAUSE}` FONT UNE SEULE COURBE : le même
    geste saisi dans deux ordres.

    MUTATIONS QUI ROUGISSENT : ne pas trier les variantes ; ne pas mettre la
    combinaison dans le `PARTITION BY` de la charge max."""
    _coach(sql, "coach-1")
    _seance(sql, "BENCH PRESS", "2026-01-05", kg=80, variant=["PAUSE", "BARBELL"])
    _seance(sql, "BENCH PRESS", "2026-01-05", kg=30, variant=["DUMBBELL"])
    _seance(sql, "BENCH PRESS", "2026-01-12", kg=82, variant=["BARBELL", "PAUSE"])
    _seance(sql, "BENCH PRESS", "2026-01-12", kg=110, variant=None, tempo="310", format="EMOM")

    courbes = auth_as(uid="coach-1").get("/athletes/a1/tracking?exercise=BENCH%20PRESS",
                                          headers=_AUTH).json()["courbes"]

    par_cle = {(tuple(c["variant"]), c["tempo"], c["format"]): c for c in courbes}
    assert set(par_cle) == {(("BARBELL", "PAUSE"), None, None), (("DUMBBELL",), None, None),
                            ((), "310", "EMOM")}
    barre = par_cle[(("BARBELL", "PAUSE"), None, None)]
    assert courbes[0] is not None and courbes[0]["series"] == 2 and courbes[0] == barre
    assert [w["chargeMaxKg"] for w in barre["weeks"]] == [80, 82]
    # La charge max d'une semaine est celle de SA combinaison, pas du mouvement.
    assert [w["chargeMaxKg"] for w in par_cle[(("DUMBBELL",), None, None)]["weeks"]] == [30]
