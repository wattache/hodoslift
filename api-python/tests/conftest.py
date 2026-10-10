"""Configuration pytest : neutralise firebase_admin AVANT tout import de app.*.

`app/socle/firebase_admin_app.py` initialise le SDK Admin au moment de l'import — ce
qui résoudrait les Application Default Credentials. On le neutralise donc en
mémoire avant d'importer quoi que ce soit du package `app`, pour que les tests
soient hermétiques : pas de réseau, pas d'identifiants.

⚠️ CE FICHIER PORTAIT UN FAUX FIRESTORE COMPLET — 150 lignes, deep-merge,
`update`, `NotFound` — et une fixture `store` que 25 fichiers de tests
traînaient dans leur signature. Il n'éprouvait plus rien : mesuré en le faisant
LEVER plutôt qu'en le supposant mort, la suite entière est restée verte.

Ce qui l'a remplacé tient en une exception, et garde davantage : voir
`_firestore_interdit`.
"""

import firebase_admin
from firebase_admin import firestore as _fb_firestore


firebase_admin.initialize_app = lambda *a, **k: None


def _firestore_interdit(*a, **k):
    """⚠️ LA GARDE QUI A REMPLACÉ LE FAUX MAGASIN (26/08).

    Il y avait ici un `FakeStore` complet — deep-merge, `update`, `NotFound` —
    et une fixture `store` que 25 fichiers de tests traînaient dans leur
    signature. Il n'éprouvait plus rien : mesuré en le faisant LEVER, les 1 079
    tests sont passés au vert. Aucune ligne du produit n'appelle plus
    `firestore.client()`.

    Ce qui le remplace est plus court et plus fort. Trois tests affirmaient
    localement « rien n'a été écrit dans Firestore » en relisant le faux
    magasin ; désormais c'est la SUITE ENTIÈRE qui l'affirme, pour tout le code,
    y compris celui qu'on écrira demain.

    ⚠️ ET CE N'EST PAS DE LA DÉCORATION : la base existe toujours (gelée et
    verrouillée, FRE-72). Un `firestore.client()` réintroduit par distraction
    écrirait dans un magasin que plus rien ne lit — une perte silencieuse, la
    pire espèce. Il fait rougir la suite à la place.
    """
    raise AssertionError(
        "firestore.client() appelé : du code parle encore à Firestore. "
        "brokkr n'y touche plus depuis le 20/08 — cf. FRE-72."
    )


_fb_firestore.client = _firestore_interdit

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

import app.socle.db as db_mod  # noqa: E402
from app.socle.auth import verify_token  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def auth_as():
    def _factory(uid: str = "uid-1", email: str = "a@b.c", **extra_claims) -> TestClient:
        app.dependency_overrides[verify_token] = lambda: {"uid": uid, "email": email, **extra_claims}
        return TestClient(app)

    yield _factory
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _overrides_propres():
    """⚠️ CHAQUE TEST REPART SANS FAUX JETON, QUOI QU'AIT FAIT LE PRÉCÉDENT (FRE-142).

    Quinze fichiers posent `app.dependency_overrides[verify_token]` dans leur
    propre `_client()` sans jamais le retirer — et le test suivant en héritait.
    `test_auth.py` attendait un 401 sur un client nu et l'obtenait par ORDRE
    ALPHABÉTIQUE : `pytest tests/test_aller_retour.py tests/test_auth.py` donnait
    3 rouges (mesuré le 09/09).

    Nettoyer ici plutôt que dans les quinze fichiers : le seizième arrivera par
    recopie, comme les quinze premiers, et ne saura pas qu'il aurait dû nettoyer.
    La preuve que ça tient est dans `test_harnais.py`, par ordre de définition."""
    yield
    app.dependency_overrides.clear()


def _postgres_sans_fixture(*a, **k):
    """⚠️ SANS LA FIXTURE `pg`, `get_engine()` LIT `brokkr/.env` — C'EST NEON.

    Un test qui traverse l'application sans demander `pg` (ou `sql`) parle à la
    PRODUCTION : trois tests l'ont fait le 27/09, sauvés par un 500 qui a annulé
    leur transaction. Ici, il rougit avant d'ouvrir une connexion. `pg` remplace
    cette garde par sa Connection, et elle seule."""
    raise AssertionError(
        "get_engine() appelé sans la fixture `pg` : ce test parlerait à la base "
        "de `.env`. Demande `pg` (ou `sql`) dans sa signature."
    )


@pytest.fixture(autouse=True)
def _jamais_la_base_de_env(monkeypatch):
    monkeypatch.setattr(db_mod, "get_engine", _postgres_sans_fixture)


# --------------------------------------------------------------------------- #
# Postgres RÉEL (testcontainers) — préparation FRE-12
#
# Les chemins SQL historiques sont testés sur SQLite in-memory, et le SQL réel
# est vérifié À LA MAIN contre Neon dans une transaction annulée. C'est cette
# étape manuelle qui a rattrapé le stub `users` de la FK d'identité, invisible
# en SQLite ; elle ne tiendra pas sur la migration de l'entraînement.
#
# Les tests SQLite ne sont PAS réécrits : ils basculent au fur et à mesure qu'on
# y touche. Les deux dispositifs cohabitent (`sql` = SQLite, `pg` = le vrai).
# --------------------------------------------------------------------------- #

_SCHEMA_SQL = Path(__file__).resolve().parent.parent / "docs" / "postgres-schema.sql"


@pytest.fixture(scope="session")
def pg_engine():
    """Un Postgres 16 — LA VERSION DE NEON, c'est tout l'intérêt — démarré une
    seule fois pour la session, dont le schéma est créé DEPUIS
    `docs/postgres-schema.sql`.

    Appliquer ce fichier plutôt que de recopier des `CREATE TABLE` dans les tests
    n'est pas un détail d'implémentation : il est posé À LA MAIN sur Neon, et
    rien ne garantissait jusqu'ici qu'il décrive encore la vraie base. Exécuté
    par la suite, sa dérive devient un test rouge.

    PÉRIMÈTRE : le conteneur est VIDE en dehors du schéma. Aucune donnée n'y est
    chargée, ni depuis Neon ni depuis Firestore — chaque test sème ce dont il a
    besoin, comme le font déjà les tests SQLite. La base de travail chargée d'une
    copie réelle (pour rejouer l'ETL et comparer les comptes) est un AUTRE outil,
    monté séparément : ne pas alimenter les tests avec.

    L'import de testcontainers est fait DANS la fixture : les ~550 tests
    hermétiques ne paient ni l'import, ni le démarrage du conteneur (pytest
    n'instancie une fixture que si un test la demande)."""
    from testcontainers.community.postgres import PostgresContainer

    with PostgresContainer("postgres:16", driver="psycopg") as container:
        engine = create_engine(container.get_connection_url())
        with engine.begin() as conn:
            # Curseur psycopg BRUT plutôt que `exec_driver_sql` : ce dernier passe
            # un tuple de paramètres vide, ce qui suffit à déclencher l'analyse des
            # placeholders côté client — et le fichier contient des `%` dans ses
            # COMMENTAIRES (« les % d'incrément »), que psycopg lit alors comme un
            # placeholder tronqué. Sans paramètres à lier, on court-circuite.
            conn.connection.driver_connection.execute(
                _SCHEMA_SQL.read_text(encoding="utf-8")
            )
            # ⚠️ LES BORNES DE SESSION AUSSI, ET C'EST UNE LEÇON PAYÉE CHER. Elles
            # ne vivent pas dans le schéma mais sur le RÔLE (`ALTER ROLE … SET`,
            # FRE-135), parce que le pooler de Neon refuse le paramètre `options` à
            # l'ouverture — la production est tombée le 08/09 pour l'avoir ignoré.
            #
            # Les poser ici sert deux choses : l'invariant `bornes_de_session` peut
            # être éprouvé comme les autres, et pytest tourne avec les MÊMES bornes
            # que la production, plutôt qu'avec un Postgres nu qui ne ressemble à
            # aucun environnement réel.
            for reglage, valeur in (("statement_timeout", "15s"),
                                    ("lock_timeout", "5s"),
                                    ("timezone", "Europe/Paris")):
                conn.connection.driver_connection.execute(
                    f"ALTER ROLE CURRENT_USER SET {reglage} = '{valeur}'")
        # ⚠️ ET ON JETTE LE POOL : un défaut de rôle n'est appliqué qu'à
        # l'OUVERTURE d'un backend. La connexion qui vient de poser l'`ALTER ROLE`
        # ne les a pas, et le pool la rendrait telle quelle au premier test —
        # `current_setting` y verrait encore les valeurs d'origine.
        engine.dispose()
        try:
            yield engine
        finally:
            engine.dispose()


# ⚠️ LA BIBLIOTHÈQUE EST UN RÉFÉRENTIEL, PAS UNE DONNÉE DE TEST (FRE-123).
#
# Le principe de `pg_engine` reste : « le conteneur est VIDE en dehors du
# schéma ». Mais depuis que `training_exercises.name` RÉFÉRENCE
# `library_entries`, un exercice ne peut plus exister sans son entrée — au même
# titre qu'une séance ne peut pas exister sans sa semaine. Ce n'est donc plus
# une donnée que le test choisit, c'est une précondition qu'il subit, et la
# semer dans chaque fixture aurait recopié la même liste à cent endroits.
#
# ⚠️ VOLONTAIREMENT COURTE, ET SANS `SQUAT 1` NI `squat`. Ces deux-là sont des
# valeurs de test délibérées — un nom hors référentiel, un autre en minuscules —
# et les semer ferait passer au vert des specs qui vérifient précisément qu'on
# les REFUSE.
_MOUVEMENTS_DE_TEST = (
    # Les vrais mouvements, ceux que la production porte aussi.
    # ⚠️ PAS de « BACK SQUAT » : c'est la CIBLE du test de cascade
    # (`test_RENOMMER_le_mouvement…`). Le semer ici ferait échouer le
    # renommage sur une collision d'unicité, et la spec échouerait pour une
    # raison qui n'est pas la sienne.
    "SQUAT", "PULL UP", "CHIN UP", "DIPS", "MUSCLE UP",
    "CURL", "CURL BICEPS", "EXTENSION TRICEPS", "ROWING", "FACE PULL",
    "SHRUG", "LEG RAISE", "STRAIGHT LEG RAISE", "LEG CURL",
    "BACK EXTENSION", "CHINESE PLANK", "BAND PULL APART",
    # Et les repères que les fixtures se donnent pour distinguer deux lignes
    # (« S1 » / « S2 », « COPIE »…). Ils n'ont rien de réaliste, mais les
    # fixtures les ÉCRIVENT comme noms d'exercice : depuis FRE-123 la
    # bibliothèque précède la ligne, donc ils doivent exister ici aussi.
    "AUTRE CHOSE", "COPIE", "EMOM", "EXO", "EXTENSION", "HACK", "PONT",
    "S1", "S2", "S4", "S5", "TRICEPS", "REVERSE FLY", "SQUAT 1", "SQUAT 2",
    "CURL 1", "A", "B",
    # Les objectifs d'athlète nomment leurs mouvements en casse libre dans
    # les fixtures. La production, elle, ne porte que des noms canoniques
    # (mesuré : zéro écart) — mais la clé étrangère est sensible à la casse,
    # donc ces graphies-là doivent exister pour que les specs tiennent.
    "Squat", "Bench", "Deadlift", "Front Squat",
    "Fuite A", "Fuite B", "Fuite C", "Le mien", "Premier", "Second",
    "CURL 2", "C",
)


# ⚠️ LES SEPT LIFTS DE COMPÉTITION PORTENT LEUR DRAPEAU, comme en production
#    (FRE-147). La fixture sème « les vrais mouvements » depuis toujours, mais
#    tous à `competition = false` : une règle branchée sur ce drapeau — les
#    records manuels, les mouvements disputés, les séries par lift de FRE-148 —
#    s'éprouvait donc sur une bibliothèque où AUCUN lift n'en est un. Les specs
#    qui ont besoin de l'inverse posent déjà le drapeau elles-mêmes (`test_prs`,
#    `test_competitions`, `test_library`), avec un `DO UPDATE` qui gagne.
_LIFTS_DE_COMPETITION = (
    "SQUAT", "PULL UP", "CHIN UP", "DIPS", "MUSCLE UP", "BENCH PRESS", "DEADLIFT",
)


def _semer_la_bibliotheque(conn) -> None:
    conn.execute(text(
        "INSERT INTO library_entries (category, name) "
        "SELECT 'exercices', x FROM unnest(CAST(:n AS text[])) AS x "
        "ON CONFLICT DO NOTHING"), {"n": list(_MOUVEMENTS_DE_TEST)})
    conn.execute(text(
        "INSERT INTO library_entries (category, name, competition) "
        "SELECT 'exercices', x, true FROM unnest(CAST(:n AS text[])) AS x "
        "ON CONFLICT (structure, category, name) DO UPDATE SET competition = true"),
        {"n": list(_LIFTS_DE_COMPETITION)})


@pytest.fixture
def pg(pg_engine, monkeypatch, request):
    """Isolation par TRANSACTION ANNULÉE : le test travaille dans une transaction
    ouverte ici et annulée à la sortie. Pas de recréation de base ni de TRUNCATE
    entre les tests — c'est ce qui rend le dispositif assez rapide pour la suite.

    `get_engine` est monkeypatché pour rendre CETTE Connection, pas un Engine :
    `get_session()` fait `Session(get_engine())`, et SQLAlchemy accepte de lier
    une Session à une Connection déjà en transaction.

    Le SAVEPOINT ouvert ici n'est pas cosmétique. `join_transaction_mode` vaut
    "conditional_savepoint" par défaut : il ne choisit "create_savepoint" que si
    la Connection est DÉJÀ dans une transaction imbriquée, et retombe sinon sur
    "rollback_only" — auquel cas le premier rollback applicatif (une contrainte
    violée rendue en 409, cas que ces tests couvrent justement) emporterait la
    transaction du test entier. Avec le savepoint, chaque session applicative
    pose le SIEN : son commit comme son rollback restent chez elle.

    La fixture rend la Connection : semer et vérifier se font dessus
    (`pg.execute(text(...))`), et non via `engine.begin()` — on ne veut surtout
    pas d'une seconde connexion, qui ne verrait rien de la transaction en cours.

    ⚠️ NE PAS AJOUTER `monkeypatch.setattr(db_mod, "get_session", …)` DANS UN
    TEST. Ça ne fait RIEN, et ça se lit pourtant comme le mécanisme d'isolation.

    La raison est mécanique : les 22 modules de `app/` font
    `from ..db import get_session`, donc leur liaison est FIGÉE À L'IMPORT —
    aucun n'y accède par attribut. Remplacer l'attribut sur le module `db` après
    coup n'intercepte donc rien. Ce qui isole est le `get_engine` patché deux
    lignes plus bas, et lui seul.

    ⚠️ ET CE N'EST PAS UNE MISE EN GARDE THÉORIQUE. Signalé le 17/08 dans 3
    fichiers (FRE-60) et laissé en place, le motif s'était propagé à **14** au
    27/08 — par recopie, chaque auteur le prenant pour un rouage nécessaire.
    Retiré partout ce jour-là : 1 145 tests toujours verts, ce qui est la preuve
    qu'il ne servait à rien.

    ⚠️ AUTRE PIÈGE DE LA MÊME FAMILLE, sur les requêtes de test : un `LIMIT 1`
    SANS `ORDER BY` ne désigne rien. Il rend la ligne que Postgres scanne en
    premier, c'est-à-dire l'ordre PHYSIQUE du tas, qui dépend de ce que les tests
    précédents ont écrit et annulé. Un test a déjà cessé de vérifier ce qu'il
    annonçait à cause de ça — sans changer d'une ligne, simplement parce qu'on
    avait ajouté des tests dans un fichier sans rapport."""
    conn = pg_engine.connect()
    outer = conn.begin()
    conn.begin_nested()
    # ⚠️ SAUF POUR `test_library`, ET C'EST LA SEULE EXCEPTION. Ce fichier teste
    # la bibliothèque ELLE-MÊME : il y renomme des entrées, en compte, en refuse
    # en double. Un référentiel semé sous ses pieds ferait échouer ses specs sur
    # des collisions qui n'ont rien à voir avec ce qu'elles vérifient — et pire,
    # il n'insère aucune ligne d'exercice, donc il n'en a aucun besoin.
    if request.module.__name__ != "tests.test_library":
        _semer_la_bibliotheque(conn)
    monkeypatch.setattr(db_mod, "get_engine", lambda: conn)
    try:
        yield conn
    finally:
        outer.rollback()
        conn.close()


# --------------------------------------------------------------------------- #
# L'APPARTENANCE, pour les stubs SQLite hermétiques
# --------------------------------------------------------------------------- #

# ⚠️ `TABLES_APPARTENANCE` A VÉCU UNE JOURNÉE. Elle donnait aux stubs SQLite les
# quatre tables que lit `est_membre` ; les stubs ayant tous basculé sur le vrai
# Postgres (FRE-80), le schéma les porte et la liste n'a plus d'objet. Retirée
# plutôt que gardée « au cas où » : une constante que rien n'utilise redevient
# vraie par accident.


def semer_un_membre(engine_ou_conn, uid: str, role: str = "coaches") -> None:
    """Rattache `uid` au club — le minimum pour franchir `require_membre`.

    ⚠️ LA LIGNE `users` D'ABORD. `coaches.uid` et `kines.uid` sont des FK vers
    `users(uid)` : sur le vrai Postgres, semer un coach sans son utilisateur
    part en `ForeignKeyViolation`. Les stubs SQLite ne déclaraient pas ces FK et
    ne l'ont jamais dit — un de ces mensonges que la bascule sur Postgres (FRE-80)
    a rendus visibles."""
    # IDEMPOTENT dans les trois cas : ces semis se croisent (un test sème un
    # coach, puis une entrée de biblio qui sème son créateur — le même). Un
    # doublon n'est pas une erreur du test, c'est le déroulé normal.
    utilisateur = ("INSERT INTO users (uid, email) VALUES (:u, :u) "
                   "ON CONFLICT (uid) DO NOTHING")
    ordres = {
        "coaches": [utilisateur,
                    "INSERT INTO coaches (uid) VALUES (:u) ON CONFLICT (uid) DO NOTHING"],
        "kines": [utilisateur,
                  "INSERT INTO kines (uid) VALUES (:u) ON CONFLICT (uid) DO NOTHING"],
        # ⚠️ UN ATHLÈTE A BESOIN D'UN COACH : `athletes.coach_uid` est NOT NULL et
        # référence `coaches`. Le stub SQLite l'ignorait ; le vrai schéma non.
        "athletes": [utilisateur,
                     "INSERT INTO users (uid, email) VALUES (:u || '-coach', :u) "
                     "ON CONFLICT (uid) DO NOTHING",
                     "INSERT INTO coaches (uid) VALUES (:u || '-coach') "
                     "ON CONFLICT (uid) DO NOTHING",
                     "INSERT INTO athletes (legacy_id, coach_uid, user_uid) "
                     "VALUES (:u || '-fiche', :u || '-coach', :u) "
                     "ON CONFLICT (legacy_id) DO NOTHING"],
    }[role]
    # ⚠️ `hasattr(x, "connect")` NE DISTINGUE PAS les deux : une `Connection` en a
    # une aussi. Il faut le type — sinon on ouvre un `begin()` sur une connexion
    # déjà en transaction (celle de la fixture `pg`), et SQLAlchemy refuse.
    from sqlalchemy import Engine

    if isinstance(engine_ou_conn, Engine):
        with engine_ou_conn.begin() as c:
            for o in ordres:
                c.execute(text(o), {"u": uid})
    else:                                          # une Connection déjà ouverte
        for o in ordres:
            engine_ou_conn.execute(text(o), {"u": uid})


# --------------------------------------------------------------------------- #
# Deux terrains de jeu PARTAGÉS entre modules. Ici, et pas importés d'un module
# de test : un nom importé puis repris en paramètre est une « redéfinition »
# pour ruff (F811), et pytest trouve une fixture de conftest sans import.
# --------------------------------------------------------------------------- #

#: L'athlète a1 de `sql`.
A1 = "aaaaaaaa-1111-1111-1111-111111111111"


@pytest.fixture
def sql(pg):
    """athlète a1 : géré par coach-1, lié à uid-1. Semé, pas chargé."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES "
                    "('coach-1','c@x.fr'), ('uid-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name, user_uid) "
        "VALUES (CAST(:id AS uuid), 'a1', 'coach-1', 'A', 'Un', 'uid-1')"), {"id": A1})
    return pg


@pytest.fixture
def monde(pg):
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','coach-1','A')"))
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
        "('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    macro = pg.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number, name) "
        "VALUES ('p1', 'm1', 1, 'M1') RETURNING id")).scalar()
    bloc = pg.execute(text(
        "INSERT INTO training_blocks (macro_id, legacy_id, number, name) "
        "VALUES (:m, 'b1', 1, 'B1') RETURNING id"), {"m": macro}).scalar()
    return {"pg": pg, "bloc": str(bloc)}
