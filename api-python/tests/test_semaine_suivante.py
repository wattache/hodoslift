"""LA SEMAINE SUIVANTE — specs portées de `eitri/src/lib/next-week.test.ts` (26/08).

⚠️ PORTÉES, PAS RÉÉCRITES. Chaque cas gardé ici en gardait un là-bas, et les
raisons d'être sont recopiées avec : ce sont elles qui disent pourquoi la règle
est ce qu'elle est. Une migration qui ne garde que les assertions perd la moitié
de ce qui protège.

⚠️ ET LE MODE `%` A ÉTÉ RETIRÉ (01/09/2026). Il n'était éprouvé nulle part avant
d'arriver ici — le seul mode d'incrément sans test, et par hasard celui qui ne
pouvait pas fonctionner. L'avoir réparé puis éprouvé est CE QUI A PERMIS DE LE
RETIRER : le défaut visible était une référence non persistée, le vrai était que
la référence bougeait. Voir `resoudre_increment`.

Ces specs travaillent sur la FONCTION, pas sur la route : c'est du calcul pur,
et le faire passer par HTTP n'ajouterait que du bruit. La route a les siennes
plus bas.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app
from app.entrainement.semaine_suivante import granularite, resoudre_increment, semaine_suivante

_AUTH = {"Authorization": "Bearer x"}


def ligne(**over):
    """Une ligne réaliste : la forme complète, les valeurs qu'on veut éprouver.

    ⚠️ ELLE PORTE UN NOM PAR DÉFAUT, et c'est délibéré : une ligne sans nom est un
    résidu d'édition que la copie écarte. Laisser le vide en défaut faisait
    reposer des tests sans rapport sur un cas de bord — celui du RPE plafonné à
    10 s'était retrouvé à lire la première ligne d'une séance devenue vide."""
    return {"id": "ex-source", "name": "EXO", "variant": [], "kind": None,
            "format": "", "clusterMode": "", "clusterRest": "", "tempo": "",
            "sets": "", "reps": "", "repsUnit": "count", "weight": "",
            "weightLocked": False, "assistance": "", "aimedRPE": "", "rest": "",
            "coachNote": "", "increment": "", "incrementUnit": "kg", "tier": None,
            "groupId": "", "repsDone": "", "weightDone": "", "restActual": "",
            "feltRPE": "", "feltRPEBySet": [], "athleteFeedback": "", "link": "",
            "mechano": None, **over}


def seance(exercises, **over):
    return {"id": "se-source", "name": "Lundi", "sessionDate": "",
            "formOfTheDay": "", "exercises": exercises, **over}


def semaine(sessions, **over):
    return {"id": "wk-1", "weekNumber": 1, "name": "", "hidden": False,
            "startDate": "", "endDate": "", "sessions": sessions, **over}


def base_vide(**over):
    return {"daySplit": [], "principles": [], "accessories": [],
            "selectedPrincipaux": None, "granularity": {},
            "s1StartDate": "", "s1EndDate": "", **over}


def bloc(weeks, base=None):
    return {"id": "bl-1", "blockNumber": 1, "name": "", "startDate": "",
            "endDate": "", "base": base or base_vide(), "objectives": [],
            "weeks": weeks}


def _lignes(resultat, i=0):
    return resultat["sessions"][i]["exercises"]


# --------------------------------------------------------------------------- #
# LES IDENTITÉS — le test de non-régression du 15/08
# --------------------------------------------------------------------------- #

def test_la_copie_ne_porte_AUCUN_id_de_la_semaine_source():
    """⚠️ LA COPIE PORTAIT LES UUID DE LA SEMAINE SOURCE, aux trois niveaux. Les
    frappes du coach dans la semaine neuve partaient donc en
    `PATCH /exercises/{ligne de la semaine passée}` — accepté par le serveur
    (même programme, ligne existante) et le réalisé d'avant écrasé. En silence,
    et sans fin : tant qu'il tapait, la resynchronisation qui aurait refermé la
    fenêtre restait bloquée par les écritures en attente."""
    resultat = semaine_suivante(bloc([semaine([seance([ligne()])])]))

    assert "id" not in resultat["sessions"][0]
    assert "id" not in _lignes(resultat)[0]


def test_un_bloc_SANS_semaine_rend_une_semaine_neuve():
    resultat = semaine_suivante(bloc([]))
    assert resultat["weekNumber"] == 1
    assert resultat["sessions"] == [{"name": "Séance 1", "sessionDate": None, "exercises": []}]


def test_les_dates_s_enchaînent_sur_la_semaine_précédente():
    source = semaine([seance([ligne()])], endDate="2026-03-08")
    resultat = semaine_suivante(bloc([source]))
    assert (resultat["startDate"], resultat["endDate"]) == ("2026-03-09", "2026-03-15")


def test_la_semaine_suivante_dure_AUTANT_QUE_S1():
    """⚠️ « + 6 JOURS » EN DUR IMPOSAIT SEPT JOURS À UN BLOC QUI EN DÉCLARE DIX
    (FRE-138). La durée est celle de S1 dans la BASE — la règle de la cascade du
    front (`blockWeekDates`). MUTATION QUI ROUGIT : remettre `timedelta(days=6)`."""
    base = base_vide(s1StartDate="2026-02-27", s1EndDate="2026-03-08")   # dix jours
    source = semaine([seance([ligne()])], startDate="2026-02-27", endDate="2026-03-08")
    resultat = semaine_suivante(bloc([source], base))
    assert (resultat["startDate"], resultat["endDate"]) == ("2026-03-09", "2026-03-18")


# --------------------------------------------------------------------------- #
# LA CHARGE VERROUILLÉE
# --------------------------------------------------------------------------- #

def test_la_charge_VERROUILLÉE_est_conservée():
    """`weightLocked` est un BOOLÉEN depuis Postgres. Comparé à la chaîne
    `'true'`, aucun verrou n'était jamais reconnu : la charge des 997 lignes
    verrouillées de la base était effacée à chaque copie de semaine."""
    source = semaine([seance([ligne(name="SQUAT", weight="140", weightLocked=True)])])
    assert _lignes(semaine_suivante(bloc([source])))[0]["weight"] == "140"


def test_une_charge_que_RIEN_ne_fait_progresser_est_effacée():
    source = semaine([seance([ligne(name="SQUAT", weight="140")])])
    assert _lignes(semaine_suivante(bloc([source])))[0]["weight"] is None


def test_un_incrément_qui_prend_la_charge_en_charge_la_GARDE():
    source = semaine([seance([ligne(name="SQUAT", weight="140", increment="2.5")])])
    assert _lignes(semaine_suivante(bloc([source])))[0]["weight"] == "142.5"


# --------------------------------------------------------------------------- #
# LE RÉALISÉ ET LES INCRÉMENTS
# --------------------------------------------------------------------------- #

def test_tout_ce_qui_appartient_à_la_semaine_ENTRAÎNÉE_est_vidé():
    source = semaine([seance([ligne(
        name="DIP", weight="20", weightLocked=True, repsDone="8", weightDone="22",
        restActual="200", feltRPE="9", feltRPEBySet=["8", "9"], athleteFeedback="dur")])])

    l = _lignes(semaine_suivante(bloc([source])))[0]
    assert (l["repsDone"], l["weightDone"], l["restActual"]) == (None, None, None)
    # ⚠️ Les TABLEAUX restent des listes vides : c'est une autre règle, et elle
# tient (FRE-62, FRE-111). Seuls les scalaires disent l'absence par `None`.
    assert (l["feltRPE"], l["feltRPEBySet"], l["athleteFeedback"]) == (None, [], None)


def test_la_forme_du_jour_et_la_date_de_séance_sont_vidées():
    source = semaine([seance([ligne()], formOfTheDay=4, sessionDate="2026-03-03")])
    s = semaine_suivante(bloc([source]))["sessions"][0]
    assert s["sessionDate"] is None
    assert "formOfTheDay" not in s, "la forme du jour ne se copie pas"


def test_séries_reps_et_RPE_s_incrémentent_selon_l_unité():
    source = semaine([seance([
        ligne(name="A", sets="3", increment="1", incrementUnit="sets"),
        ligne(name="B", reps="8", increment="2", incrementUnit="reps"),
        ligne(name="C", aimedRPE="7", increment="0.5", incrementUnit="rpe"),
    ])])
    a, b, c = _lignes(semaine_suivante(bloc([source])))
    assert (a["sets"], b["reps"], c["aimedRPE"]) == ("4", "10", "7.5")


def test_le_RPE_incrémenté_est_plafonné_à_10():
    source = semaine([seance([ligne(aimedRPE="9.5", increment="1", incrementUnit="rpe")])])
    assert _lignes(semaine_suivante(bloc([source])))[0]["aimedRPE"] == "10"


def test_le_RPE_cible_s_hérite_de_la_semaine_passée():
    s1 = semaine([seance([ligne(name="SQUAT", aimedRPE="8")])])
    s2 = semaine([seance([ligne(name="SQUAT", aimedRPE="")])], id="wk-2", weekNumber=2)
    assert _lignes(semaine_suivante(bloc([s1, s2])))[0]["aimedRPE"] == "8"


def test_à_défaut_d_historique_le_RPE_vient_de_la_BASE():
    source = semaine([seance([ligne(name="SQUAT", sets="5", reps="3")])])
    base = base_vide(principles=[{
        "id": "", "name": "SQUAT", "tier": 1, "variant": [], "kind": None,
        "format": "", "clusterMode": "", "clusterRest": "", "tempo": "",
        "sets": "5", "reps": "3", "repsUnit": "count", "weight": "",
        "weightLocked": False, "rest": "", "aimedRPE": "8.5", "assistance": "",
        "coachNote": "", "increment": "", "incrementUnit": "kg",
    }])
    assert _lignes(semaine_suivante(bloc([source], base)))[0]["aimedRPE"] == "8.5"


# --------------------------------------------------------------------------- #
# LES LIGNES SANS NOM
# --------------------------------------------------------------------------- #

def test_une_ligne_SANS_NOM_ne_se_copie_pas_où_qu_elle_soit():
    """La règle du SERVEUR, appliquée par la copie. Une ligne vide est un résidu
    d'édition ; le chargement en masse l'écarte, si bien que le front devait la
    recréer après coup — en FIN de séance, d'où un ordre divergent quand elle
    était au milieu."""
    source = semaine([seance([ligne(name="SQUAT"), ligne(name=""), ligne(name="DIPS")])])
    assert [l["name"] for l in _lignes(semaine_suivante(bloc([source])))] == ["SQUAT", "DIPS"]


def test_un_nom_fait_d_ESPACES_est_écarté_aussi():
    source = semaine([seance([ligne(name="   "), ligne(name="SQUAT")])])
    assert [l["name"] for l in _lignes(semaine_suivante(bloc([source])))] == ["SQUAT"]


def test_l_héritage_du_RPE_n_est_PAS_décalé_par_les_lignes_écartées():
    """⚠️ LE FILTRE VIENT APRÈS LA BOUCLE POUR CETTE RAISON PRÉCISE : l'index de
    la ligne sert à retrouver la correspondante dans les semaines passées."""
    s1 = semaine([seance([ligne(name="SQUAT", aimedRPE="7"), ligne(name=""),
                          ligne(name="DIPS", aimedRPE="9")])])
    s2 = semaine([seance([ligne(name="SQUAT"), ligne(name=""), ligne(name="DIPS")])],
                 id="wk-2", weekNumber=2)
    assert [(l["name"], l["aimedRPE"]) for l in _lignes(semaine_suivante(bloc([s1, s2])))] \
        == [("SQUAT", "7"), ("DIPS", "9")]


def test_une_séance_reste_VIDE_plutôt_que_d_inventer_une_ligne():
    source = semaine([seance([ligne(name="")])])
    assert _lignes(semaine_suivante(bloc([source]))) == []


# --------------------------------------------------------------------------- #
# ⚠️ L'INCRÉMENT DE CHARGE, ET LE PAS QUI L'ARRONDIT
#
# Ce bloc éprouvait le mode POURCENTAGE, retiré le 01/09/2026 (voir
# `resoudre_increment`). Ce qui restait vrai a été réécrit en KILOS plutôt que
# supprimé : le pas et son arrondi ne dépendaient pas de l'unité, seuls les
# exemples en dépendaient.
# --------------------------------------------------------------------------- #

def test_le_pas_du_SQUAT_est_de_2_5():
    """Un coach écrit « +3 kg » sur un squat, mais le squat ne se charge pas plus
    fin que 2,5 : l'arrondi VERS LE HAUT donne 5.

    ⚠️ « 3 » ET PAS « 4 », ET C'EST TOUT L'INTÉRÊT DE L'EXEMPLE. Avec 4, la
    réponse vaut 105 au pas de 2,5 COMME au pas par défaut de 1,25, et même en
    arrondissant au plus proche — la spec était verte quoi qu'on casse. Avec 3,
    les trois réponses divergent : 105, 103,75 et 102,5."""
    source = semaine([seance([ligne(name="SQUAT", weight="100", increment="3")])])
    assert _lignes(semaine_suivante(bloc([source])))[0]["weight"] == "105"


def test_un_petit_incrément_NE_S_ARRONDIT_PAS_À_ZÉRO():
    """⚠️ L'ARRONDI VA VERS LE HAUT, ET C'EST TOUT L'ENJEU. « +1 kg » sur un squat
    fait moins de la moitié du pas de 2,5. Arrondi au plus proche, l'incrément
    vaudrait ZÉRO : la charge ne bougerait plus jamais, et le coach chercherait
    longtemps pourquoi sa progression est à l'arrêt.

    Cette spec a été écrite APRÈS coup — une mutation (arrondi au plus proche) a
    survécu aux quatre cas alors présents, qui tombaient tous du bon côté par
    hasard."""
    source = semaine([seance([ligne(name="SQUAT", weight="100", increment="1")])])
    assert _lignes(semaine_suivante(bloc([source])))[0]["weight"] == "102.5"


def test_un_ACCESSOIRE_progresse_comme_les_autres():
    """⚠️ LE CONTRE-EXEMPLE DU RETRAIT DE `%`. Avant, un mouvement sans 1RM — un
    curl — ne pouvait PAS progresser en pourcentage : la charge restait celle de
    la semaine passée, en silence (c'était l'objet de FRE-105). En kilos, la
    question ne se pose plus : il n'y a rien à résoudre, donc rien à manquer.
    Seul le pas par défaut (1,25) le distingue du squat — « +5 kg » y tombe
    juste, là où le squat l'aurait arrondi de la même façon."""
    source = semaine([seance([ligne(name="CURL BICEPS", weight="10", increment="5")])])
    assert _lignes(semaine_suivante(bloc([source])))[0]["weight"] == "15"


def test_un_increment_qui_porte_encore_l_unité_RETIRÉE_vaut_des_KILOS():
    """⚠️ ZÉRO LIGNE DE PRODUCTION EST DANS CE CAS — mesuré sur les 17 227 des
    trois tables avant le retrait, unité comme suffixe hérité « 5% ». La spec
    fixe malgré tout ce qui arrive à une telle ligne, parce que le silence est le
    seul mauvais choix : `%` n'est plus une branche, la valeur retombe donc dans
    le cas général et vaut des kilos. Elle ne disparaît pas.

    Le suffixe, lui, n'est plus un nombre : « 5% » ne progresse rien du tout,
    exactement comme « beaucoup »."""
    unite = semaine([seance([ligne(name="SQUAT", weight="100",
                                   increment="5", incrementUnit="%")])])
    assert _lignes(semaine_suivante(bloc([unite])))[0]["weight"] == "105"

    suffixe = semaine([seance([ligne(name="SQUAT", weight="100", increment="5%")])])
    assert _lignes(semaine_suivante(bloc([suffixe])))[0]["weight"] == "100"


def test_le_pas_de_charge_du_coach_l_emporte():
    assert granularite("SQUAT", {"SQUAT": "5"}) == 5
    assert granularite("SQUAT", {}) == 2.5
    assert granularite("CURL", {}) == 1.25
    # Un réglage absurde ne remplace pas le défaut : il est ignoré.
    assert granularite("SQUAT", {"SQUAT": "0"}) == 2.5


def test_une_charge_qui_n_est_PAS_un_nombre_ne_bouge_pas():
    """« PDC » est une charge parfaitement légitime — poids de corps."""
    source = semaine([seance([ligne(name="DIPS", weight="PDC", increment="2.5")])])
    assert _lignes(semaine_suivante(bloc([source])))[0]["weight"] == "PDC"


def test_resoudre_increment_rend_None_quand_il_n_y_a_rien_à_résoudre():
    assert resoudre_increment(ligne()) is None
    assert resoudre_increment(ligne(increment="beaucoup")) is None


# --------------------------------------------------------------------------- #
# LA ROUTE
# --------------------------------------------------------------------------- #


@pytest.fixture
def monde(pg):
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name, current_one_rm) VALUES "
        "('11111111-1111-1111-1111-111111111111','coach-1','A','{\"squat\": 200}')"))
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
        "('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    macro = pg.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number, name) "
        "VALUES ('p1','m1',1,'M1') RETURNING id")).scalar()
    # Les dates de S1 dans la BASE : `next-week` les exige (FRE-138).
    b = pg.execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number, name, s1_start_date, s1_end_date) "
        "VALUES (:m,'b1',1,'B1','2026-03-02','2026-03-08') RETURNING id"), {"m": macro}).scalar()
    w = pg.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number, name, hidden, end_date) "
        "VALUES (:b,'w1',1,'',false,'2026-03-08') RETURNING id"), {"b": b}).scalar()
    s = pg.execute(text(
        "INSERT INTO training_sessions (week_id, legacy_id, position, name, form_of_the_day) "
        "VALUES (:w,'s1',0,'Lundi',4) RETURNING id"), {"w": w}).scalar()
    source = pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, weight, "
        "increment, increment_unit, reps_done, felt_rpe) "
        # ⚠️ LE 1RM DE L'ATHLÈTE VAUT 200 ET NE DOIT RIEN CHANGER : sous l'ancien
        # mode `%`, « 4 » aurait donné 8 kg (arrondis à 10) et la charge 110. En
        # kilos, elle vaut 105. Le contre-exemple est dans les chiffres.
        "VALUES (:s,0,'SQUAT','100','4','kg','8','9') RETURNING id"), {"s": s}).scalar()
    return {"pg": pg, "bloc": str(b), "ligne_source": str(source)}


def _client(uid: str = "coach-1") -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def test_la_route_écrit_la_semaine_et_la_rend(monde):
    """L'incrément de 4 kg du squat, arrondi à son pas (2,5) → 5."""
    r = _client().post(f"/programs/p1/blocks/{monde['bloc']}/next-week", headers=_AUTH)
    assert r.status_code == 201, r.text[:300]
    semaine_lue = r.json()

    assert semaine_lue["weekNumber"] == 2
    assert semaine_lue["startDate"] == "2026-03-09"
    ligne_lue = semaine_lue["sessions"][0]["exercises"][0]
    assert ligne_lue["weight"] == "105"
    # Le réalisé de la semaine passée ne traverse pas.
    assert (ligne_lue["repsDone"], ligne_lue["feltRPE"]) == (None, None)
    # Et l'identité est NEUVE — celle du serveur, pas celle de la source.
    assert ligne_lue["id"] != monde["ligne_source"]


def test_un_bloc_SANS_semaine_rend_une_séance_avec_une_ligne_VIDE(monde):
    """⚠️ LA LIGNE VIDE DOIT EXISTER CÔTÉ SERVEUR, sans quoi la première frappe du
    coach se perd jusqu'au rechargement — elle n'a pas d'identité à patcher
    (FRE-44). Or le chargement en masse ÉCARTE les lignes sans nom : il faut donc
    l'insérer explicitement, ce que le front faisait par un `POST` après coup.

    C'est le seul endroit du domaine où l'on crée délibérément une ligne que la
    règle générale refuse."""
    vide = monde["pg"].execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number, name, s1_start_date, s1_end_date) "
        "SELECT macro_id, 'b2', 2, 'B2', '2026-03-09', '2026-03-15' FROM training_blocks "
        "WHERE id = CAST(:b AS uuid) RETURNING id"), {"b": monde["bloc"]}).scalar()

    r = _client().post(f"/programs/p1/blocks/{vide}/next-week", headers=_AUTH)
    assert r.status_code == 201, r.text[:300]
    seances = r.json()["sessions"]
    assert len(seances) == 1 and len(seances[0]["exercises"]) == 1
    assert seances[0]["exercises"][0]["name"] is None


def test_read_block_rend_le_MEME_bloc_que_l_arbre_entier(monde):
    """« + Semaine » relit le bloc par `read_block`, borné au bloc, et non plus
    par `read_tree` (FRE-222). Même projection, au champ près : un champ qui
    n'arriverait que d'un côté ferait diverger la semaine rendue de celle que
    le front relit en rechargeant l'arbre.

    MUTATION QUI ROUGIT : borner `_SEANCES_DU_BLOC` à une autre clé, ou omettre
    les objectifs dans `read_block`."""
    from app.entrainement.training_tree import read_block, read_tree
    pg, bloc = monde["pg"], monde["bloc"]
    attendu = next(b for m in read_tree(pg, "p1")["macros"] for b in m["blocks"] if b["id"] == bloc)
    assert read_block(pg, "p1", bloc) == attendu
    assert attendu["weeks"] and attendu["weeks"][0]["sessions"], "le décor doit porter du contenu"
    assert read_block(pg, "p1", "00000000-0000-0000-0000-000000000000") is None


def test_la_S1_d_un_bloc_VIDE_prend_les_dates_de_la_BASE(monde):
    """⚠️ C'EST PAR CE CHEMIN QUE LE STOCK SE RECONSTITUAIT (FRE-138). Sur un bloc
    neuf — qui n'a plus de S1 depuis la règle « bloc sans semaine » —, « + Semaine »
    créait une S1 NUE, même quand la BASE portait ses dates.
    MUTATION QUI ROUGIT : garder `startDate: None` pour un bloc vide."""
    vide = monde["pg"].execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number, name, s1_start_date, s1_end_date) "
        "SELECT macro_id, 'b3', 3, 'B3', '2026-04-06', '2026-04-12' FROM training_blocks "
        "WHERE id = CAST(:b AS uuid) RETURNING id"), {"b": monde["bloc"]}).scalar()

    r = _client().post(f"/programs/p1/blocks/{vide}/next-week", headers=_AUTH)
    assert r.status_code == 201, r.text[:300]
    assert (r.json()["startDate"], r.json()["endDate"]) == ("2026-04-06", "2026-04-12")


@pytest.mark.parametrize("debut,fin", [(None, None), ("2026-04-06", None)])
def test_sans_les_DEUX_dates_de_S1_la_route_refuse_et_n_écrit_rien(monde, debut, fin):
    """« + Semaine » contournait le refus de la génération (FRE-138) : 4 149 lignes
    réalisées sans date le 15/09, contre 3 377 le 06/09. Même garde, même code, et
    AVANT toute écriture. Le début seul est le cas réel (quatre blocs de
    production), d'où le second jeu.
    MUTATION QUI ROUGIT : retirer `_exiger_les_dates_de_s1` de `create_next_week`."""
    pg = monde["pg"]
    pg.execute(text("UPDATE training_blocks SET s1_start_date = :d, s1_end_date = :f "
                    "WHERE id = CAST(:b AS uuid)"), {"d": debut, "f": fin, "b": monde["bloc"]})
    avant = pg.execute(text("SELECT count(*) FROM training_weeks")).scalar()

    r = _client().post(f"/programs/p1/blocks/{monde['bloc']}/next-week", headers=_AUTH)
    assert r.status_code == 409
    assert r.json()["code"] == "base_sans_dates"
    assert pg.execute(text("SELECT count(*) FROM training_weeks")).scalar() == avant


def test_la_route_est_fermée_à_un_coach_étranger(monde):
    monde["pg"].execute(text("INSERT INTO users (uid, email) VALUES ('coach-2','b@x.fr')"))
    monde["pg"].execute(text("INSERT INTO coaches (uid) VALUES ('coach-2')"))
    r = _client("coach-2").post(f"/programs/p1/blocks/{monde['bloc']}/next-week", headers=_AUTH)
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# L'INCRÉMENT SE RELIT DANS LA TRAME (FRE-150) ET PART DU RÉALISÉ (FRE-161)
#
# Deux décisions de William, 09/09 :
#   · « la BASE devient dynamique : les incréments sont lus depuis la BASE pour
#     générer la semaine N+1 » ;
#   · « les incréments de kg, reps et séries se font sur le réalisé ; celui de
#     RPE sur le RPE prescrit ».
# --------------------------------------------------------------------------- #

def _base_avec(ligne_de_trame):
    return base_vide(principles=[ligne_de_trame])


def test_l_incrément_ABSENT_de_la_ligne_est_lu_dans_la_TRAME():
    """⚠️ LE DÉFAUT DU SIGNALEMENT (FRE-150) : « son dips du mardi ne s'incrémente
    pas, alors que l'incrément existe ». Il existait — dans la BASE. La ligne de
    semaine, née avant qu'il n'y soit posé, ne l'a jamais reçu : l'incrément
    n'était lu qu'UNE fois, à la naissance de la S1, puis recopié de semaine en
    semaine. Corriger la trame ne redescendait pas, et rien ne le disait.

    Sans incrément, la charge est EFFACÉE la semaine suivante — d'où S1 @50,
    S2 @55 tapé à la main, S3 sans aucune charge."""
    trame = ligne(name="DIPS", sets="3", reps="5", increment="2.5", incrementUnit="kg")
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="DIPS", sets="3", reps="5", weight="50")])])],
        base=_base_avec(trame)))
    assert _lignes(sortie)[0]["weight"] == "52.5"


def test_la_TRAME_l_emporte_sur_l_incrément_hérité_par_la_ligne():
    """Corriger la trame doit redescendre — c'est tout l'objet de la décision.
    L'incrément d'une ligne de semaine n'est écrivable nulle part, donc une
    divergence ne peut pas être un ajustement délibéré : c'est de l'historique."""
    trame = ligne(name="SQUAT", sets="3", reps="5", increment="5", incrementUnit="kg")
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="SQUAT", sets="3", reps="5", weight="100",
                                increment="2.5", incrementUnit="kg")])])],
        base=_base_avec(trame)))
    assert _lignes(sortie)[0]["weight"] == "105"


def test_une_ligne_SANS_contrepartie_dans_la_trame_garde_le_sien():
    """⚠️ LE REPLI QUI ÉVITE L'INCIDENT. 17 % des lignes de production n'ont
    aucune ligne de trame correspondante — ajoutées à la main dans la semaine.
    Les priver d'incrément effacerait leur charge."""
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="AJOUTÉ À LA MAIN", weight="60",
                                increment="2.5", incrementUnit="kg")])])],
        base=_base_avec(ligne(name="AUTRE CHOSE", increment="10", incrementUnit="kg"))))
    assert _lignes(sortie)[0]["weight"] == "62.5"


def test_la_charge_part_du_RÉALISÉ_quand_il_existe():
    """⚠️ 159 lignes de production ont été tenues PLUS LOURD que prescrit. Partir
    de la consigne perdait ce travail à chaque semaine générée."""
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="SQUAT", weight="127.5", weightDone="130",
                                increment="2.5", incrementUnit="kg")])])]))
    assert _lignes(sortie)[0]["weight"] == "132.5"


def test_la_charge_part_du_RÉALISÉ_même_quand_il_est_PLUS_LÉGER():
    """⚠️ ET DANS LES DEUX SENS, c'est le point. 24 lignes ont été allégées : ne
    remonter que vers le haut refuserait l'autorégulation dans le seul sens où
    elle protège l'athlète."""
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="SQUAT", weight="130", weightDone="120",
                                increment="2.5", incrementUnit="kg")])])]))
    assert _lignes(sortie)[0]["weight"] == "122.5"


def test_sans_réalisé_la_charge_part_du_PRESCRIT():
    """Le repli, et le cas le plus fréquent : 9 520 lignes sur 9 974 n'ont aucune
    charge réelle."""
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="SQUAT", weight="100",
                                increment="5", incrementUnit="kg")])])]))
    assert _lignes(sortie)[0]["weight"] == "105"


def test_les_répétitions_partent_du_RÉALISÉ():
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="EXO", reps="8", repsDone="10",
                                increment="1", incrementUnit="reps")])])]))
    assert _lignes(sortie)[0]["reps"] == "11"


def test_les_SÉRIES_partent_des_séries_TENUES():
    """4 prescrites, une échouée : la semaine suivante repart de 3, pas de 4.
    Le FAIL se lit position par position (FRE-110)."""
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="EXO", sets="4",
                                feltRPEBySet=["8", "8", "9", "FAIL"],
                                increment="1", incrementUnit="sets")])])]))
    assert _lignes(sortie)[0]["sets"] == "4"


def test_les_séries_ignorent_un_détail_INCOMPLET():
    """⚠️ UNE SAISIE À MOITIÉ REMPLIE N'EST PAS UN ENTRAÎNEMENT ÉCOURTÉ. Quatre
    séries prescrites, deux ressentis notés : descendre l'athlète de 4 à 3 pour
    un oubli de case, en silence, serait pire que le défaut d'origine. C'est le
    repère « 2/4 » de l'écran (FRE-156) qui traite ce cas."""
    # ⚠️ UN FAIL PARMI LES CASES NOTÉES, à dessein : sans la garde, le compte des
    # séries tenues vaudrait 3 et la ligne descendrait à 4 au lieu de rester à 5.
    # Avec des cases seulement vides, les deux chemins donnent le même chiffre —
    # la spec passerait au vert sans rien prouver.
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="EXO", sets="4", feltRPEBySet=["8", "FAIL", "", ""],
                                increment="1", incrementUnit="sets")])])]))
    assert _lignes(sortie)[0]["sets"] == "5"


def test_le_RPE_part_de_la_CONSIGNE_et_JAMAIS_du_ressenti():
    """⚠️ LE SEUL QUI NE SUIT PAS LE RÉALISÉ, et c'est délibéré (William, 09/09).
    Le ressenti n'est pas un plan : partir de lui prescrirait 9,5 à qui a
    ressenti 9 sur un 8 demandé — punir un jour difficile."""
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="EXO", aimedRPE="8", feltRPE="9",
                                feltRPEBySet=["9", "9"],
                                increment="0.5", incrementUnit="rpe")])])]))
    assert _lignes(sortie)[0]["aimedRPE"] == "8.5", (
        "9.5 voudrait dire que le ressenti a servi de plan")
    # ⚠️ ET LE RESSENTI NE SURVIT PAS À LA COPIE, ce qui est la seconde moitié :
    # c'est ce qui rend l'erreur difficile à commettre par accident, et facile à
    # commettre en allant chercher la valeur AVANT l'effacement, comme le fait la
    # charge deux lignes plus haut.
    assert _lignes(sortie)[0]["feltRPE"] is None
    assert _lignes(sortie)[0]["feltRPEBySet"] == []


def test_la_charge_par_SÉRIE_part_de_la_MOYENNE_affichée():
    """⚠️ LE CHOIX DE WILLIAM, 09/09 : « on peut partir sur la moyenne, puisque
    c'est ça qui est affiché ». `weightDone` est la moyenne que le serveur dérive
    du détail, et c'est elle que l'écran présente comme charge réelle de la ligne
    (« moy. 130 ») — le coach voit donc d'où part la semaine suivante.

    Le top set aurait fait 105 + 2,5 = 107,5 : plus vite, et sur un pic plutôt
    que sur la séance."""
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="SQUAT", weight="100",
                                weightDone="102.5",
                                weightDoneBySet=["100", "102.5", "105"],
                                increment="2.5", incrementUnit="kg")])])]))
    assert _lignes(sortie)[0]["weight"] == "105"


@pytest.mark.parametrize(("champs", "charge_attendue"), [
    (dict(), None),
    (dict(increment="0.5", incrementUnit="rpe"), None),
    (dict(increment="0.5", incrementUnit="rpe", weightLocked=True), "100"),
    (dict(sets="3", increment="1", incrementUnit="sets"), "100"),
    (dict(reps="5", increment="1", incrementUnit="reps"), "100"),
    (dict(increment="2.5", incrementUnit="kg"), "102.5"),
], ids=["sans_increment", "rpe", "rpe_verrouillee", "sets", "reps", "kg"])
def test_la_CHARGE_ne_survit_que_si_quelque_chose_la_PORTE(champs, charge_attendue):
    """⚠️ Sous un incrément de RPE la charge S'EFFACE, comme sans incrément : la
    semaine progresse par le ressenti visé, et une charge recopiée dirait deux
    consignes. Sous `sets`, `reps` ou une charge, elle reste. Le verrou l'emporte.

    C'est la règle de l'ancien front (`buildNextWeek`), portée telle quelle ; un
    commentaire a dit l'inverse pour `rpe` sans qu'aucune spec le contredise
    (FRE-184)."""
    sortie = semaine_suivante(bloc(
        [semaine([seance([ligne(name="EXO", weight="100", aimedRPE="8", **champs)])])]))
    assert _lignes(sortie)[0]["weight"] == charge_attendue
