"""Ce que la revue de FRE-12 a trouvé, et qui ne doit pas revenir.

Un fichier à part plutôt que des ajouts éparpillés : ces défauts ont une ORIGINE
commune — un contrat d'écriture qui refuse, jette ou casse sur ce que sa propre
lecture rend — et les garder ensemble rend cette famille visible. Chaque test
échoue sur le code d'avant ; le constat correspondant est cité en docstring.

Référence : `docs/revue-fre-12.md`.
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
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','a@x.fr'), ('ath-1','c@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name, last_name, user_uid) VALUES "
        "('11111111-1111-1111-1111-111111111111','coach-1','A','Un','ath-1')"))
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
                    "('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    load(pg, Arbre(macros=arbre_de_test("p1")))
    return pg


def _client(uid: str = "coach-1") -> TestClient:
    app.dependency_overrides[verify_token] = lambda: {"uid": uid}
    return TestClient(app)


def _un(conn, sql: str) -> str:
    return str(conn.execute(text(sql), {"p": "p1"}).scalar())


def _bloc(conn) -> str:
    return _un(conn, "SELECT b.id FROM training_blocks b "
                     "JOIN training_macros m ON m.id = b.macro_id "
                     "WHERE m.program_id = :p ORDER BY b.number LIMIT 1")


def _semaine(conn) -> str:
    return _un(conn, "SELECT w.id FROM training_weeks w "
                     "JOIN training_blocks b ON b.id = w.block_id "
                     "JOIN training_macros m ON m.id = b.macro_id "
                     "WHERE m.program_id = :p ORDER BY w.number LIMIT 1")


def _seance(conn) -> str:
    return _un(conn, "SELECT s.id FROM training_sessions s "
                     "JOIN training_weeks w ON w.id = s.week_id "
                     "JOIN training_blocks b ON b.id = w.block_id "
                     "JOIN training_macros m ON m.id = b.macro_id "
                     "WHERE m.program_id = :p ORDER BY s.position LIMIT 1")


def _exercice(conn) -> str:
    return _un(conn, "SELECT e.id FROM training_exercises e "
                     "JOIN training_sessions s ON s.id = e.session_id "
                     "JOIN training_weeks w ON w.id = s.week_id "
                     "JOIN training_blocks b ON b.id = w.block_id "
                     "JOIN training_macros m ON m.id = b.macro_id "
                     "WHERE m.program_id = :p ORDER BY e.position LIMIT 1")


def _macros(client) -> list:
    return client.get("/programs/p1/training", headers=_AUTH).json()["macros"]


def _version_objectifs(client, bloc: str) -> str:
    """La version que la lecture rend — celle que `PUT …/objectives` exige (FRE-163)."""
    return next(b["objectivesVersion"] for m in _macros(client) for b in m["blocks"] if b["id"] == bloc)


# --------------------------------------------------------------------------- #
# B4 — la NATURE d'une ligne de BASE
# --------------------------------------------------------------------------- #

def test_le_kind_d_une_ligne_de_base_survit_a_l_enregistrement(monde):
    """Constat B4 : les tables de BASE n'avaient pas de colonne `kind`. Le PUT
    répondait 200, la nature disparaissait au resync — et toutes les semaines
    générées ensuite la perdaient. FRE-10 cassé sur son chemin principal.

    ⚠️ `rehab` PASSE COMME `warmup`, et c'est le sens de la décision du
    2026-08-18 : la nature est une ÉTIQUETTE et ne porte aucun droit. Ce test a
    porté un temps l'inverse — la ligne rehab écartée, un compte dans la réponse —
    au titre d'un domaine réservé au kiné qui n'existe plus."""
    c = _client()
    bloc = _bloc(monde)
    r = c.put(f"/programs/p1/blocks/{bloc}/base", headers=_AUTH, json={"base": {
        "principles": [{"name": "SQUAT", "tier": 1, "kind": "warmup"}],
        "accessories": [{"day": "Lundi", "name": "CURL", "kind": "rehab"}],
    }})
    assert r.status_code == 200

    base = next(b["base"] for m in _macros(c) for b in m["blocks"] if b["id"] == bloc)
    assert base["principles"][0]["kind"] == "warmup"
    assert base["accessories"][0]["kind"] == "rehab"


def test_dupliquer_un_bloc_dont_la_BASE_n_a_pas_de_dates_S1(monde):
    """La famille du fichier, sur un chemin qu'elle n'avait pas encore couvert :
    ce que la LECTURE rend doit pouvoir être RÉÉCRIT.

    `GET /training` rend `s1StartDate: ""` quand la trame n'a pas de dates — la
    convention de l'arbre documentaire, où tout champ absent valait la chaîne
    vide. Renvoyer cet objet tel quel à la création d'un bloc partait droit dans
    une colonne `date` : `invalid input syntax for type date: ""`, donc un 500 —
    et un 500 se voit en CORS dans le navigateur, une réponse d'erreur ne portant
    pas d'en-têtes.

    ⚠️ POURQUOI ÇA NE SE VOYAIT PAS. `PUT /blocks/{id}/base` passe par
    `BaseContent`, dont le type `DateISO` normalise `''` en `None`. Ce chemin-ci
    reçoit `base` en `dict[str, Any]` LIBRE — aucune validation ne s'applique. Le
    même champ, deux portes, une seule gardée. Et le front échappait au défaut par
    un `delete cloned.s1StartDate` motivé par tout autre chose (les dates S1 ne se
    clonent pas) : la protection tenait à un geste qui n'a jamais été posé pour
    ça."""
    c = _client()
    # Le cas visé est une trame SANS dates S1 — celles de la fixture en ont.
    monde.execute(text("UPDATE training_blocks SET s1_start_date = NULL, "
                       "s1_end_date = NULL"))
    base = next(b["base"] for m in _macros(c) for b in m["blocks"])
    assert base["s1StartDate"] is None

    # ⚠️ ET C'EST LA SPEC ELLE-MÊME QUI PLANTE LE `''` DEPUIS FRE-137. Elle
    # tenait ce cas de la LECTURE, qui traduisait `NULL → ''` ; cette traduction
    # a disparu, et la spec s'était laissé un mot pour le dire (« ce test ne
    # prouve plus rien »). Mais la PORTE, elle, est toujours ouverte : ce chemin
    # reçoit `base` en `dict[str, Any]` libre, sans validation. Un client ancien
    # — ou la file hors-ligne, qui rejoue des patchs écrits avant aujourd'hui —
    # enverra encore `''`. On le fabrique donc à la main.
    base = {**base, "s1StartDate": "", "s1EndDate": ""}

    macro = _un(monde, "SELECT id FROM training_macros WHERE program_id = :p ORDER BY number LIMIT 1")
    r = c.post(f"/programs/p1/macros/{macro}/blocks", headers=_AUTH,
               json={"name": "COPIE", "base": base})

    assert r.status_code == 201, r.text[:300]
    relu = next(b["base"] for m in _macros(c) for b in m["blocks"]
                if b["id"] == r.json()["ids"]["block"])
    assert relu["s1StartDate"] is None


def test_TOUT_ce_que_la_LECTURE_rend_peut_etre_REECRIT(monde):
    """L'INVARIANT INVERSE de `test_aller_retour.py`, et c'est lui qui manquait.

    Là-bas : ce qui est ENVOYÉ doit se relire. Ici : ce qui est LU doit pouvoir
    être RÉÉCRIT. Les deux sens ne se déduisent pas l'un de l'autre — la
    duplication d'un bloc a cassé en 500 sur `s1StartDate: ""`, une valeur que
    personne n'envoie jamais à la main mais que la lecture produit à chaque appel.

    Le dispositif VIDE d'abord toutes les colonnes de date : c'est la seule façon
    de faire rendre `''` à la lecture, et donc de traverser le cas. Avec les dates
    de la fixture, ce test passerait sans rien prouver."""
    c = _client()
    monde.execute(text(
        "UPDATE training_blocks SET s1_start_date = NULL, s1_end_date = NULL, "
        "start_date = NULL, end_date = NULL"))
    monde.execute(text("UPDATE training_weeks SET start_date = NULL, end_date = NULL"))
    monde.execute(text("UPDATE training_sessions SET session_date = NULL"))

    for macro in _macros(c):
        for bloc in macro["blocks"]:
            r = c.post(f"/programs/p1/macros/{macro['id']}/blocks", headers=_AUTH, json={
                "name": bloc["name"], "startDate": bloc["startDate"],
                "endDate": bloc["endDate"], "base": bloc["base"]})
            assert r.status_code == 201, f"bloc {bloc['name']} : {r.status_code} {r.text[:200]}"
            # ⚠️ LE CONTENU SE RÉÉCRIT DANS UNE SEMAINE NEUVE, plus par-dessus la
            # semaine lue (FRE-84 : `PUT …/content` ne remplit qu'une semaine
            # vide). L'invariant est intact — ce que la lecture produit doit être
            # acceptable à l'écriture — et il est même mieux posé : on éprouve la
            # charge utile, pas l'écrasement.
            bloc_neuf = r.json()["ids"]["block"]
            for semaine in bloc["weeks"]:
                neuve = c.post(f"/programs/p1/blocks/{bloc_neuf}/weeks", headers=_AUTH,
                               json={"sessions": []})
                assert neuve.status_code == 201, neuve.text[:200]
                r2 = c.put(f"/programs/p1/weeks/{neuve.json()['ids']['week']}/content",
                           headers=_AUTH,
                           json={"athlete": semaine["athlete"], "sessions": semaine["sessions"]})
                assert r2.status_code == 200, \
                    f"semaine {semaine['weekNumber']} : {r2.status_code} {r2.text[:200]}"


def test_une_ligne_de_base_sans_kind_le_rend_nul_et_non_vide(monde):
    """`kind` absent veut dire « entraînement » : lui substituer `''` inventerait
    une valeur, et `''` violerait le CHECK de la colonne."""
    c = _client()
    bloc = _bloc(monde)
    c.put(f"/programs/p1/blocks/{bloc}/base", headers=_AUTH,
          json={"base": {"principles": [{"name": "SQUAT", "tier": 1}], "accessories": []}})

    base = next(b["base"] for m in _macros(c) for b in m["blocks"] if b["id"] == bloc)
    assert base["principles"][0]["kind"] is None


# --------------------------------------------------------------------------- #
# Les ids rendus par les créations
# --------------------------------------------------------------------------- #

def test_creer_une_semaine_rend_les_ids_de_ses_seances_et_de_ses_lignes(monde):
    """Sans eux, le client ne peut RIEN persister avant son prochain refetch :
    il vient d'envoyer des objets qu'il ne sait pas encore nommer, et chaque
    frappe dans cet intervalle est perdue."""
    c = _client()
    r = c.post(f"/programs/p1/blocks/{_bloc(monde)}/weeks", headers=_AUTH, json={
        "sessions": [{"name": "Lundi", "exercises": [{"name": "SQUAT"}, {"name": "DIPS"}]}],
    })
    assert r.status_code == 201
    ids = r.json()["ids"]
    seance = ids["sessions"][0]
    assert len(ids["sessions"]) == 1 and len(seance["exercises"]) == 2

    # …et ce sont bien les vrais : chacun désigne une ligne de CETTE séance.
    lignes = monde.execute(text(
        "SELECT id FROM training_exercises WHERE session_id = CAST(:s AS uuid)"),
        {"s": seance["id"]}).scalars().all()
    assert {str(i) for i in lignes} == set(seance["exercises"])


def test_les_ids_rendus_restent_ALIGNES_sur_les_lignes_envoyees(monde):
    """LE piège de cette réponse. Le chargement en masse ÉCARTE les lignes sans
    nom ; rendre seulement les ids créés obligerait le client à deviner le
    décalage — et il devinerait faux, en collant l'id de la ligne 3 à la ligne 2.
    On rend donc une liste de même longueur, avec `null` sur l'écartée."""
    c = _client()
    r = c.post(f"/programs/p1/blocks/{_bloc(monde)}/weeks", headers=_AUTH, json={
        "sessions": [{"name": "Lundi", "exercises": [
            {"name": "SQUAT"}, {"name": ""}, {"name": "DIPS"},
        ]}],
    })
    lignes = r.json()["ids"]["sessions"][0]["exercises"]
    assert len(lignes) == 3
    assert lignes[1] is None
    assert lignes[0] is not None and lignes[2] is not None


def test_une_ligne_ecartee_ne_laisse_pas_de_trou_dans_les_positions(monde):
    """Les positions en base restent contiguës : le réordonnancement raisonne
    dessus, et un trou lui ferait calculer des rangs faux."""
    c = _client()
    r = c.post(f"/programs/p1/blocks/{_bloc(monde)}/weeks", headers=_AUTH, json={
        "sessions": [{"name": "Lundi", "exercises": [
            {"name": "SQUAT"}, {"name": ""}, {"name": "DIPS"},
        ]}],
    })
    seance = r.json()["ids"]["sessions"][0]["id"]
    positions = monde.execute(text(
        "SELECT position FROM training_exercises WHERE session_id = CAST(:s AS uuid) "
        "ORDER BY position"), {"s": seance}).scalars().all()
    assert positions == [0, 1]


def test_creer_un_macro_rend_l_arbre_complet_des_ids(monde):
    r = _client().post("/programs/p1/macros", headers=_AUTH, json={
        "block": {"week": {"sessions": [{"name": "Lundi", "exercises": [{"name": "SQUAT"}]}]}},
    })
    ids = r.json()["ids"]
    assert set(ids) == {"macro", "block", "week", "sessions"}
    assert ids["sessions"][0]["exercises"][0] is not None


# --------------------------------------------------------------------------- #
# B6 — remplacer le CONTENU d'une semaine
# --------------------------------------------------------------------------- #

def _semaine_vide(conn) -> str:
    """Une semaine du décor, VIDÉE de ses séances.

    ⚠️ DEPUIS FRE-84, `PUT …/content` ne remplit qu'une semaine sans séance : la
    route détruisait les séances pour les recréer SANS le réalisé, et sa seule
    protection était une condition d'écran. Les tests qui l'appelaient sur la
    semaine peuplée du décor éprouvaient donc un chemin que la production
    n'emprunte pas — un bloc naît avec sa semaine 1 VIDE, et c'est elle que la
    génération remplit."""
    semaine = _semaine(conn)
    conn.execute(text("DELETE FROM training_sessions WHERE week_id = CAST(:w AS uuid)"),
                 {"w": semaine})
    return semaine


def test_remplacer_le_contenu_d_une_semaine(monde):
    """Constat B6 : cet endpoint n'existait pas. Le front envoyait le contenu à
    `PATCH /weeks/{id}`, qui ne connaît que la méta — 422, rien d'écrit, et le
    flux trame → génération mort dans son cas nominal."""
    c = _client()
    semaine = _semaine_vide(monde)
    r = c.put(f"/programs/p1/weeks/{semaine}/content", headers=_AUTH, json={
        "athlete": {"weight": 72, "height": 178},
        "sessions": [{"name": "Générée", "exercises": [{"name": "SQUAT", "sets": "5"}]}],
    })
    assert r.status_code == 200

    seances = monde.execute(text(
        "SELECT name FROM training_sessions WHERE week_id = CAST(:w AS uuid)"),
        {"w": semaine}).scalars().all()
    assert seances == ["Générée"]


def test_remplir_une_semaine_QUI_A_DEJA_DES_SEANCES_est_refuse(monde):
    """⚠️ CETTE SPEC A CHANGÉ DE CAMP (FRE-84). Elle affirmait que le
    remplacement EFFACE bien les séances précédentes — « remplacement et non
    fusion ». C'était vrai, et c'était le défaut : les séances repartaient SANS
    les colonnes de réalisé (reps, charge, RPE ressenti, retour de l'athlète), et
    la seule protection était une condition d'écran.

    La route ne remplit plus qu'une semaine VIDE. Pour régénérer une semaine
    déjà remplie, le coach la SUPPRIME — le geste destructeur devient explicite
    au lieu d'être l'effet de bord d'un bouton « Générer ».

    ⚠️ AU PASSAGE, UN COMMENTAIRE QUI MENTAIT est retiré : il annonçait qu'une
    semaine portant une ligne `rehab` était déjà refusée en 409 « cf. le test
    juste en dessous ». Il n'y avait ni règle ni test — FRE-53 a été annulé. Le
    filet décrit n'existait pas ; celui-ci existe."""
    c = _client()
    semaine = _semaine(monde)
    avant = monde.execute(text(
        "SELECT count(*) FROM training_sessions WHERE week_id = CAST(:w AS uuid)"),
        {"w": semaine}).scalar()
    assert avant >= 1, "le décor doit porter des séances pour que le refus ait un objet"

    r = c.put(f"/programs/p1/weeks/{semaine}/content", headers=_AUTH,
              json={"sessions": [{"name": "Générée", "exercises": []}]})

    assert r.status_code == 409, r.text[:300]
    assert r.json()["code"] == "semaine_deja_remplie"
    # RIEN n'a bougé : le refus précède la destruction, il ne la répare pas.
    apres = monde.execute(text(
        "SELECT count(*) FROM training_sessions WHERE week_id = CAST(:w AS uuid)"),
        {"w": semaine}).scalar()
    assert apres == avant

def test_remplacer_le_contenu_d_une_semaine_etrangere_404(monde):
    assert _client().put(
        "/programs/p1/weeks/99999999-9999-9999-9999-999999999999/content",
        headers=_AUTH, json={"sessions": []}).status_code == 404


# --------------------------------------------------------------------------- #
# A1 / A5 / A7 — des contrats qui rendaient 500, ou refusaient un geste normal
# --------------------------------------------------------------------------- #

def test_patcher_un_macro_avec_des_dates_est_refuse_pas_planté(monde):
    """Constat A1 : `MacroPatch` exposait `startDate`/`endDate`, que la table n'a
    pas — 500 `UndefinedColumn`. Un champ qui n'existe pas ne doit pas être
    déclaré ; le refus est alors un 422 lisible, pas une erreur serveur."""
    macro = _un(monde, "SELECT id FROM training_macros WHERE program_id = :p ORDER BY number LIMIT 1")
    r = _client().patch(f"/programs/p1/macros/{macro}", headers=_AUTH,
                        json={"startDate": "2026-01-01"})
    assert r.status_code == 422


def test_vider_le_nom_d_une_ligne_avec_null(monde):
    """Constat A5 : le contrat annonce « un `None` explicite efface ».

    ⚠️ IL LE FAIT ENFIN. Cette spec documentait un CONTOURNEMENT : « la colonne
    est NOT NULL — 500, donc effacer veut dire chaîne vide ». Le contrat
    promettait une chose, la base en imposait une autre, et la spec gravait
    l'écart.

    FRE-123 a levé le `NOT NULL` — il le fallait, une clé étrangère refusant
    `''` et acceptant `NULL`. L'absence se dit donc enfin comme une absence, et
    le contrat n'a plus à mentir. Le front ne voit aucune différence : la lecture
    reconvertit `NULL → ''`."""
    c = _client()
    exo = _exercice(monde)
    r = c.patch(f"/programs/p1/exercises/{exo}", headers=_AUTH, json={"name": None})
    assert r.status_code == 200, r.text[:400]
    assert monde.execute(text("SELECT name FROM training_exercises WHERE id = CAST(:e AS uuid)"),
                         {"e": exo}).scalar() is None


@pytest.mark.parametrize("chemin", [
    "exercises/pas-un-uuid",
    "sessions/8kX2mQvL9pRt3nWs",      # la forme d'un id Firestore
    "weeks/pas-un-uuid",
    "blocks/pas-un-uuid",
    "macros/pas-un-uuid",
])
def test_un_id_qui_n_est_pas_un_uuid_est_introuvable_pas_une_erreur_serveur(monde, chemin):
    """Constat A5 : le `CAST(... AS uuid)` levait, donc 500. Un vieux client resté
    sur les ids Firestore en produirait en rafale le soir de la bascule."""
    r = _client().patch(f"/programs/p1/{chemin}", headers=_AUTH, json={"name": "X"})
    assert r.status_code == 404


def test_renommer_une_seance_a_vide(monde):
    """Constat A7 : `min_length=1` transformait un geste ordinaire — effacer avant
    de retaper, chaque frappe partant en PATCH — en 422, donc en toast."""
    r = _client().patch(f"/programs/p1/sessions/{_seance(monde)}", headers=_AUTH,
                        json={"name": ""})
    assert r.status_code == 200


# --------------------------------------------------------------------------- #
# A6 — ce que l'athlète a le droit d'écrire
# --------------------------------------------------------------------------- #

def test_l_athlete_ecrit_son_poids_de_la_semaine(monde):
    """Ce qu'il DOIT pouvoir faire : décrire son propre état."""
    r = _client("ath-1").patch(f"/programs/p1/weeks/{_semaine(monde)}", headers=_AUTH,
                               json={"athleteWeightKg": 74.5})
    assert r.status_code == 200


@pytest.mark.parametrize("patch", [{"name": "Deload"}, {"hidden": True},
                                   {"startDate": "2026-01-05"}])
def test_l_athlete_ne_touche_pas_a_la_programmation_de_sa_semaine(monde, patch):
    """Constat A6 : le portage avait ouvert la méta de semaine à l'athlète, alors
    qu'elle était coach SEUL côté documentaire. Pas une fuite — c'est son propre
    programme — mais une régression métier silencieuse."""
    semaine = _semaine(monde)
    avant = monde.execute(text(
        "SELECT name, hidden, start_date FROM training_weeks WHERE id = CAST(:w AS uuid)"),
        {"w": semaine}).mappings().first()

    r = _client("ath-1").patch(f"/programs/p1/weeks/{semaine}", headers=_AUTH, json=patch)

    assert r.status_code == 403
    apres = monde.execute(text(
        "SELECT name, hidden, start_date FROM training_weeks WHERE id = CAST(:w AS uuid)"),
        {"w": semaine}).mappings().first()
    assert dict(apres) == dict(avant)      # refusé ET rien d'écrit


def test_l_athlete_saisit_sa_forme_du_jour_mais_ne_renomme_pas_la_seance(monde):
    seance = _seance(monde)
    c = _client("ath-1")
    assert c.patch(f"/programs/p1/sessions/{seance}", headers=_AUTH,
                   json={"formOfTheDay": 4}).status_code == 200
    assert c.patch(f"/programs/p1/sessions/{seance}", headers=_AUTH,
                   json={"name": "Jambes"}).status_code == 403


def test_le_coach_lui_garde_la_main_sur_tout(monde):
    """Le pendant du test précédent : la restriction ne doit pas déborder."""
    assert _client("coach-1").patch(
        f"/programs/p1/weeks/{_semaine(monde)}", headers=_AUTH,
        json={"name": "Deload", "hidden": True}).status_code == 200


# --------------------------------------------------------------------------- #
# La PURGE de l'ETL — et ce qu'elle ne doit pas emporter
# --------------------------------------------------------------------------- #

def test_la_purge_ne_detruit_pas_les_objectifs_de_bloc(monde):
    """LE piège de la purge, trouvé en la mettant à l'épreuve sur la base de
    travail : `block_objectives` n'existe QUE dans Postgres — migré le 03/08,
    Firestore ne le porte plus — et sa clé étrangère est `ON DELETE CASCADE`. Un
    TRUNCATE de l'arbre l'emporte, et l'ETL ne saurait pas le reconstruire : 346
    lignes perdues pour de bon. On les met à l'abri, puis on les réattache aux
    blocs rechargés par leurs identités LEGACY — les uuid, eux, sont refrappés."""
    from tests.chargeur_arbre import restaurer_objectifs, sauver_objectifs

    bloc = _bloc(monde)
    _client().put(f"/programs/p1/blocks/{bloc}/objectives", headers=_AUTH, json={
        "objectives": [{"exercise": "SQUAT", "sets": "5", "reps": "3"}],
        "version": _version_objectifs(_client(), bloc)})

    sauvegarde = sauver_objectifs(monde)
    assert len(sauvegarde) == 1

    monde.execute(text("TRUNCATE training_macros CASCADE"))
    assert monde.execute(text("SELECT count(*) FROM block_objectives")).scalar() == 0

    load(monde, Arbre(macros=arbre_de_test("p1")))
    remis, orphelins = restaurer_objectifs(monde, sauvegarde)

    assert (remis, orphelins) == (1, 0)
    ligne = monde.execute(text(
        "SELECT o.exercise, b.legacy_id FROM block_objectives o "
        "JOIN training_blocks b ON b.id = o.block_id")).mappings().first()
    assert ligne["exercise"] == "SQUAT"
    # …et sur le BON bloc : le rattachement passe par (programme, macro, bloc)
    # legacy, pas par un uuid qui n'existe plus.
    assert str(monde.execute(text(
        "SELECT legacy_id FROM training_blocks WHERE id = CAST(:b AS uuid)"),
        {"b": _bloc(monde)}).scalar()) == ligne["legacy_id"]


def test_un_objectif_dont_le_bloc_a_disparu_est_compte_pas_avale(monde):
    """Un orphelin n'est pas rattrapable, mais il doit se VOIR."""
    from tests.chargeur_arbre import restaurer_objectifs

    fantome = [{"program_id": "p1", "macro_legacy": "nexiste-pas", "block_legacy": "non-plus",
                "position": 0, "exercise": "SQUAT", "variant": None, "format": None,
                "sets": None, "reps": None, "weight_min": None, "weight_max": None,
                "assistance": None}]
    assert restaurer_objectifs(monde, fantome) == (0, 1)


# --------------------------------------------------------------------------- #
# La lecture ne rend `null` nulle part où le contrat annonce une chaîne
# --------------------------------------------------------------------------- #

def test_les_objectifs_de_bloc_rendent_l_absence_TELLE_QUELLE(monde):
    """⚠️ CETTE SPEC DISAIT L'INVERSE JUSQU'AU 11/09, et elle avait raison à
    l'époque : « les objectifs de bloc ne rendent jamais null ». Elle gardait
    `_txt`, né du défaut du 15/08 — un champ contrôlé de React qui reçoit
    `value={null}` bascule en non contrôlé et la saisie casse.

    ⚠️ LE BESOIN N'A PAS DISPARU, SA PLACE A CHANGÉ (FRE-137). Traduire
    `NULL → ''` dans le CONTRAT faisait mentir le contrat sur 61 champs, et
    re-déguisait à la lecture les absences que cinq lots de migrations venaient
    de rendre franches en base. La protection vit désormais à la frontière de
    l'AFFICHAGE — `value={x ?? ''}` — où l'on sait qu'on remplit un champ de
    saisie. Ici, on ne le sait pas : la même valeur part aussi dans des courbes
    et des agrégats, où `''` n'est pas un nombre absent mais une chaîne."""
    c = _client()
    bloc = _bloc(monde)
    # Un objectif où le client n'envoie QUE l'exercice : le reste entre en NULL.
    c.put(f"/programs/p1/blocks/{bloc}/objectives", headers=_AUTH,
          json={"objectives": [{"exercise": "SQUAT"}], "version": _version_objectifs(c, bloc)})

    objectif = next(b["objectives"][0] for m in _macros(c) for b in m["blocks"]
                    if b["id"] == bloc)
    assert objectif["exercise"] == "SQUAT"
    for cle in ("format", "sets", "reps", "weightMin", "weightMax", "assistance"):
        assert objectif[cle] is None, f"{cle} devrait dire l'absence, pas la déguiser"


def test_la_structure_REND_l_absence_sur_ses_textes(monde):
    """⚠️ CETTE SPEC DISAIT L'INVERSE JUSQU'AU 11/09 : « la structure ne rend
    jamais null sur ses textes ». Elle gardait `_txt`, retiré par FRE-137 — cf.
    `test_les_objectifs_de_bloc_rendent_l_absence_TELLE_QUELLE` pour le
    raisonnement.

    ⚠️ ET UNE EXCEPTION SUBSISTE, qui n'en est pas une : `session.name` est
    `NOT NULL` en base (0 absent sur 2 710). Le contrat ne doit pas annoncer une
    absence que la base rend impossible — un front qui la gérerait écrirait du
    code mort, et un lecteur croirait le cas possible."""
    c = _client()
    macro = _macros(c)[0]
    bloc = macro["blocks"][0]
    semaine = bloc["weeks"][0]
    seance = semaine["sessions"][0]

    assert seance["name"] is not None, "le nom d'une séance est NOT NULL en base"

    # Le décor ne renseigne ni nom de macro/bloc/semaine ni dates : l'absence
    # doit traverser la lecture sans être déguisée.
    for objet, cles in ((macro, ("name",)),
                        (bloc, ("startDate", "endDate")),
                        (semaine, ("startDate", "endDate"))):
        for cle in cles:
            assert cle in objet, f"{cle} doit rester PRÉSENT, même absent"
    for cle in ("s1StartDate", "s1EndDate"):
        assert cle in bloc["base"], f"base.{cle} doit rester présent"


# --------------------------------------------------------------------------- #
# Les routes DOCUMENTAIRES ont disparu, et c'est un garde-fou
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("methode,chemin", [
    ("patch", "/programs/p1/macrocycles/m1"),
    ("patch", "/programs/p1/macrocycles/m1/blocks/b1"),
    ("patch", "/programs/p1/macrocycles/m1/blocks/b1/weeks/w1"),
    ("patch", "/programs/p1/macrocycles/m1/blocks/b1/weeks/w1/content"),
    ("patch", "/programs/p1/macrocycles/m1/blocks/b1/base"),
    ("post", "/programs/p1/macrocycles"),
    ("post", "/programs/p1/macrocycles/m1/blocks"),
    ("post", "/programs/p1/macrocycles/m1/blocks/b1/weeks"),
    ("delete", "/programs/p1/macrocycles/m1"),
    ("delete", "/programs/p1/macrocycles/m1/blocks/b1"),
    ("delete", "/programs/p1/macrocycles/m1/blocks/b1/weeks/w1"),
])
def test_les_routes_documentaires_n_existent_plus(monde, methode, chemin):
    """Elles écrivaient dans Firestore, que plus personne ne lit depuis la
    bascule : elles auraient répondu 200 EN JETANT LA DONNÉE.

    Le cas visé n'est pas théorique : un client resté sur un ancien bundle — un
    onglet ou une PWA qui traverse la fenêtre de maintenance sans recharger —
    aurait cru enregistrer sa séance. Absentes, elles rendent 404 : le front
    affiche une erreur, l'utilisateur recharge, il retombe sur le bundle neuf.

    Ce test garde donc une ABSENCE. Les remettre, même « juste pour la
    compatibilité », rouvrirait la perte silencieuse."""
    c = _client()
    # `delete()` n'accepte pas de corps : on n'en envoie que là où il en faut.
    reponse = (c.delete(chemin, headers=_AUTH) if methode == "delete"
               else getattr(c, methode)(chemin, headers=_AUTH, json={}))
    assert reponse.status_code in (404, 405), f"{methode.upper()} {chemin} répond encore"
