"""Écriture au grain de la ligne (FRE-12) — contre un VRAI Postgres.

Ce que ces tests cherchent à prouver, dans l'ordre d'importance :

  1. qu'un exercice d'un AUTRE programme est inatteignable, même avec un
     `program_id` légitime dans l'URL. C'est le seul défaut de cette étape qui
     serait une fuite de données, pas un bug d'affichage ;
  2. qu'un refus de validation ne coûte QUE la ligne visée — la raison d'être de
     tout le chantier ;
  3. que la suppression tient les invariants (positions sans trou, groupe réduit
     à un membre nettoyé), sans quoi on recrée en base le désordre qu'on vient de
     nettoyer côté front.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app
from tests.chargeur_arbre import Arbre, load
from tests.fixtures_training import arbre_de_test


@pytest.fixture
def monde(pg):
    """Deux programmes, deux coachs. Le second existe pour une seule raison :
    vérifier qu'on ne peut pas l'atteindre depuis le premier."""
    # `athlete-1` a SA ligne users : `athletes.user_uid` la référence. C'est la
    # FK qu'un stub SQLite ne portait pas, et qui n'apparaît que sur un vrai PG.
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1','a@x.fr'), ('coach-2','b@x.fr'), ('athlete-1','c@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1'), ('coach-2')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name, last_name, user_uid) VALUES "
        "('11111111-1111-1111-1111-111111111111','coach-1','A','Un','athlete-1'),"
        "('22222222-2222-2222-2222-222222222222','coach-2','B','Deux',NULL)"))
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
        "('prog-1','coach-1','11111111-1111-1111-1111-111111111111'),"
        "('prog-2','coach-2','22222222-2222-2222-2222-222222222222')"))
    load(pg, Arbre(macros=arbre_de_test("prog-1")))
    load(pg, Arbre(macros=arbre_de_test("prog-2")))
    # Les routes ouvrent leur propre session : on les fait tomber sur CELLE du
    # test, dont la transaction sera annulée à la fin.
    return pg


def _client(uid: str) -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def _un_exercice(conn, program_id: str, nom: str = "SQUAT") -> str:
    return str(conn.execute(text(
        "SELECT e.id FROM training_exercises e "
        "JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = :p AND e.name = :n ORDER BY e.position LIMIT 1"),
        {"p": program_id, "n": nom}).scalar())


def _seance(conn, program_id: str) -> str:
    return str(conn.execute(text(
        "SELECT s.id FROM training_sessions s "
        "JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = :p ORDER BY m.number, b.number, w.number, s.position LIMIT 1"), {"p": program_id}).scalar())


# --------------------------------------------------------------------------- #
# 1. La porte fermée
# --------------------------------------------------------------------------- #

def test_un_exercice_d_un_AUTRE_programme_est_introuvable(monde):
    """LE test de cette étape. `require_program_access` valide l'accès au
    programme de l'URL — elle ne dit RIEN de l'exercice visé. Sans la remontée
    exercice → … → programme, coach-1 modifierait la séance de l'athlète de
    coach-2 en passant son propre program_id."""
    cible = _un_exercice(monde, "prog-2")
    r = _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"weight": "999"})
    assert r.status_code == 404          # 404 et non 403 : on ne confirme pas l'existence
    reste = monde.execute(text("SELECT weight FROM training_exercises WHERE id = CAST(:e AS uuid)"),
                          {"e": cible}).scalar()
    assert reste != "999"


def test_un_tiers_n_entre_pas(monde):
    cible = _un_exercice(monde, "prog-1")
    r = _client("inconnu").patch(f"/programs/prog-1/exercises/{cible}", json={"weight": "80"})
    assert r.status_code == 403
    assert r.json()["code"] == "programme_hors_perimetre"


def test_l_athlete_lie_saisit_son_realise(monde):
    """Parité avec l'existant : le PATCH de semaine est `coach_or_athlete`, et
    c'est ainsi que l'athlète saisit son réalisé. Resserrer ici sans le dire
    serait une régression silencieuse."""
    cible = _un_exercice(monde, "prog-1")
    assert _client("athlete-1").patch(
        f"/programs/prog-1/exercises/{cible}", json={"feltRPE": "9"}).status_code == 200


def test_l_athlete_n_ajoute_pas_de_ligne(monde):
    """Ajouter est un geste de programmation : l'interface ne l'offre qu'au coach."""
    sid = _seance(monde, "prog-1")
    r = _client("athlete-1").post(f"/programs/prog-1/sessions/{sid}/exercises", json={"name": "X"})
    assert r.status_code == 403
    assert r.json()["code"] == "programme_hors_perimetre"


# --------------------------------------------------------------------------- #
# 2. La portée d'un refus
# --------------------------------------------------------------------------- #

def test_une_valeur_fautive_ne_coute_QUE_sa_ligne(monde):
    """La raison d'être du chantier. Le 11/08, un `repsUnit` refusé a rendu trois
    SEMAINES non enregistrables — 73 exercices, un athlète bloqué sur sa séance du
    jour. Ici, la ligne voisine est intacte, et la séance reste écrivable."""
    fautive = _un_exercice(monde, "prog-1", "SQUAT")
    voisine = _un_exercice(monde, "prog-1", "PULL UP")
    c = _client("coach-1")

    assert c.patch(f"/programs/prog-1/exercises/{fautive}", json={"repsUnit": "rep"}).status_code == 422
    assert c.patch(f"/programs/prog-1/exercises/{voisine}", json={"weight": "85"}).status_code == 200
    assert monde.execute(text("SELECT weight FROM training_exercises WHERE id = CAST(:e AS uuid)"),
                         {"e": voisine}).scalar() == "85"


def test_un_champ_inconnu_est_refuse(monde):
    """Contrat NEUF : aucune donnée historique à préserver, donc `extra=\"forbid\"`.
    C'est l'inverse du contrat de semaine, où un champ inconnu doit être RÉÉCRIT
    tel quel sous peine de l'effacer de tout l'arbre."""
    cible = _un_exercice(monde, "prog-1")
    assert _client("coach-1").patch(
        f"/programs/prog-1/exercises/{cible}", json={"tonnage": "999"}).status_code == 422


def test_un_patch_vide_est_refuse(monde):
    cible = _un_exercice(monde, "prog-1")
    assert _client("coach-1").patch(
        f"/programs/prog-1/exercises/{cible}", json={}).status_code == 422


def test_les_formes_libres_passent_toujours(monde):
    """Ce qui est resserré l'est sur les vocabulaires CLOS, pas sur les saisies
    libres : « 8-10 », « PDC » et « Sub5 » sont des valeurs légitimes."""
    cible = _un_exercice(monde, "prog-1")
    r = _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}",
                                 json={"reps": "8-10", "weight": "PDC", "feltRPE": "Sub5"})
    assert r.status_code == 200


def test_plusieurs_variantes_et_la_nature(monde):
    """Les deux fonctionnalités en cours (FRE-33, FRE-10) passent par ce contrat."""
    cible = _un_exercice(monde, "prog-1")
    r = _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}",
                                 json={"variant": ["DS", "PAUSE"], "kind": "warmup"})
    assert r.status_code == 200
    ligne = monde.execute(text("SELECT variant, kind FROM training_exercises "
                               "WHERE id = CAST(:e AS uuid)"), {"e": cible}).one()
    assert ligne.variant == ["DS", "PAUSE"] and ligne.kind == "warmup"


# --------------------------------------------------------------------------- #
# 3. Les invariants de structure
# --------------------------------------------------------------------------- #

def test_ajouter_place_la_ligne_EN_FIN(monde):
    sid = _seance(monde, "prog-1")
    avant = monde.execute(text("SELECT max(position) FROM training_exercises WHERE session_id = CAST(:s AS uuid)"),
                          {"s": sid}).scalar()
    r = _client("coach-1").post(f"/programs/prog-1/sessions/{sid}/exercises",
                                json={"name": "ROWING", "sets": "3"})
    assert r.status_code == 201
    pos = monde.execute(text("SELECT position FROM training_exercises WHERE id = CAST(:e AS uuid)"),
                        {"e": r.json()["id"]}).scalar()
    assert pos == avant + 1


def test_ajouter_une_ligne_VIDE_puis_la_nommer(monde):
    """LE 422 DU 15/08, en cliquant « ajouter un exercice » sur une séance neuve.

    C'est le geste de l'éditeur : on pose une ligne nue, on la remplit ensuite.
    Exiger le nom d'emblée demanderait une boîte de dialogue là où il y a un
    tableau — et mon contrat le réclamait, alors que le front envoie `name: ''`.

    À distinguer du chargement en masse, qui écarte les lignes sans nom : là,
    c'est un résidu d'édition ; ici, c'est une ligne qu'on vient de créer."""
    sid = _seance(monde, "prog-1")
    c = _client("coach-1")
    r = c.post(f"/programs/prog-1/sessions/{sid}/exercises", json={"name": ""})
    assert r.status_code == 201
    eid = r.json()["id"]
    assert c.patch(f"/programs/prog-1/exercises/{eid}",
                   json={"name": "SQUAT"}).status_code == 200
    assert monde.execute(text("SELECT name FROM training_exercises WHERE id = CAST(:e AS uuid)"),
                         {"e": eid}).scalar() == "SQUAT"


def test_supprimer_ne_laisse_pas_de_trou(monde):
    sid = _seance(monde, "prog-1")
    cible = _un_exercice(monde, "prog-1", "PULL UP")
    assert _client("coach-1").delete(f"/programs/prog-1/exercises/{cible}").status_code == 200
    positions = [r[0] for r in monde.execute(text(
        "SELECT position FROM training_exercises WHERE session_id = CAST(:s AS uuid) "
        "ORDER BY position"), {"s": sid}).all()]
    assert positions == list(range(len(positions)))


def test_supprimer_un_membre_de_bi_set_nettoie_l_orphelin(monde):
    """FRE-31 : un groupe réduit à UN membre n'est plus un groupe. Côté front, la
    règle a dû être écrite trois fois ; ici le serveur la tient, donc elle ne
    s'oublie plus. Cinq lignes réelles portaient un identifiant orphelin,
    invisible à l'écran par construction."""
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    r = _client("coach-1").delete(f"/programs/prog-1/exercises/{cible}")
    assert r.status_code == 200 and r.json()["groupesNettoyes"] == 1
    # Scopé au programme : la fixture est chargée dans les DEUX, et un groupe
    # n'a de sens que dans sa séance — c'est aussi ainsi que le code filtre.
    restant = monde.execute(text(
        "SELECT e.group_id FROM training_exercises e "
        "JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'prog-1' AND e.name = 'EXTENSION TRICEPS'")).scalar()
    assert restant is None


def test_supprimer_dans_un_TRI_set_laisse_le_groupe_vivre(monde):
    """À trois membres, en retirer un en laisse deux : le groupe tient toujours
    debout, et il ne faut PAS le dissoudre."""
    cible = _un_exercice(monde, "prog-1", "FACE PULL")
    r = _client("coach-1").delete(f"/programs/prog-1/exercises/{cible}")
    assert r.json()["groupesNettoyes"] == 0
    n = monde.execute(text(
        "SELECT count(*) FROM training_exercises e "
        "JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'prog-1' AND e.group_id = 'triset-1'")).scalar()
    assert n == 2


def test_reordonner(monde):
    sid = _seance(monde, "prog-1")
    ids = [str(r[0]) for r in monde.execute(text(
        "SELECT id FROM training_exercises WHERE session_id = CAST(:s AS uuid) ORDER BY position"),
        {"s": sid}).all()]
    inverse = list(reversed(ids))
    assert _client("coach-1").put(f"/programs/prog-1/sessions/{sid}/exercises/order",
                                  json={"exerciseIds": inverse}).status_code == 200
    apres = [str(r[0]) for r in monde.execute(text(
        "SELECT id FROM training_exercises WHERE session_id = CAST(:s AS uuid) ORDER BY position"),
        {"s": sid}).all()]
    assert apres == inverse


def test_reordonner_refuse_une_liste_partielle(monde):
    """Un réordonnancement porte la séance ENTIÈRE. Accepter une liste partielle
    laisserait des positions non décidées — un état que personne n'a demandé."""
    sid = _seance(monde, "prog-1")
    ids = [str(r[0]) for r in monde.execute(text(
        "SELECT id FROM training_exercises WHERE session_id = CAST(:s AS uuid)"), {"s": sid}).all()]
    r = _client("coach-1").put(f"/programs/prog-1/sessions/{sid}/exercises/order",
                               json={"exerciseIds": ids[:3]})
    assert r.status_code == 422


def test_reordonner_refuse_un_intrus(monde):
    """Une ligne d'une AUTRE séance dans la liste — la vérification porte sur
    l'ensemble, pas seulement sur le compte."""
    sid = _seance(monde, "prog-1")
    ids = [str(r[0]) for r in monde.execute(text(
        "SELECT id FROM training_exercises WHERE session_id = CAST(:s AS uuid)"), {"s": sid}).all()]
    intrus = _un_exercice(monde, "prog-2")
    r = _client("coach-1").put(f"/programs/prog-1/sessions/{sid}/exercises/order",
                               json={"exerciseIds": [*ids[:-1], intrus]})
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# LA NATURE APPARTIENT AU GROUPE, PAS À LA LIGNE PATCHÉE (FRE-36)
# --------------------------------------------------------------------------- #

def _natures(conn, program_id: str, group_id: str) -> set:
    return {r[0] for r in conn.execute(text(
        "SELECT e.group_kind FROM training_exercises e "
        "JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = :p AND e.group_id = :g"),
        {"p": program_id, "g": group_id}).all()}


def test_qualifier_UNE_ligne_qualifie_tout_le_groupe(monde):
    """⚠️ LE POINT QUI DÉCIDE SI LA NATURE EST FIABLE. Le PATCH écrit une ligne ;
    la nature, elle, décrit le GROUPE. Écrite ligne à ligne, elle diverge — et ce
    n'est pas théorique : l'écran ne propose déjà qu'une case séries/repos pour
    tout un groupe, et `rest` diverge quand même sur 8 des 42 groupes réels.

    Un groupe mi-bi-set mi-dropset n'a aucune lecture possible : l'en-tête
    afficherait l'une, les champs proposeraient l'autre."""
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    r = _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}",
                                 json={"groupKind": "dropset"})
    assert r.status_code == 200
    assert _natures(monde, "prog-1", "biset-s1") == {"dropset"}


def test_delier_une_ligne_lui_RETIRE_sa_nature(monde):
    """⚠️ SINON ELLE RESSUSCITE AU PROCHAIN LIAGE. Une nature restée sur une ligne
    libre ne veut rien dire aujourd'hui, et décide de tout le jour où on la relie
    — en silence, et sans que personne l'ait demandé."""
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    client = _client("coach-1")
    client.patch(f"/programs/prog-1/exercises/{cible}", json={"groupKind": "dropset"})
    client.patch(f"/programs/prog-1/exercises/{cible}", json={"groupId": ""})

    nature = monde.execute(text(
        "SELECT e.group_kind FROM training_exercises e "
        "JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'prog-1' AND e.id = CAST(:e AS uuid)"), {"e": cible}).scalar()
    assert nature is None


def test_une_ligne_qui_REJOINT_un_dropset_en_adopte_la_nature(monde):
    """⚠️ AJOUTER UNE TROISIÈME DESCENTE NE DOIT PAS Y GLISSER UN BI-SET. La ligne
    neuve serait la seule à ne pas savoir ce qu'elle est, et le groupe deviendrait
    illisible pour l'écran comme pour la génération."""
    client = _client("coach-1")
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    client.patch(f"/programs/prog-1/exercises/{cible}", json={"groupKind": "dropset"})

    sid = _seance(monde, "prog-1")
    r = client.post(f"/programs/prog-1/sessions/{sid}/exercises",
                    json={"name": "CURL BICEPS", "groupId": "biset-s1"})
    assert r.status_code == 201
    assert _natures(monde, "prog-1", "biset-s1") == {"dropset"}


def test_un_LIEN_pose_seul_ne_laisse_pas_le_groupe_NU(monde):
    """⚠️ LE LIAGE ARRIVE EN DEUX PATCHS, ET RIEN N'EN GARANTIT L'ORDRE. L'écran
    pose le lien sur les deux lignes et la nature sur UNE seule ; chaque ligne a
    sa propre file d'envoi. Celle qui ne porte que le lien ne lit donc pas
    toujours la nature de son voisin — et un groupe sans nature est un groupe que
    l'écran devine à chaque lecture, sur une colonne qui reste vide.

    Deux lignes liées sont un bi-set ou un dropset : le serveur écrit le défaut
    plutôt que rien, exactement comme `normaliser_groupes` le fait pour les
    écritures en masse. Le patch de nature qui suit requalifie tout le groupe.

    MUTATION QUI ROUGIT : rendre `nature` au lieu de `nature or NATURE_PAR_DEFAUT`
    dans `propager_la_nature` — les deux lignes repartent à `None`."""
    client = _client("coach-1")
    for nom in ("DIPS", "CHINESE PLANK"):
        cible = _un_exercice(monde, "prog-1", nom)
        r = client.patch(f"/programs/prog-1/exercises/{cible}", json={"groupId": "neuf-1"})
        assert r.status_code == 200

    assert _natures(monde, "prog-1", "neuf-1") == {"biset"}


def test_le_RESCAPE_d_un_groupe_dissous_perd_aussi_sa_nature(monde):
    """⚠️ L'AUTRE MOITIÉ DE `_nettoyer_groupe`. Retirer l'avant-dernier membre
    dissout le groupe : le rescapé perd son lien, et doit perdre sa nature avec.
    Gardée, elle ferait un groupe d'un seul membre (`nature_sans_groupe`), et le
    prochain liage ressusciterait CETTE nature plutôt que celle du groupe rejoint.

    MUTATION QUI ROUGIT : retirer `group_kind = NULL` de l'`UPDATE` — le rescapé
    garde « dropset » sans plus être dans un groupe."""
    client = _client("coach-1")
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    client.patch(f"/programs/prog-1/exercises/{cible}", json={"groupKind": "dropset"})
    assert client.delete(f"/programs/prog-1/exercises/{cible}").json()["groupesNettoyes"] == 1

    reste = monde.execute(text(
        "SELECT e.group_id, e.group_kind FROM training_exercises e "
        "JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'prog-1' AND e.name = 'EXTENSION TRICEPS'")).one()
    assert reste == (None, None)


def test_la_lecture_rend_la_nature_RESOLUE(monde):
    """⚠️ NULL VAUT « BI-SET », ET LE FRONT NE DOIT PAS LE SAVOIR. Servir le NULL
    tel quel l'obligerait à porter la même convention, donc une SECONDE définition
    de la nature d'un groupe — le défaut le plus répété de ce projet.

    Et une ligne HORS groupe rend `''`, pas « biset » : elle n'est pas un groupe
    d'un seul membre."""
    arbre = _client("coach-1").get("/programs/prog-1/training").json()
    lignes = [e for m in arbre["macros"] for b in m["blocks"] for w in b["weeks"]
              for s in (w.get("sessions") or []) for e in s["exercises"]]
    groupees = [e for e in lignes if e["groupId"]]
    libres = [e for e in lignes if not e["groupId"]]

    assert groupees and {e["groupKind"] for e in groupees} == {"biset"}
    assert libres and {e["groupKind"] for e in libres} == {None}


# --------------------------------------------------------------------------- #
# CE QUI APPARTIENT AU GROUPE S'ÉCRIT SUR TOUT LE GROUPE (FRE-36)
# --------------------------------------------------------------------------- #

def _colonne(conn, program_id: str, group_id: str, colonne: str) -> set:
    return {r[0] for r in conn.execute(text(
        f"SELECT e.{colonne} FROM training_exercises e "
        "JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = :p AND e.group_id = :g"),
        {"p": program_id, "g": group_id}).all()}


def test_les_series_d_un_groupe_s_ecrivent_sur_tous_ses_membres(monde):
    """⚠️ LE FRONT LE FAIT DÉJÀ, ET BIEN — depuis FRE-31 il propage séries et
    repos à chaque frappe. Mais une règle qui ne tient qu'au client ne vaut que
    pour le client qui l'applique : 4 groupes de production portent encore deux
    valeurs de `rest`, héritées d'avant la règle. Et cette seconde valeur n'est
    lue NULLE PART — l'écran montre celle du premier membre et met « ↑ » sur les
    suivants. De la donnée morte, qu'aucun écran ne corrigera puisque aucun
    écran ne la montre."""
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    r = _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"sets": "7"})
    assert r.status_code == 200
    assert _colonne(monde, "prog-1", "biset-s1", "sets") == {"7"}


def test_le_repos_aussi(monde):
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"rest": "240"})
    assert _colonne(monde, "prog-1", "biset-s1", "rest") == {"240"}


def test_le_NOM_ne_se_propage_PAS_sur_un_bi_set(monde):
    """⚠️ CE QUI INTERDIT UNE LISTE FIGÉE. Un bi-set, c'est A puis B : propager le
    nom écraserait son second mouvement, la moitié de ce qu'il est."""
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"name": "LEG CURL"})
    assert _colonne(monde, "prog-1", "biset-s1", "name") == {"LEG CURL", "EXTENSION TRICEPS"}


def test_le_NOM_se_propage_sur_un_DROPSET(monde):
    """⚠️ ET C'EST LE CAS CRITIQUE. Sur un dropset, les descentes suivantes
    affichent « ↑ » PAR RÈGLE : un nom divergent y serait définitivement hors de
    portée — pas caché par accident, caché par conception."""
    client = _client("coach-1")
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    client.patch(f"/programs/prog-1/exercises/{cible}", json={"groupKind": "dropset"})

    client.patch(f"/programs/prog-1/exercises/{cible}", json={"name": "LEG CURL"})
    assert _colonne(monde, "prog-1", "biset-s1", "name") == {"LEG CURL"}


def test_une_ligne_HORS_groupe_ne_contamine_personne(monde):
    """Le garde-fou ne doit pas uniformiser toute la séance."""
    cible = _un_exercice(monde, "prog-1", "SQUAT")
    _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"sets": "9"})
    # Le groupe voisin garde les siennes.
    assert "9" not in _colonne(monde, "prog-1", "biset-s1", "sets")


def test_un_champ_qui_n_est_PAS_du_groupe_ne_se_propage_pas(monde):
    """Les reps et la charge décrivent la LIGNE — c'est même tout l'intérêt d'un
    dropset : 30 reps puis 8."""
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"reps": "42"})
    assert len(_colonne(monde, "prog-1", "biset-s1", "reps")) > 1


# --------------------------------------------------------------------------- #
# LES GROUPES CHRONOMÉTRÉS : EMOM ET AMRAP EN ROTATION (FRE-116)
# --------------------------------------------------------------------------- #

def _en_amrap_par_ligne(client, curl: str, triceps: str) -> None:
    """Le bi-set de Laura (04-05/2026), tel qu'il est en production : un AMRAP de
    ligne sur chaque membre. Ici avec deux durées DIFFÉRENTES, le cas où un
    alignement de trop se verrait."""
    client.patch(f"/programs/prog-1/exercises/{curl}", json={"format": "AMRAP", "clusterMode": "300"})
    client.patch(f"/programs/prog-1/exercises/{triceps}", json={"format": "AMRAP", "clusterMode": "180"})


def test_un_BI_SET_garde_une_duree_d_AMRAP_PAR_LIGNE(monde):
    """⚠️ LA RÉGRESSION QUE CE TICKET POUVAIT FAIRE. `clusterMode` devient le
    temps d'un groupe EMOM ou AMRAP ; commun à TOUS les groupes, il écraserait
    la seconde durée d'un bi-set dont chaque ligne est un AMRAP.

    MUTATION QUI ROUGIT : `clusterMode` dans les champs de groupe d'un bi-set."""
    client = _client("coach-1")
    _en_amrap_par_ligne(client, _un_exercice(monde, "prog-1", "CURL BICEPS"),
                        _un_exercice(monde, "prog-1", "EXTENSION TRICEPS"))
    assert _colonne(monde, "prog-1", "biset-s1", "cluster_mode") == {"300", "180"}
    assert _colonne(monde, "prog-1", "biset-s1", "format") == {"AMRAP"}


def test_passer_en_AMRAP_efface_le_format_et_garde_le_temps_de_la_PREMIERE_ligne(monde):
    """William, 16/09 : « si on change de group_kind, on peut enlever le FORMAT ».
    Et le temps n'est pas perdu : la première ligne de la séance le donne au
    groupe — le bi-set de Laura garde ainsi ses 300 s.

    MUTATION QUI ROUGIT : ne pas aligner le groupe après le patch de nature."""
    client = _client("coach-1")
    curl = _un_exercice(monde, "prog-1", "CURL BICEPS")
    _en_amrap_par_ligne(client, curl, _un_exercice(monde, "prog-1", "EXTENSION TRICEPS"))

    assert client.patch(f"/programs/prog-1/exercises/{curl}",
                        json={"groupKind": "amrap"}).status_code == 200
    assert _natures(monde, "prog-1", "biset-s1") == {"amrap"}
    assert _colonne(monde, "prog-1", "biset-s1", "format") == {None}
    assert _colonne(monde, "prog-1", "biset-s1", "cluster_mode") == {"300"}


def test_un_format_pose_APRES_coup_sur_un_groupe_chronometre_s_efface(monde):
    """⚠️ PAS UNE DEMI-RÈGLE. Le format ne s'efface pas qu'au changement de nature :
    un patch ultérieur, venu d'un ancien écran ou d'un appelant qui ne connaît
    pas la règle, ne doit pas réintroduire deux temps pour un effort.

    MUTATION QUI ROUGIT : n'aligner le groupe QUE sur un patch de nature."""
    client = _client("coach-1")
    curl = _un_exercice(monde, "prog-1", "CURL BICEPS")
    client.patch(f"/programs/prog-1/exercises/{curl}", json={"groupKind": "emom"})
    client.patch(f"/programs/prog-1/exercises/{curl}", json={"format": "AMRAP"})
    assert _colonne(monde, "prog-1", "biset-s1", "format") == {None}


def test_l_intervalle_d_un_EMOM_s_ecrit_sur_tout_le_groupe(monde):
    client = _client("coach-1")
    triceps = _un_exercice(monde, "prog-1", "EXTENSION TRICEPS")
    client.patch(f"/programs/prog-1/exercises/{triceps}", json={"groupKind": "emom"})
    client.patch(f"/programs/prog-1/exercises/{triceps}", json={"clusterMode": "60"})
    assert _colonne(monde, "prog-1", "biset-s1", "cluster_mode") == {"60"}


def test_l_athlete_note_ses_TOURS_une_fois_pour_tout_le_groupe(monde):
    """Le résultat d'un AMRAP de groupe finissait en commentaire (« je suis a 6
    ou 7 tours »). C'est du RÉALISÉ : l'athlète l'écrit, et il vaut pour le groupe
    — la lecture le rend sur chaque ligne, quelle que soit celle qui l'a reçu.

    MUTATION QUI ROUGIT : retirer `toursRealises` des champs d'un groupe AMRAP."""
    _client("coach-1").patch(
        f"/programs/prog-1/exercises/{_un_exercice(monde, 'prog-1', 'CURL BICEPS')}",
        json={"groupKind": "amrap"})
    triceps = _un_exercice(monde, "prog-1", "EXTENSION TRICEPS")
    r = _client("athlete-1").patch(f"/programs/prog-1/exercises/{triceps}",
                                   json={"toursRealises": 7})
    assert r.status_code == 200
    assert _colonne(monde, "prog-1", "biset-s1", "tours_realises") == {7}

    arbre = _client("athlete-1").get("/programs/prog-1/training").json()
    lignes = [e for m in arbre["macros"] for b in m["blocks"] for w in b["weeks"]
              for s in (w.get("sessions") or []) for e in s["exercises"]
              if e["groupId"] == "biset-s1"]
    assert lignes and {e["toursRealises"] for e in lignes} == {7}


def test_un_lien_UNBROKEN_tient_entre_deux_lignes_et_tombe_quand_le_groupe_se_defait(monde):
    """« Sans lâcher jusqu'à la suivante » (FRE-116) : un lien, pas une nature.
    Il tient sur une ligne qui a une suivante dans son groupe ; sur la dernière,
    ou une fois le groupe défait, il n'a plus d'objet — et un lien vers rien,
    invisible à l'écran, ressusciterait au prochain liage.

    MUTATION QUI ROUGIT : ne pas ranger les liens après le patch."""
    client = _client("coach-1")
    curl = _un_exercice(monde, "prog-1", "CURL BICEPS")
    triceps = _un_exercice(monde, "prog-1", "EXTENSION TRICEPS")

    assert client.patch(f"/programs/prog-1/exercises/{curl}", json={"unbroken": True}).status_code == 200
    client.patch(f"/programs/prog-1/exercises/{triceps}", json={"unbroken": True})
    # ⚠️ PAR LES DEUX LIGNES, PAS PAR `group_id` : `biset-s1` existe AUSSI dans
    # `prog-2`, et le dictionnaire gardait l'une ou l'autre selon l'ordre de
    # lecture — la spec rougissait une fois sur deux (vu le 18/09).
    liens = dict(monde.execute(text(
        "SELECT name, unbroken FROM training_exercises "
        "WHERE id IN (CAST(:c AS uuid), CAST(:t AS uuid))"), {"c": curl, "t": triceps}).all())
    assert liens == {"CURL BICEPS": True, "EXTENSION TRICEPS": False}

    client.patch(f"/programs/prog-1/exercises/{triceps}", json={"groupId": ""})
    assert monde.execute(text(
        "SELECT unbroken FROM training_exercises WHERE id = CAST(:e AS uuid)"), {"e": curl}).scalar() is False


def test_des_tours_NEGATIFS_sont_refuses(monde):
    cible = _un_exercice(monde, "prog-1", "CURL BICEPS")
    r = _client("athlete-1").patch(f"/programs/prog-1/exercises/{cible}", json={"toursRealises": -1})
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# LE RÔLE COMBINÉ, PAR LA ROUTE (FRE-142)
#
# ⚠️ Les 4 coachs de production sont aussi athlètes. Aucune spec ne posait ce
# cas : `refuser_prescription` fait l'union des rôles, et une régression qui
# prendrait le PREMIER rôle rencontré aurait refusé à William sa propre
# prescription — sans qu'une seule spec ne bouge.
# --------------------------------------------------------------------------- #


def test_l_athlete_n_ecrit_pas_la_prescription_et_le_code_le_dit(monde):
    """Le statut ne suffit pas : le front branche son message sur le CODE."""
    cible = _un_exercice(monde, "prog-1")
    r = _client("athlete-1").patch(f"/programs/prog-1/exercises/{cible}", json={"weight": "80"})
    assert r.status_code == 403
    assert r.json()["code"] == "prescription_reservee_au_staff"


def test_le_coach_qui_est_aussi_l_athlete_ecrit_sa_prescription(monde):
    monde.execute(text("UPDATE athletes SET user_uid = 'coach-1' "
                       "WHERE id = '11111111-1111-1111-1111-111111111111'"))
    cible = _un_exercice(monde, "prog-1")
    r = _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"weight": "80"})
    assert r.status_code == 200, r.text
    assert monde.execute(text("SELECT weight FROM training_exercises WHERE id = CAST(:e AS uuid)"),
                         {"e": cible}).scalar() == "80"


# ---------------------------------------------------------------------------
# `''` CONTRE `NULL` — le robinet, fermé avant qu'on éponge (FRE-137)
# ---------------------------------------------------------------------------

def test_une_chaine_vide_s_ecrit_NULL(monde):
    """⚠️ LE CHEMIN QUI COMPTE EST LE PATCH, pas la création.

    La base portait les deux encodages de la même absence, et ce n'était pas un
    équilibre : le `''` REMPLAÇAIT le `NULL`, ligne après ligne. Mesuré le 11/09
    par semaine d'entraînement — sur `tempo`, 0 vide en juin contre 154 sur 171
    en octobre.

    Le cycle, entièrement côté serveur : `_sortie` traduit `NULL` en `''` parce
    que le contrat front type ces champs `string`, le front renvoie l'objet tel
    qu'il l'a reçu, et l'écriture repose le `''`. La création n'écrit une ligne
    qu'une fois ; le PATCH la réécrit à chaque saisie de réalisé."""
    cible = _un_exercice(monde, "prog-1")
    r = _client("coach-1").patch(
        f"/programs/prog-1/exercises/{cible}",
        json={"tempo": "", "assistance": "  ", "coachNote": "", "link": ""})
    assert r.status_code == 200
    ligne = monde.execute(text(
        "SELECT tempo, assistance, coach_note, link FROM training_exercises "
        "WHERE id = CAST(:e AS uuid)"), {"e": cible}).one()
    assert ligne.tempo is None
    # Des espaces ne sont pas davantage une valeur qu'une chaîne vide.
    assert ligne.assistance is None
    assert ligne.coach_note is None
    assert ligne.link is None


def test_un_repos_libre_s_ecrit_NULL_quelle_que_soit_sa_forme(monde):
    """FRE-169 : `-1` et `Free` étaient deux autres écritures de « repos libre »,
    et `ff_num('-1')` vaut −1 — la projection moyennait des repos négatifs.
    Le robinet est ici, sur le PATCH comme à la création ; la base refuse en
    plus le négatif (`rest_sans_sentinelle`)."""
    cible = _un_exercice(monde, "prog-1")
    r = _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"rest": "-1"})
    assert r.status_code == 200
    lire = lambda: monde.execute(text(  # noqa: E731
        "SELECT rest FROM training_exercises WHERE id = CAST(:e AS uuid)"), {"e": cible}).scalar()
    assert lire() is None
    _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"rest": "Free"})
    assert lire() is None
    # Un repos NUL n'est pas une sentinelle : c'est un dropset sans pause.
    _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"rest": "0"})
    assert lire() == "0"
    # Et le texte passe intact — le coach s'en sert.
    _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}", json={"rest": "1'30"})
    assert lire() == "1'30"


def test_une_chaine_vide_s_ecrit_NULL_aussi_a_la_creation(monde):
    """La création passe par `valeur_ligne`, le patch par `vide_vaut_absence` :
    une seule règle, sinon les deux chemins auraient divergé."""
    seance = str(monde.execute(text(
        "SELECT s.id FROM training_sessions s "
        "JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'prog-1' LIMIT 1")).scalar())
    r = _client("coach-1").post(
        f"/programs/prog-1/sessions/{seance}/exercises",
        json={"name": "SQUAT", "tempo": "", "assistance": "", "coachNote": ""})
    assert r.status_code == 201
    ligne = monde.execute(text(
        "SELECT tempo, assistance, coach_note FROM training_exercises "
        "WHERE id = CAST(:e AS uuid)"), {"e": r.json()["id"]}).one()
    assert (ligne.tempo, ligne.assistance, ligne.coach_note) == (None, None, None)


def test_une_valeur_qui_n_est_pas_vide_passe_intacte(monde):
    """⚠️ LA GARDE DE LA GARDE. Une conversion trop large effacerait « 0 », qui
    est une charge réelle sur 461 lignes de production, ou « PDC ». On ne
    convertit QUE la chaîne sans caractère."""
    cible = _un_exercice(monde, "prog-1")
    r = _client("coach-1").patch(f"/programs/prog-1/exercises/{cible}",
                                 json={"weight": "0", "tempo": "30X0", "reps": "8-10"})
    assert r.status_code == 200
    ligne = monde.execute(text(
        "SELECT weight, tempo, reps FROM training_exercises "
        "WHERE id = CAST(:e AS uuid)"), {"e": cible}).one()
    assert (ligne.weight, ligne.tempo, ligne.reps) == ("0", "30X0", "8-10")


def test_le_front_ne_voit_pas_la_difference(monde):
    """⚠️ CE QUI REND CE LOT NON COUPLÉ AU FRONT. `_sortie` retraduit `NULL` en
    `''` : eitri lit exactement ce qu'il lisait avant, et le lot suivant — les
    migrations colonne par colonne — peut avancer sans déploiement conjoint."""
    cible = _un_exercice(monde, "prog-1")
    cli = _client("coach-1")
    assert cli.patch(f"/programs/prog-1/exercises/{cible}",
                     json={"tempo": ""}).status_code == 200
    arbre = cli.get("/programs/prog-1/training").json()
    lignes = [e for m in arbre["macros"] for b in m["blocks"] for w in b["weeks"]
              for s in w["sessions"] for e in s["exercises"] if e["id"] == cible]
    assert lignes and lignes[0]["tempo"] is None


# --------------------------------------------------------------------------- #
# DUPLIQUER UNE LIGNE (Passe 3, constat 05)
# --------------------------------------------------------------------------- #

def _lignes(conn, sid: str) -> list[dict]:
    return [dict(r) for r in conn.execute(text(
        "SELECT id::text, position, name, sets, reps, weight, weight_locked, aimed_rpe, kind, "
        "       felt_rpe, felt_rpe_by_set, reps_done, weight_done, group_id "
        "FROM training_exercises WHERE session_id = CAST(:s AS uuid) ORDER BY position"),
        {"s": sid}).mappings()]


def test_dupliquer_pose_la_COPIE_juste_dessous_sans_le_REALISE(monde):
    """La prescription et la nature suivent ; le réalisé, jamais — on ne recopie
    pas ce qu'un athlète a ressenti. Les lignes suivantes se décalent sans trou.
    MUTATIONS QUI ROUGISSENT : copier `felt_rpe` ; insérer en fin de séance."""
    sid = _seance(monde, "prog-1")
    avant = _lignes(monde, sid)
    squat = avant[0]
    assert squat["name"] == "SQUAT" and squat["felt_rpe"] == "8"   # la ligne porte un réalisé

    r = _client("coach-1").post(f"/programs/prog-1/exercises/{squat['id']}/duplicate")
    assert r.status_code == 201, r.text
    apres = _lignes(monde, sid)

    assert [l["position"] for l in apres] == list(range(len(avant) + 1))
    copie = apres[1]
    assert copie["id"] == r.json()["id"]
    for champ in ("name", "sets", "reps", "weight", "weight_locked", "aimed_rpe", "kind"):
        assert copie[champ] == squat[champ], champ
    assert copie["felt_rpe"] is None and copie["felt_rpe_by_set"] is None
    assert copie["reps_done"] is None and copie["weight_done"] is None
    # Les autres n'ont fait que glisser d'un cran, dans le même ordre.
    assert [l["id"] for l in apres[2:]] == [l["id"] for l in avant[1:]]


def test_dupliquer_un_membre_de_BI_SET_pose_la_copie_SOUS_le_groupe(monde):
    """Posée juste sous le premier membre, la copie couperait le bi-set en deux.
    MUTATION QUI ROUGIT : ignorer `group_id` et insérer sous la ligne elle-même."""
    sid = _seance(monde, "prog-1")
    avant = _lignes(monde, sid)
    membres = [l for l in avant if l["group_id"] == "biset-s1"]
    assert len(membres) == 2

    r = _client("coach-1").post(f"/programs/prog-1/exercises/{membres[0]['id']}/duplicate")
    assert r.status_code == 201, r.text
    apres = _lignes(monde, sid)
    pos = {l["id"]: l["position"] for l in apres}

    # Les deux membres restent consécutifs, et la copie vient après eux, hors groupe.
    assert pos[membres[1]["id"]] == pos[membres[0]["id"]] + 1
    copie = next(l for l in apres if l["id"] == r.json()["id"])
    assert copie["position"] == pos[membres[1]["id"]] + 1
    assert copie["group_id"] is None


def test_dupliquer_est_un_geste_de_PROGRAMMATION(monde):
    """L'athlète ne duplique pas ; un autre programme reste inatteignable (404)."""
    sid = _seance(monde, "prog-1")
    eid = _lignes(monde, sid)[0]["id"]
    assert _client("athlete-1").post(f"/programs/prog-1/exercises/{eid}/duplicate").status_code == 403
    assert _client("coach-2").post(f"/programs/prog-2/exercises/{eid}/duplicate").status_code == 404


# --------------------------------------------------------------------------- #
# DÉPLACER UNE LIGNE D'UNE SÉANCE À L'AUTRE (FRE-188)
# --------------------------------------------------------------------------- #

def _semaine_de(conn, session_id: str) -> str:
    return str(conn.execute(text("SELECT week_id FROM training_sessions WHERE id = CAST(:s AS uuid)"),
                            {"s": session_id}).scalar())


def _nouvelle_seance(program_id: str, week_id: str, nom: str = "Jeudi") -> str:
    """Par la route, pas en SQL : la forme d'une séance neuve est celle que
    l'écriture réelle produit."""
    r = _client("coach-1").post(f"/programs/{program_id}/weeks/{week_id}/sessions", json={"name": nom})
    assert r.status_code == 201, r.text[:300]
    return r.json()["id"]


def _ligne(conn, exercise_id: str):
    return conn.execute(text(
        "SELECT session_id, position, group_id, group_kind, felt_rpe, weight_done "
        "FROM training_exercises WHERE id = CAST(:e AS uuid)"), {"e": exercise_id}).mappings().first()


def _positions(conn, session_id: str) -> list[int]:
    return [r[0] for r in conn.execute(text(
        "SELECT position FROM training_exercises WHERE session_id = CAST(:s AS uuid) ORDER BY position"),
        {"s": session_id}).all()]


def _deplacer(exercise_id: str, session_id: str, position: int | None = None, uid: str = "coach-1"):
    corps = {"sessionId": session_id} if position is None else {"sessionId": session_id, "position": position}
    return _client(uid).put(f"/programs/prog-1/exercises/{exercise_id}/seance", json=corps)


def test_deplacer_une_ligne_garde_son_id_et_son_realise(monde):
    """La raison d'être de la route : supprimer-recréer changeait l'`id` et vidait
    le réalisé. Ici la ligne est la MÊME, avec son ressenti, dans l'autre séance,
    et les deux séances sortent renumérotées sans trou.

    MUTATION QUI ROUGIT : ne pas `renumeroter` la source — ses positions gardent
    un trou là où la ligne était."""
    source = _seance(monde, "prog-1")
    cible = _nouvelle_seance("prog-1", _semaine_de(monde, source))
    squat = _un_exercice(monde, "prog-1", "SQUAT")
    avant = _ligne(monde, squat)
    assert avant["felt_rpe"] == "8" and avant["session_id"] == __import__("uuid").UUID(source)
    n_source = len(_positions(monde, source))

    r = _deplacer(squat, cible, 0)
    assert r.status_code == 200, r.text[:300]
    assert r.json()["count"] == 1

    apres = _ligne(monde, squat)
    assert str(apres["session_id"]) == cible and apres["position"] == 0
    assert apres["felt_rpe"] == "8", "le réalisé suit la ligne"
    assert _positions(monde, source) == list(range(n_source - 1)), "la source se referme"
    assert _positions(monde, cible) == [0]
    for sid in (source, cible):
        assert monde.execute(text("SELECT modifiee_le FROM training_sessions WHERE id = CAST(:s AS uuid)"),
                             {"s": sid}).scalar() is not None, "les deux séances reviennent en relecture"


def test_deplacer_emporte_le_GROUPE_entier(monde):
    """Comme dans une séance (FRE-31) : le bi-set part d'un bloc, ses membres
    restent consécutifs, avec leur identifiant et leur nature.

    MUTATION QUI ROUGIT : ne déplacer que la ligne visée — `count` vaut 1 et le
    partenaire reste derrière."""
    source = _seance(monde, "prog-1")
    cible = _nouvelle_seance("prog-1", _semaine_de(monde, source))
    curl = _un_exercice(monde, "prog-1", "CURL BICEPS")
    triceps = _un_exercice(monde, "prog-1", "EXTENSION TRICEPS")
    groupe = _ligne(monde, curl)["group_id"]
    assert groupe and _ligne(monde, triceps)["group_id"] == groupe

    r = _deplacer(curl, cible)
    assert r.status_code == 200 and r.json()["count"] == 2

    a, b = _ligne(monde, curl), _ligne(monde, triceps)
    assert str(a["session_id"]) == cible and str(b["session_id"]) == cible
    assert (a["position"], b["position"]) == (0, 1)
    assert a["group_id"] == groupe and b["group_id"] == groupe
    assert not [g for (g,) in monde.execute(text(
        "SELECT group_id FROM training_exercises WHERE session_id = CAST(:s AS uuid) AND group_id = :g"),
        {"s": source, "g": groupe}).all()], "rien du groupe ne reste derrière"


def test_deplacer_au_dela_de_la_fin_place_en_dernier(monde):
    source = _seance(monde, "prog-1")
    cible = _nouvelle_seance("prog-1", _semaine_de(monde, source))
    _client("coach-1").post(f"/programs/prog-1/sessions/{cible}/exercises", json={"name": "ROWING"})
    dips = _un_exercice(monde, "prog-1", "DIPS")
    assert _deplacer(dips, cible, 99).status_code == 200
    assert _ligne(monde, dips)["position"] == 1
    assert _positions(monde, cible) == [0, 1]


def test_deplacer_vers_une_AUTRE_semaine_est_refuse(monde):
    """La semaine est l'unité de programmation, et la suivante se recopie de la
    précédente : une ligne qui changerait de semaine y serait copiée deux fois.

    MUTATION QUI ROUGIT : retirer la comparaison des semaines — la ligne part, 200."""
    source = _seance(monde, "prog-1")
    autre_semaine = str(monde.execute(text(
        "SELECT w.id FROM training_weeks w JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = 'prog-1' "
        "AND w.id <> CAST(:w AS uuid) LIMIT 1"), {"w": _semaine_de(monde, source)}).scalar())
    cible = _nouvelle_seance("prog-1", autre_semaine)
    squat = _un_exercice(monde, "prog-1", "SQUAT")
    r = _deplacer(squat, cible)
    assert r.status_code == 409 and r.json()["code"] == "seance_d_une_autre_semaine"
    assert str(_ligne(monde, squat)["session_id"]) == source, "rien n'a bougé"


def test_deplacer_vers_la_seance_d_un_AUTRE_programme_est_introuvable(monde):
    squat = _un_exercice(monde, "prog-1", "SQUAT")
    assert _deplacer(squat, _seance(monde, "prog-2")).status_code == 404


def test_l_athlete_ne_deplace_pas(monde):
    source = _seance(monde, "prog-1")
    cible = _nouvelle_seance("prog-1", _semaine_de(monde, source))
    squat = _un_exercice(monde, "prog-1", "SQUAT")
    assert _deplacer(squat, cible, uid="athlete-1").status_code == 403


# --------------------------------------------------------------------------- #
# L'IDENTITÉ CHOISIE PAR LE CLIENT — un ajout de ligne REJOUABLE (25/09)
# --------------------------------------------------------------------------- #

_ID_LIGNE = "bbbbbbbb-0000-4000-8000-000000000001"


def test_rejouer_l_ajout_d_une_ligne_ne_l_ajoute_pas_deux_fois(monde):
    """La file hors ligne rejoue le `POST` au retour du réseau : avec son
    identité, la ligne du premier envoi est retrouvée, et ce que les patchs
    suivants lui ont donné n'est pas réécrit."""
    sid = _seance(monde, "prog-1")
    c = _client("coach-1")
    avant = monde.execute(text("SELECT count(*) FROM training_exercises WHERE session_id = CAST(:s AS uuid)"),
                          {"s": sid}).scalar()
    corps = {"id": _ID_LIGNE, "name": ""}
    assert c.post(f"/programs/prog-1/sessions/{sid}/exercises", json=corps).status_code == 201
    assert c.patch(f"/programs/prog-1/exercises/{_ID_LIGNE}", json={"name": "SQUAT"}).status_code == 200
    r = c.post(f"/programs/prog-1/sessions/{sid}/exercises", json=corps)
    assert r.status_code == 201
    assert r.json()["id"] == _ID_LIGNE
    assert monde.execute(text("SELECT count(*) FROM training_exercises WHERE session_id = CAST(:s AS uuid)"),
                         {"s": sid}).scalar() == avant + 1
    assert monde.execute(text("SELECT name FROM training_exercises WHERE id = CAST(:e AS uuid)"),
                         {"e": _ID_LIGNE}).scalar() == "SQUAT"


def test_une_ligne_ne_se_cree_pas_sous_l_identite_d_une_ligne_d_une_autre_seance(monde):
    c = _client("coach-1")
    sid = _seance(monde, "prog-1")
    assert c.post(f"/programs/prog-1/sessions/{sid}/exercises", json={"id": _ID_LIGNE, "name": ""}).status_code == 201
    autre = c.post(f"/programs/prog-1/weeks/{_semaine_de(monde, sid)}/sessions",
                   json={"name": "Autre"}).json()["id"]
    r = c.post(f"/programs/prog-1/sessions/{autre}/exercises", json={"id": _ID_LIGNE, "name": ""})
    assert r.status_code == 409
    assert r.json()["code"] == "identifiant_pris"
