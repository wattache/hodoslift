"""Écriture de la structure de l'arbre (FRE-12) — contre un VRAI Postgres.

Trois familles d'invariants, par ordre d'importance :

  1. l'APPARTENANCE : aucun objet d'un autre programme n'est atteignable, même
     avec un program_id légitime dans l'URL. C'est le seul défaut qui serait une
     fuite de données ;
  2. les RÈGLES MÉTIER reprises de l'ancien cycle de vie : le dernier bloc d'un
     macro ne se supprime pas, les numéros viennent du serveur ;
  3. la CASCADE : supprimer un macro emporte tout, dans la transaction. C'est ce
     qui remplace l'énumération par lots de 450 documents Firestore.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app
from tests.chargeur_arbre import Arbre, load
from tests.fixtures_training import arbre_de_test

_AUTH = {"Authorization": "Bearer x"}


@pytest.fixture
def monde(pg):
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1','a@x.fr'), ('coach-2','b@x.fr'), ('ath-1','c@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1'), ('coach-2')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name, last_name, user_uid) VALUES "
        "('11111111-1111-1111-1111-111111111111','coach-1','A','Un','ath-1'),"
        "('22222222-2222-2222-2222-222222222222','coach-2','B','Deux',NULL)"))
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
        "('p1','coach-1','11111111-1111-1111-1111-111111111111'),"
        "('p2','coach-2','22222222-2222-2222-2222-222222222222')"))
    load(pg, Arbre(macros=arbre_de_test("p1")))
    load(pg, Arbre(macros=arbre_de_test("p2")))
    return pg


def _client(uid: str) -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def _id(conn, niveau: str, program_id: str, ordre: str = "") -> str:
    sql = {
        "macro": "SELECT m.id FROM training_macros m WHERE m.program_id = :p",
        "bloc": ("SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id "
                 "WHERE m.program_id = :p"),
        "semaine": ("SELECT w.id FROM training_weeks w JOIN training_blocks b ON b.id = w.block_id "
                    "JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = :p"),
        "seance": ("SELECT s.id FROM training_sessions s JOIN training_weeks w ON w.id = s.week_id "
                   "JOIN training_blocks b ON b.id = w.block_id "
                   "JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = :p"),
    }[niveau]
    # ⚠️ UN `LIMIT 1` SANS `ORDER BY` NE DÉSIGNE RIEN. Il rendait la ligne que
    # Postgres scannait en premier, c'est-à-dire l'ordre PHYSIQUE du tas — qui
    # dépend de ce que les tests précédents ont écrit et annulé.
    #
    # Ça ne se voyait pas parce que le premier scan tombait sur `sem-1`. Sauf que
    # l'arbre de test a DEUX semaines, et que `sem-2` (« Décharge ») n'a aucune
    # séance : le jour où le scan a basculé dessus,
    # `test_reordonner_refuse_une_liste_incomplete` a cessé de tester ce qu'il
    # annonçait — sa liste « incomplète » était complète, et le 422 attendu est
    # devenu un 200. Découvert le 17/08 en ajoutant des tests AILLEURS.
    defaut = {
        "macro": "ORDER BY m.number LIMIT 1",
        "bloc": "ORDER BY b.number LIMIT 1",
        "semaine": "ORDER BY w.number LIMIT 1",
        "seance": "ORDER BY s.position LIMIT 1",
    }[niveau]
    return str(conn.execute(text(f"{sql} {ordre or defaut}"), {"p": program_id}).scalar())


# --------------------------------------------------------------------------- #
# 1. La porte fermée
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("niveau,chemin,table", [
    ("macro", "macros", "training_macros"),
    ("bloc", "blocks", "training_blocks"),
    ("semaine", "weeks", "training_weeks"),
    ("seance", "sessions", "training_sessions"),
])
def test_un_objet_d_un_AUTRE_programme_est_introuvable(monde, niveau, chemin, table):
    """`require_program_access` autorise le PROGRAMME de l'URL, pas l'objet visé.
    Sans la remontée jusqu'au programme, coach-1 renommerait le bloc de l'athlète
    de coach-2 en passant son propre program_id.

    On vérifie les DEUX choses : le refus, et l'absence d'écriture. Un 404 rendu
    après coup ne prouverait rien."""
    cible = _id(monde, niveau, "p2")
    avant = monde.execute(text(f"SELECT name FROM {table} WHERE id = CAST(:i AS uuid)"),
                          {"i": cible}).scalar()
    r = _client("coach-1").patch(f"/programs/p1/{chemin}/{cible}",
                                 json={"name": "Volé"}, headers=_AUTH)
    assert r.status_code == 404      # 404, pas 403 : on ne confirme rien
    apres = monde.execute(text(f"SELECT name FROM {table} WHERE id = CAST(:i AS uuid)"),
                          {"i": cible}).scalar()
    assert apres == avant != "Volé"


def test_un_tiers_n_entre_pas(monde):
    macro = _id(monde, "macro", "p1")
    r = _client("inconnu").patch(f"/programs/p1/macros/{macro}", json={"name": "X"}, headers=_AUTH)
    assert r.status_code == 403
    assert r.json()["code"] == "programme_hors_perimetre"


def test_l_athlete_ne_renomme_pas_un_macro(monde):
    """Renommer est un geste de programmation : `coach` seul."""
    macro = _id(monde, "macro", "p1")
    r = _client("ath-1").patch(f"/programs/p1/macros/{macro}", json={"name": "X"}, headers=_AUTH)
    assert r.status_code == 403
    assert r.json()["code"] == "programme_hors_perimetre"


def test_l_athlete_saisit_SA_forme_du_jour(monde):
    """Mais la forme du jour et le poids de la semaine sont à lui : parité avec
    l'existant, où le PATCH de semaine était `coach_or_athlete`."""
    seance = _id(monde, "seance", "p1")
    assert _client("ath-1").patch(f"/programs/p1/sessions/{seance}",
                                  json={"formOfTheDay": 4}, headers=_AUTH).status_code == 200


# --------------------------------------------------------------------------- #
# 2. Les règles métier
# --------------------------------------------------------------------------- #

def test_le_dernier_bloc_d_un_macro_ne_se_supprime_pas(monde):
    """Règle reprise de l'ancien cycle de vie : l'interface garde l'invariant
    « au moins un bloc », et un macro vide n'a pas de représentation."""
    c = _client("coach-1")
    blocs = [str(r[0]) for r in monde.execute(text(
        "SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'p1' ORDER BY b.number"), ).all()]
    assert c.delete(f"/programs/p1/blocks/{blocs[1]}", headers=_AUTH).status_code == 200
    r = c.delete(f"/programs/p1/blocks/{blocs[0]}", headers=_AUTH)
    assert r.status_code == 409
    assert monde.execute(text("SELECT count(*) FROM training_blocks")).scalar() > 0


def test_les_numeros_viennent_du_SERVEUR(monde):
    """Le client ne voit qu'un arbre potentiellement périmé : lui laisser le
    numéro rouvrirait la porte aux collisions."""
    macro = _id(monde, "macro", "p1")
    r = _client("coach-1").post(f"/programs/p1/macros/{macro}/blocks", json={}, headers=_AUTH)
    assert r.status_code == 201
    numero = monde.execute(text("SELECT number FROM training_blocks WHERE id = CAST(:i AS uuid)"),
                           {"i": r.json()["ids"]["block"]}).scalar()
    assert numero == 3      # la fixture en a deux


def test_creer_un_macro_lui_donne_un_bloc_et_une_semaine(monde):
    """Un macro vide n'est pas un état que l'interface sait présenter."""
    r = _client("coach-1").post("/programs/p1/macros",
                                json={"name": "Neuf", "block": {"week": {"name": "S1"}}},
                                headers=_AUTH)
    assert r.status_code == 201
    ids = r.json()["ids"]
    assert set(ids) == {"macro", "block", "week", "sessions"}


def test_creer_une_semaine_AVEC_son_contenu(monde):
    """La génération depuis la BASE est de la logique métier FRONT (ordre des
    mouvements, incréments, granularité) : le serveur pose la structure."""
    bloc = _id(monde, "bloc", "p1")
    r = _client("coach-1").post(f"/programs/p1/blocks/{bloc}/weeks", headers=_AUTH, json={
        "name": "Générée",
        "sessions": [{"name": "Lundi", "exercises": [
            {"name": "SQUAT", "variant": ["COMP"], "sets": "5", "reps": "5"},
            {"name": "DIPS", "weight": "PDC"},
        ]}],
    })
    assert r.status_code == 201
    n = monde.execute(text(
        "SELECT count(*) FROM training_exercises e JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id WHERE w.id = CAST(:w AS uuid)"),
        {"w": r.json()["ids"]["week"]}).scalar()
    assert n == 2


def test_une_semaine_CREEE_ne_peut_porter_aucun_REALISE(monde):
    """⚠️ UNE CHARGE RÉELLE NE SE DUPLIQUE JAMAIS AVEC LA SEMAINE. Elle vit là où
    elle a été saisie — décision du 21/08, et c'est une règle absolue, pas un
    réglage.

    LE DÉFAUT QU'ELLE FERME, mesuré sur la production : 37 lignes portaient une
    charge réelle sans aucune autre trace, sur des séances jamais ouvertes. 24 des
    25 comparables (96 %) recopiaient à l'identique la semaine précédente, quand
    les lignes réellement entraînées ne se répètent que dans 33 % des cas — 96
    contre 33, ce n'est pas un athlète qui refait la même charge, c'est une copie.
    Des athlètes ouvraient une semaine à venir et y lisaient une perf qu'ils
    n'avaient pas faite.

    ⚠️ LE FRONT L'EFFAÇAIT DÉJÀ, avec sa propre spec (`next-week.test.ts`), et ça
    n'a pas suffi : les 37 lignes viennent de semaines migrées de l'ancienne app.
    Une règle qui ne tient qu'au client ne vaut que pour le client qui l'applique.

    Le serveur n'a donc PAS de colonne de réalisé dans son jeu permis à la
    création : ce qu'on crée n'a été fait par personne. Ces champs ne s'écrivent
    que par `PATCH /exercises/{id}`, sur une ligne qui existe et qu'on est en
    train de faire.

    La ligne est créée quand même — c'est la convention de `_inserer_ligne`, qui
    IGNORE ce qu'il ne connaît pas plutôt que de refuser tout l'arbre pour un
    champ de trop. Ce qu'on vérifie, c'est que le réalisé n'ATTERRIT pas."""
    bloc = _id(monde, "bloc", "p1")
    r = _client("coach-1").post(f"/programs/p1/blocks/{bloc}/weeks", headers=_AUTH, json={
        "name": "S4",
        "sessions": [{"name": "Lundi", "exercises": [{
            "name": "SQUAT", "sets": "3", "reps": "3", "weight": "100",
            # Tout le réalisé de la semaine précédente, tel qu'une copie le
            # transporterait. Le cas réel : Killian, S4 identique à S3.
            "weightDone": "102.5", "repsDone": "3", "restActual": "180",
            "feltRPE": "9", "feltRPEBySet": ["8", "9"], "athleteFeedback": "dur",
        }]}],
    })
    assert r.status_code == 201
    ligne = monde.execute(text(
        "SELECT weight_done, reps_done, rest_actual, felt_rpe, felt_rpe_by_set, athlete_feedback, weight "
        "FROM training_exercises e JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id WHERE w.id = CAST(:w AS uuid)"),
        {"w": r.json()["ids"]["week"]}).one()
    assert ligne.weight == "100", "la PRESCRIPTION, elle, doit bien passer"
    assert not any((ligne.weight_done, ligne.reps_done, ligne.rest_actual,
                    ligne.felt_rpe, ligne.felt_rpe_by_set, ligne.athlete_feedback)), \
        "du réalisé a été créé avec la semaine"


def test_le_jeu_permis_a_la_creation_EXCLUT_tout_CHAMPS_REALISE():
    """La garde du test précédent, mais sur la LISTE plutôt que sur un cas.

    `CHAMPS_REALISE` (`app/socle/perimetre.py`) est déjà LA définition de ce que
    l'athlète saisit après sa séance, et elle est faite pour grandir : « on
    définit le petit ensemble et on déduit le grand ». Le jour où un septième
    champ de réalisé apparaît, il doit être exclu de la création sans que
    personne n'ait à y penser — sinon la règle se re-perd exactement comme elle
    s'est perdue une première fois."""
    from app.socle.perimetre import CHAMPS_REALISE
    from app.entrainement.prescription import COLONNES_PAR_TABLE as _COLONNES_PAR_TABLE

    for table, permises in _COLONNES_PAR_TABLE.items():
        fuite = CHAMPS_REALISE & permises
        assert not fuite, f"{table} accepte du réalisé à la création : {sorted(fuite)}"


def test_creer_une_semaine_AVEC_LA_FORME_QUE_LE_FRONT_ENVOIE(monde):
    """LE 422 DU 15/08, trouvé en cliquant « + Semaine » sur la stack locale.

    Mes tests construisaient un corps à MA façon ; le front, lui, reconstruit une
    semaine à partir de ce qu'il vient de LIRE — donc avec `hidden` et un objet
    `athlete`. Le contrat les refusait (`extra=\"forbid\"`), et la création
    échouait en 422 sans que rien côté serveur ne soit en cause.

    La leçon tient en une phrase : un contrat d'écriture doit accepter ce que sa
    propre lecture rend. Ce test envoie donc la forme du front, pas la mienne."""
    bloc = _id(monde, "bloc", "p1")
    r = _client("coach-1").post(f"/programs/p1/blocks/{bloc}/weeks", headers=_AUTH, json={
        "name": "S5",
        "hidden": False,
        "athlete": {"firstName": "A", "lastName": "Un", "height": 178, "weight": 72.5},
        "sessions": [{"name": "Lundi", "exercises": [{"name": "SQUAT"}]}],
    })
    assert r.status_code == 201
    semaine = monde.execute(text(
        "SELECT hidden, athlete_weight_kg, athlete_height_cm FROM training_weeks "
        "WHERE id = CAST(:w AS uuid)"), {"w": r.json()["ids"]["week"]}).one()
    # Le poids et la taille sont RETENUS de l'instantané ; le nom, non : il vient
    # de la fiche athlète, et le recopier était justement la dette qu'on solde.
    assert (semaine.hidden, float(semaine.athlete_weight_kg), float(semaine.athlete_height_cm)) \
        == (False, 72.5, 178.0)


def test_une_seance_SANS_DATE_passe(monde):
    """LE 500 DU 15/08, en cliquant « + Semaine ». Le front écrit « pas de date »
    par une chaîne VIDE — convention de l'arbre documentaire. Une colonne `date`
    la refuse, et la requête tombait en 500 (que le navigateur signalait en CORS,
    faute d'en-têtes sur une réponse d'erreur).

    Le contenu d'une semaine est un dictionnaire LIBRE : Pydantic valide les
    champs déclarés du contrat, pas celui-là."""
    bloc = _id(monde, "bloc", "p1")
    r = _client("coach-1").post(f"/programs/p1/blocks/{bloc}/weeks", headers=_AUTH, json={
        "sessions": [{"name": "Lundi", "sessionDate": "", "formOfTheDay": "",
                      "exercises": [{"name": "SQUAT"}]}]})
    assert r.status_code == 201
    d = monde.execute(text(
        "SELECT session_date, form_of_the_day FROM training_sessions "
        "WHERE week_id = CAST(:w AS uuid)"), {"w": r.json()["ids"]["week"]}).one()
    assert d.session_date is None and d.form_of_the_day is None


def test_une_ligne_avec_les_VIDES_du_front_passe(monde):
    """Le pendant du précédent, sur les lignes d'exercice. L'arbre documentaire ne
    connaissait que la chaîne vide : `weightLocked: ''` pour un booléen,
    `repsUnit: ''` pour une colonne contrainte, `tier: ''` pour un entier. Vers des
    colonnes typées, chacun de ces trois fait un 500.

    Le PATCH d'une ligne est protégé par son modèle Pydantic ; ce chemin-ci reçoit
    un dictionnaire LIBRE, il nettoie donc lui-même."""
    bloc = _id(monde, "bloc", "p1")
    r = _client("coach-1").post(f"/programs/p1/blocks/{bloc}/weeks", headers=_AUTH, json={
        "sessions": [{"name": "L", "exercises": [{
            "name": "SQUAT", "weightLocked": "", "repsUnit": "", "incrementUnit": "",
            "tier": "", "kind": "", "variant": [], "sets": "5", "reps": "5"}]}]})
    assert r.status_code == 201
    e = monde.execute(text(
        "SELECT weight_locked, reps_unit, increment_unit, tier, kind, sets "
        "FROM training_exercises e JOIN training_sessions s ON s.id = e.session_id "
        "WHERE s.week_id = CAST(:w AS uuid)"), {"w": r.json()["ids"]["week"]}).one()
    assert (e.weight_locked, e.reps_unit, e.increment_unit, e.tier, e.kind, e.sets) \
        == (False, None, None, None, None, "5")


def test_le_verrou_de_charge_arrive_bien_a_TRUE(monde):
    """Et l'inverse : « true » (la chaîne, telle que Firestore la portait) doit
    donner un vrai booléen, sinon on perdrait 995 verrous en migrant."""
    bloc = _id(monde, "bloc", "p1")
    r = _client("coach-1").post(f"/programs/p1/blocks/{bloc}/weeks", headers=_AUTH, json={
        "sessions": [{"name": "L", "exercises": [{"name": "SQUAT", "weightLocked": "true"}]}]})
    verrou = monde.execute(text(
        "SELECT weight_locked FROM training_exercises e "
        "JOIN training_sessions s ON s.id = e.session_id "
        "WHERE s.week_id = CAST(:w AS uuid)"), {"w": r.json()["ids"]["week"]}).scalar()
    assert verrou is True


def test_une_ligne_sans_nom_est_ecartee_a_la_creation(monde):
    """Comme à l'ETL : une ligne vide laissée par l'éditeur n'est pas une ligne.

    ⚠️ ET LA BASE FAIT L'INVERSE DEPUIS LE 08/09, sans que ce soit une
    inconséquence — voir `test_la_BASE_garde_une_ligne_PAS_ENCORE_NOMMEE`. Ici on
    est en CHARGEMENT EN MASSE (duplication, semaine suivante, génération), où une
    ligne sans nom est bien un résidu. Là-bas, `PUT /base` n'a qu'un écrivain,
    l'éditeur, et sa ligne sans nom est celle que le coach vient d'ajouter.

    Sans cette spec, élargir `SANS_NOM_ACCEPTE` par symétrie passerait inaperçu —
    et chaque duplication ramènerait ses résidus."""
    bloc = _id(monde, "bloc", "p1")
    r = _client("coach-1").post(f"/programs/p1/blocks/{bloc}/weeks", headers=_AUTH, json={
        "sessions": [{"name": "L", "exercises": [{"name": "SQUAT"}, {"name": ""}]}]})
    n = monde.execute(text(
        "SELECT count(*) FROM training_exercises e JOIN training_sessions s ON s.id = e.session_id "
        "WHERE s.week_id = CAST(:w AS uuid)"), {"w": r.json()["ids"]["week"]}).scalar()
    assert n == 1


# --------------------------------------------------------------------------- #
# 3. La BASE et la cascade
# --------------------------------------------------------------------------- #

def test_remplacer_la_BASE(monde):
    """Remplacement intégral : c'est ce que fait l'éditeur, qui tient un brouillon
    complet. Un patch partiel obligerait à distinguer « absent » de « vidé » sur
    une structure imbriquée — la distinction que le deep-merge Firestore avait
    rendue traîtresse."""
    bloc = _id(monde, "bloc", "p1")
    r = _client("coach-1").put(f"/programs/p1/blocks/{bloc}/base", headers=_AUTH, json={"base": {
        "daySplit": [{"day": "J1", "tiers": {"SQUAT": 1}}],
        "granularity": {"SQUAT": "2,5"},
        "principles": [{"name": "SQUAT", "tier": 1, "variant": ["COMP"], "sets": "5"}],
        "accessories": [{"name": "CURL", "day": "J1", "sets": "3"}],
    }})
    assert r.status_code == 200
    p = monde.execute(text("SELECT name, variant, tier FROM training_base_principles "
                           "WHERE block_id = CAST(:b AS uuid)"), {"b": bloc}).one()
    assert (p.name, p.variant, p.tier) == ("SQUAT", ["COMP"], 1)
    g = monde.execute(text("SELECT granularity->>'SQUAT' FROM training_blocks "
                           "WHERE id = CAST(:b AS uuid)"), {"b": bloc}).scalar()
    assert g == "2,5"      # la virgule survit


def test_remplacer_la_BASE_efface_les_anciennes_lignes(monde):
    bloc = _id(monde, "bloc", "p1")
    c = _client("coach-1")
    c.put(f"/programs/p1/blocks/{bloc}/base",
          json={"base": {"principles": [{"name": "A", "tier": 1}]}}, headers=_AUTH)
    c.put(f"/programs/p1/blocks/{bloc}/base",
          json={"base": {"principles": [{"name": "B", "tier": 2}]}}, headers=_AUTH)
    noms = [r[0] for r in monde.execute(text(
        "SELECT name FROM training_base_principles WHERE block_id = CAST(:b AS uuid)"),
        {"b": bloc}).all()]
    assert noms == ["B"]


def test_la_BASE_garde_une_ligne_PAS_ENCORE_NOMMEE(monde):
    """⚠️ LE 200 QUI N'ÉCRIVAIT PAS — deux incidents de production pour la même
    cause. `inserer_ligne` écartait toute ligne sans nom : la route répondait 200
    et la trame ressortait SANS la ligne qu'on venait d'ajouter. Le front, lui,
    affichait la sienne — jusqu'à la première relecture, où elle disparaissait
    « toute seule, quelques centaines de millisecondes plus tard ».

    Les principes le 17/08 (FRE-119), les accessoires le 08/09 : ajouter un
    accessoire dans la BASE était devenu impossible, la ligne s'évaporait sous le
    curseur avant qu'on ait pu la nommer.

    Une ligne sans nom dans `PUT /base` n'est JAMAIS un résidu — l'éditeur est le
    seul écrivain de cette route, et il envoie le brouillon que le coach a sous
    les yeux. C'est « pas encore choisi », et c'est un état légitime.

    ⚠️ ET ELLE EST STOCKÉE À `NULL`, PAS À `''`. La colonne référence la
    bibliothèque (FRE-123) : `''` violerait la clé étrangère, donc 500. La lecture
    reconvertit en `''`, et le front ne voit aucune différence."""
    bloc = _id(monde, "bloc", "p1")
    r = _client("coach-1").put(f"/programs/p1/blocks/{bloc}/base", headers=_AUTH, json={"base": {
        "principles": [{"name": "", "tier": 1}],
        "accessories": [{"name": "", "day": "J1", "rest": "-1"}],
    }})
    assert r.status_code == 200
    for table in ("training_base_principles", "training_base_accessories"):
        lignes = monde.execute(text(
            f"SELECT name FROM {table} WHERE block_id = CAST(:b AS uuid)"), {"b": bloc}).all()
        assert len(lignes) == 1, f"{table} : le 200 n'a rien écrit"
        assert lignes[0].name is None, f"{table} : `''` au lieu de NULL — la clé étrangère refusera"


def test_la_BASE_re_date_les_semaines_du_bloc(monde):
    """FONCTIONNALITÉ PERDUE PUIS RETROUVÉE (15/08). Régler le début de S1 décale
    TOUTES les semaines du bloc, et l'éditeur envoie la trame et les dates dans la
    même requête pour qu'elles ne puissent pas diverger.

    En portant la route, j'avais omis `weekDates` : la re-datation avait
    silencieusement disparu, et seul un 422 sur le champ inconnu l'a révélé. Sans
    ce test, elle repartirait au prochain remaniement."""
    bloc = _id(monde, "bloc", "p1")
    semaines = [str(r[0]) for r in monde.execute(text(
        "SELECT id FROM training_weeks WHERE block_id = CAST(:b AS uuid) ORDER BY number"),
        {"b": bloc}).all()]
    r = _client("coach-1").put(f"/programs/p1/blocks/{bloc}/base", headers=_AUTH, json={
        "base": {"s1StartDate": "2026-09-07", "s1EndDate": "2026-09-13"},
        "weekDates": [
            {"weekId": semaines[0], "startDate": "2026-09-07", "endDate": "2026-09-13"},
            {"weekId": semaines[1], "startDate": "2026-09-14", "endDate": "2026-09-20"},
        ]})
    assert r.status_code == 200
    dates = monde.execute(text(
        "SELECT start_date::text FROM training_weeks WHERE block_id = CAST(:b AS uuid) "
        "ORDER BY number"), {"b": bloc}).scalars().all()
    assert dates == ["2026-09-07", "2026-09-14"]


def test_re_dater_ne_touche_QUE_les_semaines_de_ce_bloc(monde):
    """Le `AND block_id` de la requête sert d'appartenance : une semaine d'un
    autre bloc, même désignée explicitement, n'est pas touchée."""
    bloc = _id(monde, "bloc", "p1")
    etrangere = str(monde.execute(text(
        "SELECT w.id FROM training_weeks w JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'p2' ORDER BY m.number, b.number, w.number LIMIT 1")).scalar())
    avant = monde.execute(text("SELECT start_date FROM training_weeks WHERE id = CAST(:w AS uuid)"),
                          {"w": etrangere}).scalar()
    _client("coach-1").put(f"/programs/p1/blocks/{bloc}/base", headers=_AUTH, json={
        "base": {}, "weekDates": [{"weekId": etrangere, "startDate": "2030-01-01"}]})
    apres = monde.execute(text("SELECT start_date FROM training_weeks WHERE id = CAST(:w AS uuid)"),
                          {"w": etrangere}).scalar()
    assert apres == avant


def test_supprimer_un_macro_emporte_tout(monde):
    """Ce qui remplace l'énumération Firestore par lots de 450 documents, son
    plafond anti-emballement et son comptage préalable : une cascade ne peut pas
    s'emballer, elle est bornée par les clés étrangères."""
    macro = _id(monde, "macro", "p1")
    assert _client("coach-1").delete(f"/programs/p1/macros/{macro}", headers=_AUTH).status_code == 200
    restants = monde.execute(text(
        "SELECT count(*) FROM training_exercises e "
        "JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id "
        "WHERE b.macro_id = CAST(:m AS uuid)"), {"m": macro}).scalar()
    assert restants == 0
    # …et l'AUTRE programme n'a pas bougé.
    assert monde.execute(text(
        "SELECT count(*) FROM training_macros WHERE program_id = 'p2'")).scalar() == 1


# --------------------------------------------------------------------------- #
# Séances
# --------------------------------------------------------------------------- #

def test_ajouter_puis_reordonner_les_seances(monde):
    semaine = _id(monde, "semaine", "p1")
    c = _client("coach-1")
    assert c.post(f"/programs/p1/weeks/{semaine}/sessions",
                  json={"name": "Mardi"}, headers=_AUTH).status_code == 201
    ids = [str(r[0]) for r in monde.execute(text(
        "SELECT id FROM training_sessions WHERE week_id = CAST(:w AS uuid) ORDER BY position"),
        {"w": semaine}).all()]
    assert c.put(f"/programs/p1/weeks/{semaine}/sessions/order",
                 json={"ids": list(reversed(ids))}, headers=_AUTH).status_code == 200
    apres = [str(r[0]) for r in monde.execute(text(
        "SELECT id FROM training_sessions WHERE week_id = CAST(:w AS uuid) ORDER BY position"),
        {"w": semaine}).all()]
    assert apres == list(reversed(ids))


def test_reordonner_refuse_une_liste_incomplete(monde):
    semaine = _id(monde, "semaine", "p1")
    c = _client("coach-1")
    c.post(f"/programs/p1/weeks/{semaine}/sessions", json={"name": "Mardi"}, headers=_AUTH)
    ids = [str(r[0]) for r in monde.execute(text(
        "SELECT id FROM training_sessions WHERE week_id = CAST(:w AS uuid)"), {"w": semaine}).all()]
    assert c.put(f"/programs/p1/weeks/{semaine}/sessions/order",
                 json={"ids": ids[:1]}, headers=_AUTH).status_code == 422


def test_supprimer_une_seance_ne_laisse_pas_de_trou(monde):
    semaine = _id(monde, "semaine", "p1")
    c = _client("coach-1")
    for nom in ("Mardi", "Mercredi"):
        c.post(f"/programs/p1/weeks/{semaine}/sessions", json={"name": nom}, headers=_AUTH)
    premiere = str(monde.execute(text(
        "SELECT id FROM training_sessions WHERE week_id = CAST(:w AS uuid) ORDER BY position"),
        {"w": semaine}).scalar())
    assert c.delete(f"/programs/p1/sessions/{premiere}", headers=_AUTH).status_code == 200
    positions = [r[0] for r in monde.execute(text(
        "SELECT position FROM training_sessions WHERE week_id = CAST(:w AS uuid) ORDER BY position"),
        {"w": semaine}).all()]
    assert positions == list(range(len(positions)))


# --------------------------------------------------------------------------- #
# Recompactage des numéros après suppression (macro / bloc / semaine)
#
# Le front renumérotait déjà en local aux trois niveaux après chaque suppression ;
# le serveur, non. On supprimait une semaine, l'arbre affichait 1, 2, 3 — et le
# rechargement remettait 2, 3, 4. Le geste existait pourtant déjà un niveau plus
# bas (`delete_session`, testé juste au-dessus).
# --------------------------------------------------------------------------- #

def _numeros(conn, table: str, parent_col: str, parent_id) -> list[int]:
    return [r[0] for r in conn.execute(text(
        f"SELECT number FROM {table} WHERE {parent_col} = :p ORDER BY number, legacy_id"),
        {"p": parent_id}).all()]


def _semaines_du_bloc(conn, block_id) -> list[int]:
    return _numeros(conn, "training_weeks", "block_id", block_id)


def _nouvelle_semaine(client, block_id: str, nom: str) -> str:
    r = client.post(f"/programs/p1/blocks/{block_id}/weeks", json={"name": nom}, headers=_AUTH)
    assert r.status_code == 201
    return r.json()["ids"]["week"]


def test_supprimer_une_semaine_recompacte_les_numeros(monde):
    """LE défaut rapporté par le coach : « les numéros de semaine changent tout
    seuls » — c'est-à-dire le front qui renumérote et la base qui ne suit pas."""
    bloc = _id(monde, "bloc", "p1", "ORDER BY b.number LIMIT 1")
    c = _client("coach-1")
    _nouvelle_semaine(c, bloc, "S3")
    assert _semaines_du_bloc(monde, bloc) == [1, 2, 3]

    milieu = str(monde.execute(text(
        "SELECT id FROM training_weeks WHERE block_id = CAST(:b AS uuid) AND number = 2"),
        {"b": bloc}).scalar())
    assert c.delete(f"/programs/p1/weeks/{milieu}", headers=_AUTH).status_code == 200
    assert _semaines_du_bloc(monde, bloc) == [1, 2]


def test_le_recompactage_NE_REORDONNE_PAS(monde):
    """Il ferme les trous, il ne rebat pas les cartes. `recompacter` trie sur
    `number, legacy_id` — exactement l'ordre des lectures : ce que le coach voyait
    avant, il le revoit après, aux numéros près."""
    bloc = _id(monde, "bloc", "p1", "ORDER BY b.number LIMIT 1")
    c = _client("coach-1")
    _nouvelle_semaine(c, bloc, "S3")
    _nouvelle_semaine(c, bloc, "S4")
    avant = [r[0] for r in monde.execute(text(
        "SELECT name FROM training_weeks WHERE block_id = CAST(:b AS uuid) "
        "ORDER BY number, legacy_id"), {"b": bloc}).all()]

    premiere = str(monde.execute(text(
        "SELECT id FROM training_weeks WHERE block_id = CAST(:b AS uuid) AND number = 1"),
        {"b": bloc}).scalar())
    assert c.delete(f"/programs/p1/weeks/{premiere}", headers=_AUTH).status_code == 200

    apres = [r[0] for r in monde.execute(text(
        "SELECT name FROM training_weeks WHERE block_id = CAST(:b AS uuid) "
        "ORDER BY number, legacy_id"), {"b": bloc}).all()]
    assert apres == avant[1:]          # l'ordre survit, seul le supprimé manque
    assert _semaines_du_bloc(monde, bloc) == [1, 2, 3]


def test_le_recompactage_est_borne_au_PARENT(monde):
    """Portée par parent, jamais globale : les semaines d'un AUTRE bloc gardent
    leurs numéros. Un id Firestore n'est pas unique entre programmes, et le numéro
    d'une semaine n'a de sens que dans SON bloc."""
    blocs = [str(r[0]) for r in monde.execute(text(
        "SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'p1' ORDER BY b.number")).all()]
    c = _client("coach-1")
    # Le bloc 2 de la fixture est vide : on lui donne trois semaines à lui.
    for nom in ("A", "B", "C"):
        _nouvelle_semaine(c, blocs[1], nom)
    assert _semaines_du_bloc(monde, blocs[1]) == [1, 2, 3]

    voisine = str(monde.execute(text(
        "SELECT id FROM training_weeks WHERE block_id = CAST(:b AS uuid) AND number = 1"),
        {"b": blocs[0]}).scalar())
    assert c.delete(f"/programs/p1/weeks/{voisine}", headers=_AUTH).status_code == 200
    assert _semaines_du_bloc(monde, blocs[1]) == [1, 2, 3]   # l'autre bloc intact


def test_supprimer_un_bloc_recompacte_les_numeros(monde):
    macro = _id(monde, "macro", "p1")
    c = _client("coach-1")
    assert c.post(f"/programs/p1/macros/{macro}/blocks", json={}, headers=_AUTH).status_code == 201
    assert _numeros(monde, "training_blocks", "macro_id", macro) == [1, 2, 3]

    milieu = str(monde.execute(text(
        "SELECT id FROM training_blocks WHERE macro_id = CAST(:m AS uuid) AND number = 2"),
        {"m": macro}).scalar())
    assert c.delete(f"/programs/p1/blocks/{milieu}", headers=_AUTH).status_code == 200
    assert _numeros(monde, "training_blocks", "macro_id", macro) == [1, 2]


def test_supprimer_un_macro_recompacte_les_numeros(monde):
    c = _client("coach-1")
    for nom in ("Deux", "Trois"):
        assert c.post("/programs/p1/macros", json={"name": nom}, headers=_AUTH).status_code == 201
    assert _numeros(monde, "training_macros", "program_id", "p1") == [1, 2, 3]

    premier = str(monde.execute(text(
        "SELECT id FROM training_macros WHERE program_id = 'p1' AND number = 1")).scalar())
    assert c.delete(f"/programs/p1/macros/{premier}", headers=_AUTH).status_code == 200
    assert _numeros(monde, "training_macros", "program_id", "p1") == [1, 2]
    # …et le programme voisin n'a pas été renuméroté au passage.
    assert _numeros(monde, "training_macros", "program_id", "p2") == [1]


def test_apres_recompactage_le_numero_suivant_ne_saute_pas(monde):
    """Le bénéfice qui n'est pas cosmétique : `_prochain_numero` rend `max + 1`,
    donc sur une base recompactée il rend enfin le numéro attendu. Sans
    recompactage, supprimer S2 sur 1-2-3 puis créer donnait S4."""
    bloc = _id(monde, "bloc", "p1", "ORDER BY b.number LIMIT 1")
    c = _client("coach-1")
    _nouvelle_semaine(c, bloc, "S3")
    milieu = str(monde.execute(text(
        "SELECT id FROM training_weeks WHERE block_id = CAST(:b AS uuid) AND number = 2"),
        {"b": bloc}).scalar())
    c.delete(f"/programs/p1/weeks/{milieu}", headers=_AUTH)

    neuve = _nouvelle_semaine(c, bloc, "S3 bis")
    numero = monde.execute(text(
        "SELECT number FROM training_weeks WHERE id = CAST(:w AS uuid)"), {"w": neuve}).scalar()
    assert numero == 3
    assert _semaines_du_bloc(monde, bloc) == [1, 2, 3]


def test_un_champ_inconnu_est_refuse(monde):
    """Contrat NEUF : `extra=\"forbid\"`. L'inverse du contrat de semaine, qui doit
    réécrire ce qu'il ne connaît pas sous peine de l'effacer de tout l'arbre."""
    macro = _id(monde, "macro", "p1")
    assert _client("coach-1").patch(f"/programs/p1/macros/{macro}",
                                    json={"couleur": "rouge"}, headers=_AUTH).status_code == 422


# --------------------------------------------------------------------------- #
# L'ordre des deux refus : appartenance AVANT périmètre des champs
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("niveau,chemin,patch", [
    ("semaine", "weeks", {"name": "Deload"}),
    ("seance", "sessions", {"name": "Jambes"}),
])
def test_un_objet_ETRANGER_rend_404_meme_sur_un_champ_reserve(monde, niveau, chemin, patch):
    """L'athlète de p1 vise un objet de p2, avec un champ réservé au coach.

    Deux refus possibles : 404 (l'objet ne lui appartient pas) et 403 (le champ
    ne lui est pas ouvert). Le module promet le 404 — « on ne confirme pas
    l'existence de ce qu'on n'a pas le droit de voir » — et le contrôle du
    périmètre passait AVANT celui de l'appartenance, donc rendait 403.

    Pas une fuite : la réponse ne dépendait pas de l'existence de l'objet, mais
    des champs envoyés, que l'appelant connaît déjà. Le défaut est qu'une règle
    énoncée en tête de module cessait d'être vraie."""
    etranger = _id(monde, niveau, "p2")
    r = _client("ath-1").patch(f"/programs/p1/{chemin}/{etranger}", json=patch, headers=_AUTH)
    assert r.status_code == 404, r.text


def test_le_champ_reserve_reste_refuse_sur_SON_propre_objet(monde):
    """Le pendant : l'inversion ne doit pas ouvrir le périmètre de l'athlète."""
    sien = _id(monde, "semaine", "p1")
    r = _client("ath-1").patch(f"/programs/p1/weeks/{sien}", json={"name": "Deload"}, headers=_AUTH)
    assert r.status_code == 403
    # ⚠️ LE CODE, PAS SEULEMENT LE STATUT (FRE-142) : c'est le périmètre par
    # champ qui refuse, pas l'appartenance — et le front affiche l'un ou l'autre.
    assert r.json()["code"] == "champs_reserves_au_staff"


# --------------------------------------------------------------------------- #
# DUPLIQUER UNE BASE — le chemin de création doit écrire ses LIGNES
# --------------------------------------------------------------------------- #

_BASE_DUPLIQUEE = {
    "daySplit": [{"day": "J1", "tiers": {"SQUAT": 1}}],
    "selectedPrincipaux": ["SQUAT"],
    "granularity": {"SQUAT": "2,5"},
    "principles": [{"name": "SQUAT", "tier": 1, "sets": "5", "reps": "5", "weight": "100"}],
    "accessories": [{"name": "LEG RAISE", "day": "J1", "sets": "3", "reps": "12"}],
}


def _base_lue(conn, block_id: str) -> tuple[int, int]:
    """(principes, accessoires) réellement stockés pour ce bloc."""
    return tuple(
        conn.execute(text(f"SELECT count(*) FROM {t} WHERE block_id = CAST(:b AS uuid)"),
                     {"b": block_id}).scalar()
        for t in ("training_base_principles", "training_base_accessories"))


def test_creer_un_macro_ECRIT_les_lignes_de_la_base_dupliquee(monde):
    """LE BUG DU 17/08, signalé par William : Aubin duplique un macro depuis un
    autre, et « la BASE n'a pas les principes ».

    `_creer_bloc` écrivait la CONFIGURATION du bloc — `day_split`,
    `selected_principals`, `granularity`, les dates S1 — et laissait tomber les
    LIGNES, sans erreur ni journal. `PUT /blocks/{id}/base` les écrit pourtant
    depuis toujours : deux chemins pour la même structure, un seul complet.

    ⚠️ La perte était SILENCIEUSE, et c'est ce qui la rendait coûteuse : le front
    affiche d'abord son clone optimiste (principes compris), puis le refetch le
    remplace par la vérité du serveur — qui n'en a pas. Le coach voit donc sa
    BASE se vider toute seule, sans savoir quand ni pourquoi."""
    r = _client("coach-1").post(
        "/programs/p1/macros",
        json={"name": "Dupliqué", "block": {"base": _BASE_DUPLIQUEE, "week": {"name": "S1"}}},
        headers=_AUTH)
    assert r.status_code == 201
    assert _base_lue(monde, r.json()["ids"]["block"]) == (1, 1)


def test_creer_un_BLOC_ECRIT_aussi_les_lignes(monde):
    """Même chemin (`_creer_bloc`), autre porte d'entrée : dupliquer un BLOC
    dans un macro existant. Les deux passent par la même fonction, donc les deux
    étaient cassés — et les deux doivent être couverts, sinon corriger l'un
    laisserait croire que l'autre l'est."""
    macro = _id(monde, "macro", "p1")
    r = _client("coach-1").post(
        f"/programs/p1/macros/{macro}/blocks",
        json={"name": "Bloc dupliqué", "base": _BASE_DUPLIQUEE},
        headers=_AUTH)
    assert r.status_code == 201
    assert _base_lue(monde, r.json()["ids"]["block"]) == (1, 1)


# --------------------------------------------------------------------------- #
# CE QU'UNE SUPPRESSION VA DÉTRUIRE (FRE-130)
#
# ⚠️ ON NE BLOQUE PAS, ON DIT. La revue proposait un 409 sur toute suppression
# portant du réalisé. Décision de William le 07/09 : « ça m'arrive de supprimer
# pour réajuster ». Le geste est légitime ; ce qui manquait n'était pas une
# barrière mais une PHRASE — le dialogue disait la même chose d'une semaine
# vierge et d'une semaine où l'athlète a saisi douze séances.
# --------------------------------------------------------------------------- #


def _ligne_realisee(conn, seance_id: str, nom: str = "SQUAT", rpe: str | None = "8",
                    position: int = 0) -> None:
    conn.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, sets, reps, felt_rpe) "
        "VALUES (CAST(:s AS uuid), :p, :n, '3', '5', :r)"),
        {"s": seance_id, "p": position, "n": nom, "r": rpe})


def test_le_compte_dit_ce_que_la_suppression_va_detruire(monde):
    """⚠️ EN SÉANCES, PAS EN CELLULES. Une séance de trois lignes réalisées est
    UNE séance : c'est le nombre qui parle au coach devant son dialogue."""
    # ⚠️ L'ÉCART, PAS UN ABSOLU : l'arbre de test porte déjà du réalisé, et une
    # spec qui figerait le total serait fausse à la première ligne ajoutée à la
    # fixture — pour une raison qui n'aurait rien à voir avec ce qu'elle teste.
    url = f"/programs/p1/realise/semaine/{_id(monde, 'semaine', 'p1')}"
    client = _client("coach-1")
    avant = client.get(url, headers=_AUTH).json()

    seance = _id(monde, "seance", "p1")
    for i in range(3):
        _ligne_realisee(monde, seance, position=10 + i)

    r = client.get(url, headers=_AUTH)
    assert r.status_code == 200
    assert r.json()["lignes"] == avant["lignes"] + 3, "trois lignes réalisées de plus"
    assert r.json()["seances"] == avant["seances"], "toutes dans la même séance"


def test_une_semaine_VIERGE_ne_compte_rien(monde):
    """Le cas courant de William — réajuster une semaine programmée. Le dialogue
    ne doit rien ajouter, donc pas de friction sur le geste normal."""
    url = f"/programs/p1/realise/semaine/{_id(monde, 'semaine', 'p1')}"
    client = _client("coach-1")
    avant = client.get(url, headers=_AUTH).json()

    _ligne_realisee(monde, _id(monde, "seance", "p1"), rpe=None, position=10)

    assert client.get(url, headers=_AUTH).json() == avant, \
        "une ligne PROGRAMMÉE n'ajoute rien au compte"


def test_le_compte_se_lit_AUX_QUATRE_NIVEAUX(monde):
    """Une route, quatre étages : la question est la même, seule la colonne de
    jointure change."""
    client = _client("coach-1")
    urls = {n: f"/programs/p1/realise/{n}/{_id(monde, n, 'p1')}"
            for n in ("macro", "bloc", "semaine", "seance")}
    avant = {n: client.get(u, headers=_AUTH).json()["lignes"] for n, u in urls.items()}

    _ligne_realisee(monde, _id(monde, "seance", "p1"), position=10)

    for niveau, url in urls.items():
        r = client.get(url, headers=_AUTH)
        assert r.status_code == 200, niveau
        assert r.json()["lignes"] == avant[niveau] + 1, niveau


def test_le_compte_d_un_AUTRE_programme_est_404(monde):
    """⚠️ SINON CE COMPTE DEVIENDRAIT UNE PORTE DÉROBÉE. « On ne confirme pas
    l'existence de ce qu'on n'a pas le droit de voir » — la règle de FRE-43,
    qui vaut pour une lecture de contenu comme pour une écriture."""
    # La semaine existe — mais dans le programme du COACH 2.
    autre = _id(monde, "semaine", "p2")
    r = _client("coach-1").get(f"/programs/p1/realise/semaine/{autre}", headers=_AUTH)
    assert r.status_code == 404


def test_la_suppression_JOURNALISE_ce_qu_elle_a_detruit(monde, caplog):
    """⚠️ COMPTÉ AVANT D'EFFACER, et c'est la seule fenêtre : après, la cascade a
    emporté la réponse. Le journal est le SEUL endroit où une suppression massive
    reste constatable — la récupération, elle, est un retour arrière complet de
    la base, pour tous les athlètes.

    Cette spec rougit si quelqu'un déplace le comptage après le DELETE : il
    rendrait alors zéro, ce qui a l'air d'un journal correct."""
    import logging
    semaine = _id(monde, "semaine", "p1")
    for i in range(2):
        _ligne_realisee(monde, _id(monde, "seance", "p1"), position=10 + i)

    with caplog.at_level(logging.INFO):
        r = _client("coach-1").delete(f"/programs/p1/weeks/{semaine}", headers=_AUTH)
    assert r.status_code == 200

    # ⚠️ SUR LES ATTRIBUTS DU RECORD, PAS SUR LE TEXTE. Le formateur JSON n'est
    # pas branché sous pytest : lire `caplog.messages` rendrait la liste vide, et
    # la spec passerait pour de mauvaises raisons le jour où l'assertion serait
    # écrite en « au moins un ». C'est la façon dont `test_audit.py` lit déjà.
    audits = [r.audit_fields for r in caplog.records
              if getattr(r, "audit_fields", {}).get("resource") == "training_week"]
    assert audits, "la suppression doit émettre une ligne d'audit"
    assert audits[-1].get("count", 0) >= 2, \
        f"et cette ligne doit porter ce qui a été détruit ({audits[-1]})"


# --------------------------------------------------------------------------- #
# DEUX ENFANTS D'UN MÊME PARENT NE PORTENT PLUS LE MÊME NUMÉRO (FRE-134)
# --------------------------------------------------------------------------- #

def test_la_BASE_refuse_deux_semaines_de_meme_numero(monde):
    """⚠️ LE DOUBLON ÉTAIT MUET. `prochain_numero` rend `max + 1` : deux créations
    simultanées lisent le même maximum et s'insèrent toutes les deux. C'est la
    cause de FRE-59, dont on n'avait corrigé que les effets — et le Tracking
    fusionne ensuite sur `(week_number, session_index)`.

    Le contrat Pydantic ne garde rien ici : le numéro ne vient pas du client."""
    from sqlalchemy.exc import IntegrityError

    bloc = _id(monde, "bloc", "p1")
    existante = monde.execute(text(
        "SELECT number FROM training_weeks WHERE block_id = CAST(:b AS uuid) LIMIT 1"),
        {"b": bloc}).scalar()
    with pytest.raises(IntegrityError):
        monde.execute(text(
            "INSERT INTO training_weeks (block_id, legacy_id, number) "
            "VALUES (CAST(:b AS uuid), 'doublon', :n)"), {"b": bloc, "n": existante})


def test_le_RECOMPACTAGE_traverse_un_etat_a_doublon_sans_echouer(monde):
    """⚠️ LA MOITIÉ QUI REND LA GARDE TENABLE. `recompacter` renumérote 1..n d'un
    seul `UPDATE` : fermer le trou de 2,3 vers 1,2 descend une ligne sur un
    numéro que l'autre porte encore. Une contrainte ORDINAIRE refuserait — elle
    ferait échouer le geste qui EMPÊCHE les doublons, et une garde qui casse une
    suppression de semaine serait retirée dans la semaine.

    C'est le mot `DEFERRABLE` qui sauve, et lui seul : une contrainte déclarée
    déférable est vérifiée en FIN D'INSTRUCTION même en mode `IMMEDIATE`. Aucun
    `SET CONSTRAINTS` n'est nécessaire — il y en avait un, la mutation l'a montré
    inutile (09/09)."""
    from app.entrainement.metier_training_structure import recompacter

    bloc = _id(monde, "bloc", "p1")
    monde.execute(text("DELETE FROM training_weeks WHERE block_id = CAST(:b AS uuid)"),
                  {"b": bloc})
    # ⚠️ L'ORDRE D'INSERTION FAIT LA SPEC. `UPDATE … FROM` parcourt le tas dans
    # l'ordre PHYSIQUE, donc l'ordre d'écriture : en insérant 3 PUIS 2, le moteur
    # descend 3 vers 2 alors que l'autre ligne porte encore 2. Insérées dans
    # l'autre sens, les lignes libèrent leur numéro avant qu'on le reprenne et la
    # spec passe même sans la garde — vu vert le 09/09 sur une première version.
    for numero in (3, 2):
        monde.execute(text(
            "INSERT INTO training_weeks (block_id, legacy_id, number) "
            "VALUES (CAST(:b AS uuid), :l, :n)"),
            {"b": bloc, "l": f"s{numero}", "n": numero})

    recompacter(monde, "semaine", bloc)
    assert [r[0] for r in monde.execute(text(
        "SELECT number FROM training_weeks WHERE block_id = CAST(:b AS uuid) "
        "ORDER BY number"), {"b": bloc})] == [1, 2]


def test_une_creation_qui_PERD_la_course_reessaie_et_passe(monde):
    """⚠️ LE RÉESSAI, ET C'EST LUI QUI REND LA CONTRAINTE ACCEPTABLE. Sans lui, le
    perdant d'un double clic recevrait un 500 là où il ne fait rien de mal.

    On simule la course en prenant le numéro sous ses pieds : le premier appel de
    `prochain_numero` rend N, quelqu'un insère N entre-temps, l'insertion échoue,
    et la seconde tentative relit un maximum qui a bougé."""
    from app.entrainement import arbre_creation

    bloc = _id(monde, "bloc", "p1")
    vrai = arbre_creation.prochain_numero
    appels = {"n": 0}

    def voleur(conn, table, parent_col, parent_id):
        numero = vrai(conn, table, parent_col, parent_id)
        appels["n"] += 1
        if appels["n"] == 1 and table == "training_weeks":
            # Le concurrent gagne la course et prend le numéro.
            conn.execute(text(
                "INSERT INTO training_weeks (block_id, legacy_id, number) "
                "VALUES (CAST(:b AS uuid), 'concurrent', :n)"), {"b": parent_id, "n": numero})
        return numero

    arbre_creation.prochain_numero = voleur
    try:
        r = _client("coach-1").post(f"/programs/p1/blocks/{bloc}/weeks",
                                    json={"sessions": []}, headers=_AUTH)
    finally:
        arbre_creation.prochain_numero = vrai

    assert r.status_code == 201, r.text[:300]
    numeros = [x[0] for x in monde.execute(text(
        "SELECT number FROM training_weeks WHERE block_id = CAST(:b AS uuid) ORDER BY number"),
        {"b": bloc})]
    assert len(numeros) == len(set(numeros)), f"des doublons subsistent : {numeros}"


# --------------------------------------------------------------------------- #
# L'IDENTITÉ CHOISIE PAR LE CLIENT — une création REJOUABLE (25/09)
# --------------------------------------------------------------------------- #
#
# ⚠️ CE QUE CES TESTS GARDENT : la file hors ligne du front rejoue un `POST` au
# retour du réseau. Sans identité, chaque rejeu fabriquait un objet de plus, et
# personne ne saurait dire lequel garder. Avec elle, le second envoi RETROUVE
# le premier objet — et un id qui désigne un objet d'un autre parent est refusé.

_ID_BLOC = "aaaaaaaa-0000-4000-8000-000000000001"
_ID_MACRO = "aaaaaaaa-0000-4000-8000-000000000002"
_ID_SEANCE = "aaaaaaaa-0000-4000-8000-000000000003"


def _compter(conn, table: str, colonne: str, valeur) -> int:
    return conn.execute(text(f"SELECT count(*) FROM {table} WHERE {colonne} = :v"),
                        {"v": valeur}).scalar()


def test_un_bloc_cree_avec_son_identite_la_garde(monde):
    macro = _id(monde, "macro", "p1")
    r = _client("coach-1").post(f"/programs/p1/macros/{macro}/blocks",
                                json={"id": _ID_BLOC, "name": "Force"}, headers=_AUTH)
    assert r.status_code == 201
    assert r.json()["ids"]["block"] == _ID_BLOC


def test_rejouer_la_creation_d_un_bloc_ne_le_cree_pas_deux_fois(monde):
    macro = _id(monde, "macro", "p1")
    avant = _compter(monde, "training_blocks", "macro_id", macro)
    corps = {"id": _ID_BLOC, "base": {"principles": [{"name": "SQUAT", "tier": 1}]}}
    c = _client("coach-1")
    assert c.post(f"/programs/p1/macros/{macro}/blocks", json=corps, headers=_AUTH).status_code == 201
    r = c.post(f"/programs/p1/macros/{macro}/blocks", json=corps, headers=_AUTH)
    assert r.status_code == 201
    assert r.json()["ids"]["block"] == _ID_BLOC
    assert _compter(monde, "training_blocks", "macro_id", macro) == avant + 1
    # Et pas ses lignes de trame non plus : un rejeu ne réécrit rien.
    assert _compter(monde, "training_base_principles", "block_id", _ID_BLOC) == 1


def test_une_identite_qui_designe_un_objet_d_un_AUTRE_parent_est_refusee(monde):
    """Un client ne se sert pas d'un id pour écrire là où il n'a rien créé."""
    c = _client("coach-1")
    macro = _id(monde, "macro", "p1")
    assert c.post(f"/programs/p1/macros/{macro}/blocks", json={"id": _ID_BLOC}, headers=_AUTH).status_code == 201
    # Un second macro dans le même programme : le bloc existe, mais pas sous lui.
    autre = c.post("/programs/p1/macros", json={"block": {}}, headers=_AUTH).json()["ids"]["macro"]
    r = c.post(f"/programs/p1/macros/{autre}/blocks", json={"id": _ID_BLOC}, headers=_AUTH)
    assert r.status_code == 409
    assert r.json()["code"] == "identifiant_pris"


def test_rejouer_la_creation_d_un_macro_retrouve_le_macro_ET_son_bloc(monde):
    avant = _compter(monde, "training_macros", "program_id", "p1")
    corps = {"id": _ID_MACRO, "block": {"id": _ID_BLOC}}
    c = _client("coach-1")
    premier = c.post("/programs/p1/macros", json=corps, headers=_AUTH)
    second = c.post("/programs/p1/macros", json=corps, headers=_AUTH)
    assert premier.status_code == second.status_code == 201
    assert premier.json()["ids"] == second.json()["ids"] == {"macro": _ID_MACRO, "block": _ID_BLOC}
    assert _compter(monde, "training_macros", "program_id", "p1") == avant + 1
    assert _compter(monde, "training_blocks", "macro_id", _ID_MACRO) == 1


def test_un_macro_rejoue_SANS_identite_de_bloc_ne_gagne_pas_un_bloc(monde):
    c = _client("coach-1")
    corps = {"id": _ID_MACRO, "block": {}}
    c.post("/programs/p1/macros", json=corps, headers=_AUTH)
    c.post("/programs/p1/macros", json=corps, headers=_AUTH)
    assert _compter(monde, "training_blocks", "macro_id", _ID_MACRO) == 1


def test_rejouer_la_creation_d_une_seance_ne_la_cree_pas_deux_fois(monde):
    semaine = _id(monde, "semaine", "p1")
    avant = _compter(monde, "training_sessions", "week_id", semaine)
    corps = {"id": _ID_SEANCE, "name": "Jeudi"}
    c = _client("coach-1")
    premier = c.post(f"/programs/p1/weeks/{semaine}/sessions", json=corps, headers=_AUTH)
    second = c.post(f"/programs/p1/weeks/{semaine}/sessions", json=corps, headers=_AUTH)
    assert premier.status_code == second.status_code == 201
    assert premier.json()["id"] == second.json()["id"] == _ID_SEANCE
    assert _compter(monde, "training_sessions", "week_id", semaine) == avant + 1
