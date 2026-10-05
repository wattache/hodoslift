"""LE GUICHET DU COACH — la file de travail qui se vide (brief du 12/09).

Ce que ces specs GARDENT, et chacune a été vue rouge en fabriquant le défaut :

  1. une séance relue, puis une ligne modifiée PAR L'ATHLÈTE → elle revient ;
  2. la même séance relue, puis réordonnée PAR LE COACH → elle ne revient PAS —
     c'est `modifiee_par` qui le garantit ;
  3. un signalement coché par le kiné → il RESTE dans la file du coach — c'est
     la colonne `uid` de `signalement_vu` qui le garantit ;
  4. une pesée sur un jour dont la douleur est cochée → elle reste cochée —
     c'est `douleur_logs.modifie_le` et non un horodatage de journée ;
  5. un coach sans athlète → file vide, 200 ;
  6. le nombre de requêtes SQL de `GET /guichet` ne dépend pas du nombre
     d'athlètes — COMPTÉ, pas supposé.

⚠️ CHAQUE TEST TIENT DANS UNE TRANSACTION (fixture `pg`), et c'est pour ça que le
code écrit `clock_timestamp()` et non `now()` : `now()` est l'instant du DÉBUT
de la transaction, constant jusqu'au commit — « relue à » et « modifiée à »
auraient toujours la même valeur ici, et ces specs ne pourraient ni rougir ni
verdir pour la bonne raison. Voir `app/entrainement/relecture.py`.
"""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text

from app.socle.auth import verify_token
from app.main import app
from app.entrainement.relecture import MISE_EN_SERVICE
from tests.chargeur_arbre import Arbre, load
from tests.conftest import semer_un_membre
from tests.fixtures_training import arbre_de_test

_AUTH = {"Authorization": "Bearer x"}
A1 = "11111111-1111-1111-1111-111111111111"
LEGACY = "ath-legacy-1"


@pytest.fixture
def monde(pg):
    """Un coach, son athlète (qui a un compte), son kiné, et un arbre réalisé.

    ⚠️ LE MARQUEUR D'ÉCRITURE EST POSÉ, comme la production le pose à chaque
    trace (FRE-179) : c'est lui qui borne la file, pas la date de la semaine.
    Sans lui, rien n'entre et chaque spec passerait au vert sur du vide. Les
    dates sont ramenées à aujourd'hui pour la « séance du jour » du dossier
    douleur, qui se résout par la date de garde."""
    for uid, role in (("coach-1", "coaches"), ("autre-coach", "coaches"), ("kine-1", "kines")):
        semer_un_membre(pg, uid, role)
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('ath-1', 'ath@x.fr') ON CONFLICT DO NOTHING"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, kine_uid, first_name, last_name, user_uid) "
        "VALUES (CAST(:id AS uuid), :legacy, 'coach-1', 'kine-1', 'Léa', 'Martin', 'ath-1')"),
        {"id": A1, "legacy": LEGACY})
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) VALUES ('p1', 'coach-1', CAST(:a AS uuid))"),
               {"a": A1})
    load(pg, Arbre(macros=arbre_de_test("p1")))
    aujourd_hui = max(date.today(), MISE_EN_SERVICE)
    pg.execute(text("UPDATE training_sessions SET session_date = :d"), {"d": aujourd_hui})
    pg.execute(text("UPDATE training_weeks SET start_date = :d, end_date = :d + 6"), {"d": aujourd_hui})
    pg.execute(text("UPDATE training_sessions SET modifiee_le = clock_timestamp(), modifiee_par = 'ath-1'"))
    return pg


def _client(uid: str) -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def _guichet(uid: str) -> dict:
    r = _client(uid).get("/guichet", headers=_AUTH)
    assert r.status_code == 200, r.text
    return r.json()


def _seances(uid: str) -> list[dict]:
    return [d for d in _guichet(uid)["dossiers"] if d["type"] == "seance"]


def _douleurs(uid: str) -> list[dict]:
    return [d for d in _guichet(uid)["dossiers"] if d["type"] == "douleur"]


def _seance_id(conn) -> str:
    return str(conn.execute(text(
        "SELECT s.id FROM training_sessions s JOIN training_weeks w ON w.id = s.week_id "
        "WHERE w.legacy_id = 'sem-1' ORDER BY s.position LIMIT 1")).scalar())


def _exercice_id(conn, name: str) -> str:
    return str(conn.execute(text(
        "SELECT x.id FROM training_exercises x WHERE x.name = :n ORDER BY x.position LIMIT 1"),
        {"n": name}).scalar())


def _relire(sid: str, uid: str = "coach-1") -> None:
    r = _client(uid).post(f"/programs/p1/sessions/{sid}/relecture", headers=_AUTH)
    assert r.status_code == 200, r.text


# --------------------------------------------------------------------------- #
# Le dossier SÉANCE
# --------------------------------------------------------------------------- #

def test_une_seance_REALISEE_est_dans_la_file_avec_ses_mesures(monde):
    """La fixture porte UNE séance avec trace (un RPE ressenti sur le SQUAT).

    ⚠️ LE TONNAGE EST VÉRIFIÉ AU KILO PRÈS, et c'est le point : `ff_tonnage` a
    déménagé la formule de l'ETL. 10 000 kg est ce que l'ancienne formule inline
    rendait sur cette fixture — SQUAT 5×5×100, PULL UP 3×7×60 (le réalisé
    prime), DIPS au poids du corps (NULL, pas 0), PLANK en secondes (NULL), et
    six lignes de 3×8×60. Warmup et rehab sont hors mesure."""
    monde.execute(text("UPDATE training_exercises SET athlete_feedback = 'dur mais bien' "
                       "WHERE name = 'SQUAT' AND position = 0"))
    [d] = _seances("coach-1")
    assert d["athlete"] == {"athleteId": LEGACY, "firstName": "Léa", "lastName": "Martin", "programId": "p1"}
    assert d["sessionId"] == _seance_id(monde)
    assert d["blockName"] == "Accumulation" and d["weekNumber"] == 1
    assert d["seriesTenues"] == d["seriesTotal"] == 32
    assert d["tonnageKg"] == 10000
    assert d["rpeVise"] == 7.0
    assert d["retours"] == ["dur mais bien"]
    assert [x["name"] for x in d["exercices"]][:3] == ["SQUAT", "PULL UP", "DIPS"]
    # « semaine 1 » : la seule semaine programmée est réalisée, rien n'est écrit
    # après — c'est le dossier semaine, éprouvé plus bas.
    assert _guichet("coach-1")["comptes"] == {"douleur": 0, "seance": 1, "semaine": 1, "athletes": 1}


def test_relire_la_sort_de_la_file_et_decocher_la_ramene(monde):
    sid = _seance_id(monde)
    _relire(sid)
    assert _seances("coach-1") == []
    r = _client("coach-1").delete(f"/programs/p1/sessions/{sid}/relecture", headers=_AUTH)
    assert r.status_code == 200
    assert len(_seances("coach-1")) == 1


def test_relire_est_IDEMPOTENT_la_date_ne_bouge_pas(monde):
    """Un double-clic ne DÉPLACE pas l'horodatage : sinon une modification
    glissée entre les deux clics passerait pour relue."""
    sid = _seance_id(monde)
    _relire(sid)
    avant = monde.execute(text("SELECT relue_le FROM training_sessions WHERE id = CAST(:s AS uuid)"),
                          {"s": sid}).scalar()
    _relire(sid)
    apres = monde.execute(text("SELECT relue_le FROM training_sessions WHERE id = CAST(:s AS uuid)"),
                          {"s": sid}).scalar()
    assert avant == apres
    # Et décocher l'absent rend 200, sans rien à refuser.
    _client("coach-1").delete(f"/programs/p1/sessions/{sid}/relecture", headers=_AUTH)
    r = _client("coach-1").delete(f"/programs/p1/sessions/{sid}/relecture", headers=_AUTH)
    assert r.status_code == 200


def test_MODIFIEE_PAR_L_ATHLETE_apres_relecture_elle_revient(monde):
    """Critère 2. MUTATION QUI ROUGIT : retirer `marquer_modifiee` du PATCH."""
    sid = _seance_id(monde)
    _relire(sid)
    assert _seances("coach-1") == []
    eid = _exercice_id(monde, "DIPS")
    r = _client("ath-1").patch(f"/programs/p1/exercises/{eid}", json={"feltRPE": "9"}, headers=_AUTH)
    assert r.status_code == 200, r.text
    assert len(_seances("coach-1")) == 1


def test_REORDONNEE_PAR_LE_COACH_qui_l_a_relue_elle_ne_revient_PAS(monde):
    """Critère 3 — le geste-piège du guichet. MUTATION QUI ROUGIT : retirer
    `AND s.modifiee_par IS DISTINCT FROM s.relue_par` de `A_RELIRE_SQL`."""
    sid = _seance_id(monde)
    _relire(sid)
    ids = [str(r[0]) for r in monde.execute(text(
        "SELECT id FROM training_exercises WHERE session_id = CAST(:s AS uuid) ORDER BY position"),
        {"s": sid}).all()]
    ids.reverse()
    r = _client("coach-1").put(f"/programs/p1/sessions/{sid}/exercises/order",
                               json={"exerciseIds": ids}, headers=_AUTH)
    assert r.status_code == 200, r.text
    assert _seances("coach-1") == []


def test_l_historique_SANS_AUTEUR_revient_quand_meme(monde):
    """⚠️ `IS DISTINCT FROM` ET NON `<>`. Les séances d'avant la migration ont
    `modifiee_par = NULL` ; avec `<>`, `NULL <> 'coach-1'` vaut NULL, donc faux,
    et une telle séance ne reviendrait JAMAIS. On la fabrique en SQL — aucune
    route ne peut écrire un auteur nul, c'est précisément l'historique."""
    sid = _seance_id(monde)
    _relire(sid)
    monde.execute(text(
        "UPDATE training_sessions SET modifiee_le = clock_timestamp(), modifiee_par = NULL "
        "WHERE id = CAST(:s AS uuid)"), {"s": sid})
    assert len(_seances("coach-1")) == 1


def test_la_borne_de_mise_en_service_est_le_MARQUEUR(monde):
    """Une trace écrite avant la borne n'entre pas — même réalisée, même non
    relue, même datée d'aujourd'hui. L'historique sans marqueur non plus."""
    monde.execute(text("UPDATE training_sessions SET modifiee_le = :d"),
                  {"d": MISE_EN_SERVICE - timedelta(days=1)})
    assert _seances("coach-1") == []
    monde.execute(text("UPDATE training_sessions SET modifiee_le = NULL, modifiee_par = NULL"))
    assert _seances("coach-1") == []


def test_la_DATE_de_la_semaine_ne_borne_rien(monde):
    """FRE-179, critères 1 et 2 — LE DÉFAUT VU EN PROD LE 13/09 : trois athlètes
    avaient tout tracé, aucun dossier. `session_date` est NULL sur toute la
    semaine en cours, le repli était le lundi de la semaine, AVANT la borne.

    Une semaine datée d'avant la borne, sans date, ou dans le futur (préparée
    d'avance et déjà faite : on n'attend pas lundi pour la séance de lundi)
    entre dans la file dès que le marqueur est postérieur à la borne.
    MUTATION QUI ROUGIT : remettre `coalesce(session_date, start_date) >= :depuis`
    ou `<= current_date` dans `_SEANCES_SQL`."""
    veille = MISE_EN_SERVICE - timedelta(days=1)
    monde.execute(text("UPDATE training_sessions SET session_date = NULL"))
    monde.execute(text("UPDATE training_weeks SET start_date = :d, end_date = :d + 6"), {"d": veille})
    assert len(_seances("coach-1")) == 1
    monde.execute(text("UPDATE training_weeks SET start_date = NULL, end_date = NULL"))
    [d] = _seances("coach-1")
    assert d["date"] is None
    monde.execute(text("UPDATE training_sessions SET session_date = current_date + 7"))
    assert len(_seances("coach-1")) == 1


def test_le_kine_du_programme_voit_la_meme_file_de_seances(monde):
    """`_coach` inclut le kiné (`authz._MODES`) : la file suit la même règle."""
    assert len(_seances("kine-1")) == 1


# --------------------------------------------------------------------------- #
# Le dossier DOULEUR
# --------------------------------------------------------------------------- #

def _signaler(jour: date, intensite: int = 6, zone: str = "knees:droite") -> None:
    """Note une douleur un jour donné, PAR LES ROUTES (FRE-195).

    ⚠️ LA DOULEUR SE DÉCLARE UNE FOIS, PUIS SE NOTE. C'est tout le modèle : un
    signalement n'est plus un bloc de texte posé sur une journée, mais un relevé
    rattaché à quelque chose qui dure.

    ⚠️ ON LA RELIT PLUTÔT QUE DE LA MÉMORISER. Un cache de module survivrait aux
    transactions annulées entre deux specs, et le second test noterait un
    identifiant qui n'existe plus — un 404 qui n'apprend rien sur le produit."""
    existantes = _client("ath-1").get(f"/athletes/{LEGACY}/douleurs", headers=_AUTH).json()
    trouvee = next((d["id"] for d in existantes if d["zone"] == zone and not d["fin"]), None)
    if trouvee is None:
        r = _client("ath-1").post(f"/athletes/{LEGACY}/douleurs",
                                  json={"nom": f"Douleur {zone}", "zone": zone}, headers=_AUTH)
        assert r.status_code == 201, r.text
        trouvee = r.json()["id"]
    r = _client("ath-1").put(
        f"/athletes/{LEGACY}/douleurs/{trouvee}/logs/{jour.isoformat()}",
        json={"intensite": intensite}, headers=_AUTH)
    assert r.status_code == 200, r.text


def _vu(jour: date, uid: str, methode: str = "post") -> int:
    return getattr(_client(uid), methode)(
        f"/athletes/{LEGACY}/signalements/{jour.isoformat()}/vu", headers=_AUTH).status_code


def test_un_signalement_COCHE_PAR_LE_KINE_reste_dans_la_file_du_coach(monde):
    """Critère 4. MUTATION QUI ROUGIT : retirer `AND v.uid = :uid` de la jointure
    — la coche de n'importe qui vaudrait pour tout le monde."""
    jour = date.today()
    _signaler(jour)
    assert len(_douleurs("kine-1")) == 1 and len(_douleurs("coach-1")) == 1
    assert _vu(jour, "kine-1") == 200
    assert _douleurs("kine-1") == []
    assert len(_douleurs("coach-1")) == 1
    # Et le dossier vient EN TÊTE, avant les séances.
    assert _guichet("coach-1")["dossiers"][0]["type"] == "douleur"


def test_une_PESEE_ne_decoche_pas_la_douleur(monde):
    """Critère 5, et la règle est devenue STRUCTURELLE (FRE-195).

    ⚠️ ELLE TENAIT À UN `CASE` ET TIENT DÉSORMAIS AU MODÈLE. Le signalement
    vivait dans la même ligne que le poids : il fallait horodater l'OBJET `kine`
    et non la ligne, sans quoi se peser décochait la douleur de la file du staff.
    Les deux vivent maintenant dans deux tables — la pesée ne peut plus toucher
    au relevé de douleur, et il n'y a plus rien à oublier.

    La spec reste, parce que la règle reste vraie et qu'un futur modèle pourrait
    la reperdre : ce qu'elle garde, c'est le COMPORTEMENT, pas son mécanisme."""
    jour = date.today()
    _signaler(jour)
    assert _vu(jour, "coach-1") == 200
    assert _douleurs("coach-1") == []
    # Une pesée sur le même jour : une autre table, un autre fait.
    r = _client("ath-1").patch(f"/athletes/{LEGACY}/daily-logs/{jour.isoformat()}",
                               json={"weight": 71.5}, headers=_AUTH)
    assert r.status_code == 200, r.text
    assert _douleurs("coach-1") == []
    # ⚠️ MAIS CORRIGER SA NOTE RAPPELLE LE STAFF, et c'est le cœur du guichet :
    # « noté après coché » doit revenir. L'upsert du jour rafraîchit
    # `created_at`, que la requête compare à l'instant de la coche.
    _signaler(jour, intensite=9)
    assert len(_douleurs("coach-1")) == 1


def test_le_dossier_douleur_porte_la_SEANCE_DU_JOUR(monde):
    """Une jointure, pas un appel de plus — résolue par la date de garde."""
    jour = max(date.today(), MISE_EN_SERVICE)
    _signaler(jour)
    [d] = _douleurs("coach-1")
    assert d["seanceDuJour"] == {"sessionId": _seance_id(monde), "programId": "p1",
                                 "weekId": d["seanceDuJour"]["weekId"], "name": "Lundi — Bas"}
    # ⚠️ LA LISTE, PAS UN BLOC LIBRE : un athlète peut noter deux douleurs le
    # même jour, et la coche porte le jour.
    assert [x["zone"] for x in d["douleurs"]] == ["knees:droite"]
    assert d["douleurs"][0]["intensite"] == 6


def test_cocher_un_jour_SANS_signalement_est_introuvable(monde):
    jour = date.today()
    _client("ath-1").patch(f"/athletes/{LEGACY}/daily-logs/{jour.isoformat()}",
                           json={"weight": 70}, headers=_AUTH)
    r = _client("coach-1").post(f"/athletes/{LEGACY}/signalements/{jour.isoformat()}/vu", headers=_AUTH)
    assert r.status_code == 404
    assert r.json()["code"] == "signalement_introuvable"
    # Décocher l'absent, lui, rend 200.
    assert _vu(jour, "coach-1", "delete") == 200


def test_seul_un_LECTEUR_du_signalement_peut_le_cocher(monde):
    """Le lien, pas le rôle : un coach en règle qui ne staffe pas cet athlète."""
    jour = date.today()
    _signaler(jour)
    assert _vu(jour, "autre-coach") == 403


# --------------------------------------------------------------------------- #
# Le dossier SEMAINE
# --------------------------------------------------------------------------- #

def _semaines(uid: str = "coach-1") -> list[dict]:
    return [d for d in _guichet(uid)["dossiers"] if d["type"] == "semaine"]


def _seance_neuve(conn, semaine: str, name: str = "Jeudi") -> str:
    """Une séance SANS aucune trace, dans la semaine `semaine` (legacy_id)."""
    return str(conn.execute(text(
        "INSERT INTO training_sessions (week_id, legacy_id, position, name) "
        "SELECT id, :l, 9, :n FROM training_weeks WHERE legacy_id = :w RETURNING id"),
        {"l": f"neuve-{semaine}-{name}", "n": name, "w": semaine}).scalar())


def test_la_derniere_semaine_REALISEE_sans_suite_est_a_ecrire(monde):
    """FRE-179 — LE DOSSIER S'OBTIENT PAR LE VRAI CHEMIN : la fixture porte une
    semaine dont chaque séance a une trace, et rien n'est écrit après. Aucune
    semaine vide n'est fabriquée, aucune date n'est posée : la S2 « Décharge »
    de la fixture est un coquille sans séance, elle n'y est pour rien.

    La semaine portée est la RÉALISÉE (on la prolonge), le numéro celui à écrire."""
    [d] = _semaines()
    assert d["weekNumber"] == 2 and d["blockName"] == "Accumulation"
    assert d["weekId"] == str(monde.execute(text(
        "SELECT id FROM training_weeks WHERE legacy_id = 'sem-1'")).scalar())
    # Rien d'autre : ni date, ni aperçu du bloc — « la semaine manque » suffit.
    assert set(d) == {"type", "athlete", "programId", "blockId", "weekId", "weekNumber", "blockName"}


def test_une_seule_seance_SANS_TRACE_et_la_semaine_n_est_pas_realisee(monde):
    """Critère 3 : « réalisée » = CHAQUE séance porte au moins UNE ligne tracée.
    Une seule ligne suffit (on oublie les renfos) ; une séance sans rien, non.
    MUTATION QUI ROUGIT : remplacer `tracees = sessions` par `tracees > 0`."""
    sid = _seance_neuve(monde, "sem-1")
    assert _semaines() == []
    monde.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, sets, reps, felt_rpe) "
        "VALUES (CAST(:s AS uuid), 0, 'ROWING', '3', '10', '7')"), {"s": sid})
    assert len(_semaines()) == 1


def test_le_dossier_se_ferme_quand_une_semaine_PLUS_LOIN_recoit_une_seance(monde):
    """Pas de coche : la sortie est un fait. Et « plus loin » se lit dans le
    PROGRAMME — la semaine suivante du bloc, ou la première du bloc d'après."""
    _seance_neuve(monde, "sem-2", "Lundi")
    assert _semaines() == []
    monde.execute(text("DELETE FROM training_sessions WHERE legacy_id = 'neuve-sem-2-Lundi'"))
    assert len(_semaines()) == 1
    # Le bloc 2 reçoit sa S1 : la dernière programmée n'est plus la S1 du bloc 1.
    monde.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number) "
        "SELECT id, 'b2-s1', 1 FROM training_blocks WHERE legacy_id = 'bloc-2'"))
    _seance_neuve(monde, "b2-s1", "Lundi")
    assert _semaines() == []


def test_les_DATES_de_la_semaine_ne_decident_pas(monde):
    """FRE-179 : ni « finie » par la date, ni « pas encore » par la date. Une
    semaine réalisée datée dans le futur, ou sans date, est à prolonger.
    MUTATION QUI ROUGIT : remettre `end_date < current_date` dans `_SEMAINES_SQL`."""
    monde.execute(text("UPDATE training_weeks SET start_date = current_date + 7, end_date = current_date + 13"))
    assert len(_semaines()) == 1
    monde.execute(text("UPDATE training_weeks SET start_date = NULL, end_date = NULL"))
    assert len(_semaines()) == 1


def test_la_plus_recemment_ECRITE_d_abord_l_historique_au_fond(monde):
    """Le tri : l'athlète qui vient de finir s'entraîne demain ; celui dont la
    semaine n'a pas de marqueur (l'historique, un dormant) descend au fond."""
    monde.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name) VALUES "
        "(CAST('22222222-2222-2222-2222-222222222222' AS uuid), 'ath-2', 'coach-1', 'Zoé', 'Dormante')"))
    monde.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                       "VALUES ('p2', 'coach-1', CAST('22222222-2222-2222-2222-222222222222' AS uuid))"))
    load(monde, Arbre(macros=arbre_de_test("p2")))
    # Le marqueur de la fixture ne couvre que p1 : p2 est de l'historique.
    assert [d["athlete"]["firstName"] for d in _semaines()] == ["Léa", "Zoé"]
    # Zoé trace une ligne maintenant : elle passe devant.
    monde.execute(text(
        "UPDATE training_sessions SET modifiee_le = clock_timestamp() WHERE week_id IN "
        "(SELECT w.id FROM training_weeks w JOIN training_blocks b ON b.id = w.block_id "
        " JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = 'p2')"))
    assert [d["athlete"]["firstName"] for d in _semaines()] == ["Zoé", "Léa"]


# --------------------------------------------------------------------------- #
# La file, dans son ensemble
# --------------------------------------------------------------------------- #

def test_un_coach_SANS_ATHLETE_recoit_une_file_vide(monde):
    """Critère 10 : 200, pas 500, pas 403."""
    assert _guichet("autre-coach") == {"dossiers": [],
                                       "comptes": {"douleur": 0, "seance": 0, "semaine": 0, "athletes": 0}}


def test_les_athletes_a_jour_sont_les_SIENS_hors_archives(monde):
    """« 67 athlètes à jour » pour un coach qui en a 3 : le front lisait
    l'annuaire entier. Le compte se fait ici, par le lien, et sans les archivés."""
    monde.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name, archive_le) VALUES "
        "(CAST('22222222-2222-2222-2222-222222222222' AS uuid), 'ath-2', 'coach-1', 'A', '2', NULL), "
        "(CAST('22222222-2222-2222-2222-222222222223' AS uuid), 'ath-3', 'coach-1', 'A', '3', clock_timestamp()), "
        "(CAST('22222222-2222-2222-2222-222222222224' AS uuid), 'ath-4', 'autre-coach', 'A', '4', NULL)"))
    assert _guichet("coach-1")["comptes"]["athletes"] == 2
    assert _guichet("kine-1")["comptes"]["athletes"] == 1
    assert _guichet("autre-coach")["comptes"]["athletes"] == 1


def test_le_nombre_de_requetes_ne_depend_pas_du_nombre_d_athletes(monde):
    """Critère 1 et point 6 du brief : COMPTÉ, pas supposé.

    Quatre requêtes — une par type de dossier, plus le compte des athlètes — que
    l'athlète soit seul ou qu'ils soient quatre. Un `N+1` glissé dans la route
    ferait grimper le second compte."""
    requetes: list[str] = []

    def _noter(conn, cur, stmt, *a):
        # Les LECTURES seules : la session pose un SAVEPOINT et le relâche autour
        # de chaque requête HTTP, et ce n'est pas ce qu'on compte.
        if stmt.lstrip().upper().startswith(("SELECT", "WITH")):
            requetes.append(stmt)

    event.listen(monde, "before_cursor_execute", _noter)
    try:
        _guichet("coach-1")
        avec_un = len(requetes)
        for n in (2, 3, 4):
            aid = f"22222222-2222-2222-2222-22222222222{n}"
            monde.execute(text(
                "INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name) "
                "VALUES (CAST(:id AS uuid), :legacy, 'coach-1', 'A', :n)"),
                {"id": aid, "legacy": f"ath-{n}", "n": str(n)})
            monde.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                               "VALUES (:p, 'coach-1', CAST(:a AS uuid))"), {"p": f"p{n}", "a": aid})
            load(monde, Arbre(macros=arbre_de_test(f"p{n}")))
        monde.execute(text("UPDATE training_sessions SET modifiee_le = clock_timestamp()"))
        requetes.clear()
        assert len(_seances("coach-1")) == 4
        avec_quatre = len(requetes)
    finally:
        event.remove(monde, "before_cursor_execute", _noter)
    assert avec_un == avec_quatre == 4, (avec_un, avec_quatre)
