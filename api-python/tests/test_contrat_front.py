"""Les payloads que le FRONT envoie réellement, passés aux contrats de brokkr.

Le trou que ces tests bouchent est celui que la revue de FRE-12 a nommé : « le
contrat front ↔ brokkr n'est pas testé ». Les deux dépôts avaient chacun raison
contre l'autre — le front nichait `week` à la racine, brokkr ne le connaissait
que sous `block` ; le front envoyait le contenu d'une semaine à un endpoint de
méta. Chaque fois : 422 en production, zéro test rouge.

RÈGLE DE CE FICHIER. Les corps sont recopiés de `eitri/src/lib/training-editor.ts`
À L'IDENTIQUE, fonction par fonction, avec le nom de la fonction source en
commentaire. Ce ne sont pas des exemples « réalistes » : ce sont LES octets que
le navigateur envoie. Un test qui les paraphrase ne prouverait rien — c'est la
paraphrase qui a produit les 422.

Quand le front change un payload, ce fichier doit changer avec lui. C'est le
prix, et il est plus petit qu'un athlète bloqué sur sa séance du jour.
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
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name, last_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','coach-1','A','Un')"))
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
                    "('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    load(pg, Arbre(macros=arbre_de_test("p1")))
    return pg


@pytest.fixture
def client():
    app.dependency_overrides[verify_token] = lambda: {"uid": "coach-1"}
    return TestClient(app)


def _bloc(conn) -> str:
    return str(conn.execute(text(
        "SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'p1' ORDER BY b.number LIMIT 1")).scalar())


def _semaine(conn) -> str:
    return str(conn.execute(text(
        "SELECT w.id FROM training_weeks w JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'p1' ORDER BY w.number LIMIT 1")).scalar())


# `createEmptyExercise()` d'eitri (src/lib/exercise.ts), champ pour champ.
_LIGNE_VIDE = {
    "name": "", "variant": [], "format": "", "clusterMode": "", "tempo": "", "sets": "",
    "reps": "", "repsDone": "", "repsUnit": "count", "weight": "", "weightDone": "",
    "weightLocked": False, "assistance": "", "aimedRPE": "", "rest": "", "restActual": "",
    "feltRPE": "", "coachNote": "", "athleteFeedback": "", "link": "", "groupId": "",
    "increment": "", "incrementUnit": "kg", "incrementRef": "", "linkedPrincipal": "",
}

# `weekContentPayload(createEmptyWeek(1))` — le contenu d'une semaine neuve.
_CONTENU_SEMAINE_VIDE = {
    "athlete": {"firstName": "", "lastName": "", "height": 0, "weight": 0},
    "sessions": [{"name": "Séance 1", "formOfTheDay": "", "exercises": [_LIGNE_VIDE]}],
}


def test_addMacro(monde, client):
    """`addMacro` — le bloc et la semaine sont NICHÉS sous `block`. À la racine,
    `extra="forbid"` faisait échouer tout ajout de macro en 422."""
    r = client.post("/programs/p1/macros", headers=_AUTH,
                    json={"block": {"week": _CONTENU_SEMAINE_VIDE}})
    assert r.status_code == 201, r.text
    assert set(r.json()["ids"]) == {"macro", "block", "week", "sessions"}


def test_addBlock(monde, client):
    """`addBlock` — ici `base` et `week` sont bien à la racine : c'est `BlockCreate`
    qui les porte. La différence avec `addMacro` est le genre de détail qu'aucune
    lecture ne garantit."""
    macro = str(monde.execute(text(
        "SELECT id FROM training_macros WHERE program_id = 'p1' ORDER BY number LIMIT 1")).scalar())
    r = client.post(f"/programs/p1/macros/{macro}/blocks", headers=_AUTH,
                    json={"week": _CONTENU_SEMAINE_VIDE})
    assert r.status_code == 201, r.text


def test_addWeek(monde, client):
    """`weekCreatePayload(buildNextWeek(...))` — contenu ET méta.

    La ligne porte des ids `undefined` côté front : ils ne sont pas sérialisés en
    JSON, donc le serveur n'en voit jamais. C'est ce qui rend inoffensif le fait
    que la copie de semaine ne transporte plus les identités de la précédente."""
    r = client.post(f"/programs/p1/blocks/{_bloc(monde)}/weeks", headers=_AUTH, json={
        "athlete": {"firstName": "Léa", "lastName": "Martin", "height": 168, "weight": 62},
        "sessions": [{
            "name": "Lundi", "formOfTheDay": "", "sessionDate": "",
            "exercises": [{**_LIGNE_VIDE, "name": "SQUAT", "sets": "5", "reps": "3",
                           "weight": "140", "weightLocked": True, "variant": ["COMP"]}],
        }],
        "startDate": "2026-03-09", "endDate": "2026-03-15", "hidden": False,
    })
    assert r.status_code == 201, r.text


def test_generateWeekOneFromBase_sur_une_semaine_existante(monde, client):
    """Le chemin qui était mort : le front envoyait ce corps à `PATCH /weeks/{id}`,
    qui ne connaît que la méta. Deux appels, comme le front les enchaîne.

    ⚠️ « EXISTANTE » VEUT DIRE « EXISTANTE ET VIDE » (FRE-84), et c'est bien le
    cas nominal : un bloc neuf naît AVEC sa semaine 1, sans séance, et le bouton
    « Générer » ne s'offre que là — `canGenerate` exige zéro séance côté écran.
    Le décor, lui, porte des séances ; on les retire pour reproduire l'état réel
    plutôt qu'un état que la production ne connaît pas."""
    semaine = _semaine(monde)
    monde.execute(text("DELETE FROM training_sessions WHERE week_id = CAST(:w AS uuid)"),
                  {"w": semaine})
    contenu = client.put(f"/programs/p1/weeks/{semaine}/content", headers=_AUTH,
                         json=_CONTENU_SEMAINE_VIDE)
    meta = client.patch(f"/programs/p1/weeks/{semaine}", headers=_AUTH,
                        json={"hidden": False, "startDate": "2026-03-02",
                              "endDate": "2026-03-08"})
    assert (contenu.status_code, meta.status_code) == (200, 200), (contenu.text, meta.text)


def test_updateBlockBase(monde, client):
    """`updateBlockBase` — la trame ET la re-datation des semaines, dans le même
    corps. `weekDates` avait été oublié au portage, et la re-datation en cascade
    avait disparu en silence."""
    semaine = _semaine(monde)
    r = client.put(f"/programs/p1/blocks/{_bloc(monde)}/base", headers=_AUTH, json={
        "base": {
            "daySplit": [{"day": "J1", "tiers": {"SQUAT": 1}}],
            "selectedPrincipaux": ["SQUAT"],
            "granularity": {"SQUAT": "2,5"},
            "s1StartDate": "2026-03-02", "s1EndDate": "2026-03-08",
            "principles": [{**_LIGNE_VIDE, "name": "SQUAT", "tier": 1, "kind": "warmup"}],
            "accessories": [{**_LIGNE_VIDE, "day": "J1", "name": "CURL"}],
        },
        "weekDates": [{"weekId": semaine, "startDate": "2026-03-02", "endDate": "2026-03-08"}],
    })
    assert r.status_code == 200, r.text
    assert monde.execute(text(
        "SELECT start_date::text FROM training_weeks WHERE id = CAST(:w AS uuid)"),
        {"w": semaine}).scalar() == "2026-03-02"


def test_updateExercise_le_verrou_de_charge(monde, client):
    """`updateExercise(…, 'weightLocked', …)` envoie un VRAI booléen depuis que le
    front a cessé de le traiter comme la chaîne `'true'`. Les deux valeurs
    doivent passer — dont `false`, qui était refusé quand le front écrivait `''`."""
    exo = str(monde.execute(text(
        "SELECT e.id FROM training_exercises e JOIN training_sessions s ON s.id = e.session_id "
        "JOIN training_weeks w ON w.id = s.week_id JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = 'p1' "
        "ORDER BY m.number, b.number LIMIT 1")).scalar())
    for valeur in (True, False):
        r = client.patch(f"/programs/p1/exercises/{exo}", headers=_AUTH,
                         json={"weightLocked": valeur})
        assert r.status_code == 200, r.text
    assert monde.execute(text(
        "SELECT weight_locked FROM training_exercises WHERE id = CAST(:e AS uuid)"),
        {"e": exo}).scalar() is False


# --------------------------------------------------------------------------- #
# LES RÉPONSES D'ÉCRITURE, figées AVANT leur `response_model` (FRE-70, vague 5)
#
# ⚠️ CE QUE CES SPECS PROTÈGENT N'EST PAS UN ÉCRAN, C'EST UNE ÉCRITURE. Les
# identités que ces routes renvoient sont ce qui rend une ligne éditable AVANT le
# prochain rechargement : sans elles, `schedulePatch` ne sait rien persister, et
# chaque frappe du coach est perdue en silence. Une clé filtrée par un
# `response_model` ne casserait donc rien de visible — elle ferait taire la
# sauvegarde, ce qui est pire.
# --------------------------------------------------------------------------- #


def test_addMacro_rend_les_QUATRE_niveaux_d_identite(monde, client):
    r = client.post("/programs/p1/macros", headers=_AUTH,
                    json={"block": {"week": _CONTENU_SEMAINE_VIDE}})
    corps = r.json()
    assert set(corps) == {"ok", "ids"}
    assert set(corps["ids"]) == {"macro", "block", "week", "sessions"}
    assert set(corps["ids"]["sessions"][0]) == {"id", "exercises"}


def test_addBlock_N_A_PAS_de_cle_macro(monde, client):
    """⚠️ LES CLÉS SONT CONDITIONNELLES : ce qui remonte dépend de ce qui a été
    créé. Un bloc ajouté à un macro existant ne rend pas d'identité de macro — et
    `exclude_unset` doit préserver cette absence plutôt que servir `macro: null`,
    que le front lirait comme « créé, mais sans identité »."""
    macro = str(monde.execute(text(
        "SELECT id FROM training_macros WHERE program_id = 'p1' ORDER BY number LIMIT 1")).scalar())
    ids = client.post(f"/programs/p1/macros/{macro}/blocks", headers=_AUTH,
                      json={"week": _CONTENU_SEMAINE_VIDE}).json()["ids"]
    assert set(ids) == {"block", "week", "sessions"}


def test_un_bloc_SANS_semaine_nichee_ne_rend_que_son_identite(monde, client):
    macro = str(monde.execute(text(
        "SELECT id FROM training_macros WHERE program_id = 'p1' ORDER BY number LIMIT 1")).scalar())
    ids = client.post(f"/programs/p1/macros/{macro}/blocks",
                      headers=_AUTH, json={}).json()["ids"]
    assert set(ids) == {"block"}


def test_les_ids_de_lignes_gardent_leurs_TROUS(monde, client):
    """⚠️ L'INVARIANT LE PLUS COÛTEUX DU CONTRAT, et le plus facile à casser sans
    s'en apercevoir : la liste rendue a la MÊME LONGUEUR que celle envoyée, avec
    `null` là où le serveur a écarté une ligne sans nom.

    Un modèle qui filtrerait les `null` — ou une route qui ne rendrait que les ids
    créés — ferait glisser l'identité de la ligne suivante sur celle qui l'a
    précédée. Le coach taperait alors dans un exercice et écrirait dans un autre.
    """
    r = client.post(f"/programs/p1/blocks/{_bloc(monde)}/weeks", headers=_AUTH, json={
        "sessions": [{"name": "Lundi", "formOfTheDay": "", "exercises": [
            {**_LIGNE_VIDE, "name": "SQUAT"},
            {**_LIGNE_VIDE, "name": ""},        # écartée par le serveur
            {**_LIGNE_VIDE, "name": "DIPS"},
        ]}],
    })
    lignes = r.json()["ids"]["sessions"][0]["exercises"]
    assert len(lignes) == 3
    assert lignes[0] and lignes[1] is None and lignes[2]


def test_un_patch_dit_ce_qu_il_a_ECRIT(monde, client):
    macro = str(monde.execute(text(
        "SELECT id FROM training_macros WHERE program_id = 'p1' ORDER BY number LIMIT 1")).scalar())
    corps = client.patch(f"/programs/p1/macros/{macro}",
                         headers=_AUTH, json={"name": "Prépa"}).json()
    assert corps == {"ok": True, "written": ["name"]}


def test_ajouter_une_ligne_rend_son_identite(monde, client):
    """Le geste « ajouter un exercice » : la ligne s'affiche avant la réponse, et
    c'est cet id qui la rend éditable — sans lui, la frappe part dans le vide."""
    seance = str(monde.execute(text(
        "SELECT s.id FROM training_sessions s JOIN training_weeks w ON w.id = s.week_id "
        "JOIN training_blocks b ON b.id = w.block_id JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'p1' ORDER BY m.number, b.number LIMIT 1")).scalar())
    corps = client.post(f"/programs/p1/sessions/{seance}/exercises",
                        headers=_AUTH, json={"name": ""}).json()
    assert set(corps) == {"ok", "id"} and corps["id"]
