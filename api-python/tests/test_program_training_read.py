"""`GET /programs/{pid}/training` — la lecture, désormais servie par Postgres.

Ce fichier REMPLACE les tests de l'assemblage Firestore : celui-ci n'existe plus
(FRE-12). Leurs invariants sont repris ici un par un, contre un vrai Postgres —
l'ordre, l'autorisation, et l'absence de fuite entre programmes homonymes.

Ce qui s'ajoute et n'existait pas : les IDENTIFIANTS de séance et d'exercice.
C'est eux qui rendent les écritures au grain de la ligne utilisables ; sans eux,
le front ne saurait pas quoi désigner.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

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
        "('11111111-1111-1111-1111-111111111111','coach-1','Léa','Martin','ath-1'),"
        "('22222222-2222-2222-2222-222222222222','coach-2','Autre','Athlète',NULL)"))
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


def _arbre(uid: str = "coach-1", pid: str = "p1") -> dict:
    r = _client(uid).get(f"/programs/{pid}/training", headers=_AUTH)
    assert r.status_code == 200
    return r.json()


# --------------------------------------------------------------------------- #
# Autorisation — inchangée
# --------------------------------------------------------------------------- #

def test_le_coach_lit_son_programme(monde):
    assert len(_arbre()["macros"]) == 1


def test_l_athlete_lie_lit_le_sien(monde):
    assert len(_arbre(uid="ath-1")["macros"]) == 1


def test_un_tiers_est_refuse(monde):
    assert _client("inconnu").get("/programs/p1/training", headers=_AUTH).status_code == 403


# --------------------------------------------------------------------------- #
# La forme du contrat
# --------------------------------------------------------------------------- #

def test_l_ordre_est_garanti_a_tous_les_niveaux(monde):
    """Contrat front : macros, blocs, semaines par numéro ; séances et exercices
    par position. Le front ne retrie pas — il affiche dans l'ordre reçu."""
    macros = _arbre()["macros"]
    assert [m["macroNumber"] for m in macros] == [1]
    blocs = macros[0]["blocks"]
    assert [b["blockNumber"] for b in blocs] == [1, 2]
    assert [w["weekNumber"] for w in blocs[0]["weeks"]] == [1, 2]
    exos = blocs[0]["weeks"][0]["sessions"][0]["exercises"]
    assert [e["name"] for e in exos][:3] == ["SQUAT", "PULL UP", "DIPS"]


def test_les_IDENTIFIANTS_sont_servis(monde):
    """CE QUI CHANGE. Sans eux, `PATCH /exercises/{id}` est inutilisable : dans
    l'arbre Firestore un exercice n'était qu'un index dans un tableau."""
    seance = _arbre()["macros"][0]["blocks"][0]["weeks"][0]["sessions"][0]
    assert seance["id"]
    assert all(e["id"] for e in seance["exercises"])
    # Et l'identité est celle de la BASE, pas l'ancien `sessionId` de Firestore.
    assert "sessionId" not in seance


def test_les_formes_libres_traversent(monde):
    """« 8/10 », « PDC », « Sub5 » arrivent au front tels que le coach les a
    écrits — c'est la raison pour laquelle ces colonnes sont restées du texte."""
    exos = {e["name"]: e for e in
            _arbre()["macros"][0]["blocks"][0]["weeks"][0]["sessions"][0]["exercises"]}
    assert exos["PULL UP"]["reps"] == "8/10"
    assert exos["PULL UP"]["feltRPE"] == "Sub5"
    assert exos["DIPS"]["weight"] == "PDC"


def test_une_ligne_SANS_variante_reçoit_une_liste_vide_pas_null(monde):
    """LE BUG DU 15/08, trouvé en ouvrant le mode coach. Une colonne `text[]` vide
    vaut NULL en base, et la servir telle quelle envoyait `null` là où le contrat
    annonce `string[]` : le sélecteur de variantes lisait `.length` sur null et
    faisait tomber TOUT l'écran d'édition.

    Ce n'était pas un cas de bord — 5 086 lignes sur 9 935 n'ont pas de variante.
    La règle vaut pour toute clé de type liste : toujours présente, toujours une
    liste."""
    exos = _arbre()["macros"][0]["blocks"][0]["weeks"][0]["sessions"][0]["exercises"]
    sans = [e for e in exos if not e["variant"]]
    assert sans, "la fixture doit contenir une ligne sans variante"
    assert all(e["variant"] == [] for e in sans)
    assert all(isinstance(e["feltRPEBySet"], list) for e in exos)


def test_une_colonne_texte_VIDE_sort_EN_ABSENCE(monde):
    """⚠️ CETTE SPEC DISAIT L'INVERSE JUSQU'AU 11/09, et son nom le portait :
    « sort en chaîne vide, pas null ». Elle gardait l'autre moitié du bug du
    15/08 — `<select value={null}>` fait protester React, qui repasse le champ en
    NON CONTRÔLÉ, et la saisie cesse de fonctionner sans que rien ne le dise.

    ⚠️ LE DÉFAUT EST RÉEL, SA PARADE ÉTAIT AU MAUVAIS ENDROIT (FRE-137). Le
    contrat annonçait `string` sur 61 champs dont la colonne est `string | null`,
    et re-déguisait à la LECTURE les absences que cinq lots de migrations
    venaient de rendre franches en base. La parade vit maintenant à la frontière
    de l'affichage — `value={x ?? ''}` — où l'on sait qu'on remplit un champ.

    `tier` et `kind` gardaient déjà leur `null` : ils ne sont plus une exception,
    c'est devenu la règle."""
    exos = _arbre()["macros"][0]["blocks"][0]["weeks"][0]["sessions"][0]["exercises"]
    nus = [e for e in exos if not e["format"]]
    assert nus, "la fixture doit contenir une ligne sans format"
    for e in nus:
        assert e["format"] is None and e["tempo"] is None and e["assistance"] is None
    sans_tier = [e for e in exos if e["tier"] is None]
    assert sans_tier


def test_les_variantes_sortent_en_LISTE(monde):
    exos = [e for e in
            _arbre()["macros"][0]["blocks"][0]["weeks"][0]["sessions"][0]["exercises"]
            if e["variant"] and len(e["variant"]) > 1]
    assert exos[0]["variant"] == ["HIGH BAR", "PAUSE"]


def test_l_instantane_athlete_garde_son_nom_et_sa_mesure(monde):
    """Le nom est RECOMPOSÉ par jointure : la migration a supprimé sa duplication
    sur les 415 semaines, pas l'information. Le poids, lui, est bien celui de
    cette semaine-là."""
    semaine = _arbre()["macros"][0]["blocks"][0]["weeks"][0]
    assert semaine["athlete"]["firstName"] == "Léa"
    assert semaine["athlete"]["weight"] == 72.5


def test_la_BASE_est_servie_avec_le_bloc(monde):
    base = _arbre()["macros"][0]["blocks"][0]["base"]
    assert [p["name"] for p in base["principles"]] == ["SQUAT", "PULL UP"]
    assert [a["day"] for a in base["accessories"]] == ["J1", "J1"]
    # La granularité garde ses deux notations décimales.
    assert base["granularity"] == {"SQUAT": "2,5", "MUSCLE UP": "0.5"}


def test_un_bloc_sans_BASE_renvoie_des_listes_vides(monde):
    """Clé toujours présente : le front lit `base.principles` sans le tester.
    14 blocs réels n'ont aucune BASE."""
    base = _arbre()["macros"][0]["blocks"][1]["base"]
    assert base["principles"] == [] and base["accessories"] == []


# --------------------------------------------------------------------------- #
# Les objectifs de bloc — et le piège de l'homonyme
# --------------------------------------------------------------------------- #

def _objectif(conn, program_id: str, exercise: str, position: int) -> None:
    """Le bloc est désigné par son UUID depuis FRE-12 — une vraie clé étrangère."""
    bloc = conn.execute(text(
        "SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = :p ORDER BY b.number LIMIT 1"), {"p": program_id}).scalar()
    conn.execute(text(
        "INSERT INTO block_objectives (block_id, position, exercise) "
        "VALUES (:b, :pos, :e)"), {"b": bloc, "pos": position, "e": exercise})


def test_les_objectifs_sont_joints_et_tries(monde):
    _objectif(monde, "p1", "Second", 1)
    _objectif(monde, "p1", "Premier", 0)
    blocs = _arbre()["macros"][0]["blocks"]
    assert [o["exercise"] for o in blocs[0]["objectives"]] == ["Premier", "Second"]
    assert blocs[1]["objectives"] == []  # clé présente, liste vide


def test_les_objectifs_d_un_autre_programme_ne_fuitent_pas(monde):
    """L'invariant le plus précieux repris de l'ancienne suite, et qui a changé de
    nature : les objectifs désignaient le bloc par son id FIRESTORE, lequel n'est
    PAS unique entre programmes (un programme a été dupliqué avec les ids de ses
    documents). Il fallait donc porter aussi le programme ET le macro dans la
    jointure — trois conditions pour désigner un bloc.

    Depuis la clé étrangère, il n'en reste qu'une, et c'est la base qui la tient.
    Le test reste : ce n'est pas parce qu'une fuite est devenue structurellement
    impossible qu'il faut cesser de la vérifier."""
    _objectif(monde, "p2", "Fuite A", 0)
    _objectif(monde, "p2", "Fuite B", 1)
    _objectif(monde, "p2", "Fuite C", 2)
    _objectif(monde, "p1", "Le mien", 0)
    objectifs = _arbre()["macros"][0]["blocks"][0]["objectives"]
    assert [o["exercise"] for o in objectifs] == ["Le mien"]


def test_selectedPrincipaux_distingue_NULL_de_la_liste_VIDE(monde):
    """L'EXCEPTION à la règle du test précédent, et elle est délibérée.

    Sur `selectedPrincipaux`, NULL et `[]` ne disent PAS la même chose :

      · NULL → le coach n'a jamais configuré sa sélection de mouvements. C'est
        l'état de 48 BASE réelles sur 111, et le front doit alors retomber sur
        l'ordre canonique de la bibliothèque (`draft.selectedPrincipaux ?? …`) ;
      · `[]` → il a retiré ses mouvements un par un. Geste délibéré, que le
        repli ne doit pas annuler en lui rendant toute la bibliothèque.

    ⚠️ CE CHAMP A PORTÉ UN `or []` COMME SES VOISINS, et ça a vidé l'éditeur de
    BASE de ses cinq sections (signalé en production le 17/08 : « 14 principes »
    comptés dans le bandeau, zéro affiché). `??` ne se déclenche jamais sur `[]`
    — le front avait raison, c'est la lecture qui lui mentait.

    Ne PAS « harmoniser » avec `daySplit` et `granularity`, qui gardent le leur :
    `generate-from-base.ts` fait `[...base.daySplit]`, qui jette sur null, et
    pour la granularité « aucune » et « vide » sont la même chose."""
    def poser(valeur_sql: str):
        monde.execute(text(
            f"UPDATE training_blocks SET selected_principals = {valeur_sql} "
            "WHERE legacy_id = 'bloc-1' AND macro_id IN "
            "(SELECT id FROM training_macros WHERE program_id = 'p1')"))
        return _arbre()["macros"][0]["blocks"][0]["base"]["selectedPrincipaux"]

    # Les trois états sont pilotés ICI plutôt que pris à la fixture : c'est leur
    # distinction qu'on teste, elle ne doit pas dépendre d'un décor qui bouge.
    assert poser("NULL") is None            # jamais configuré → le front replie
    assert poser("'{}'") == []              # vidé à la main → on respecte
    assert poser("ARRAY['SQUAT','PULL UP']") == ["SQUAT", "PULL UP"]  # ordre gardé


# --------------------------------------------------------------------------- #
# LES CLÉS DE SORTIE, figées AVANT le `response_model` (FRE-70, vague 3)
#
# ⚠️ L'ARBRE EST LE PLUS GROS CONTRAT DU PROJET : six niveaux imbriqués, et un
# `response_model` FILTRE. Un champ absent du modèle disparaît sans erreur ni
# journal — à n'importe quelle profondeur, et le front reçoit `undefined`.
#
# Les specs au-dessus affirment des VALEURS (l'ordre, les ids, les listes vides) ;
# aucune ne verrait un champ manquant. Celle-ci fige l'ENSEMBLE, niveau par niveau.
# --------------------------------------------------------------------------- #


def test_l_arbre_porte_TOUS_ses_champs_a_TOUS_ses_niveaux(monde):
    arbre = _arbre()
    assert set(arbre) == {"macros"}

    macro = arbre["macros"][0]
    assert set(macro) == {"id", "macroNumber", "name", "trainingFrequency",
                          "coachNotes", "blocks"}

    bloc = macro["blocks"][0]
    assert set(bloc) == {"id", "blockNumber", "name", "startDate", "endDate",
                         "base", "objectives", "objectivesVersion", "weeks"}

    assert set(bloc["base"]) == {"daySplit", "principles", "accessories",
                                 "selectedPrincipaux", "granularity",
                                 "s1StartDate", "s1EndDate"}

    semaine = bloc["weeks"][0]
    assert set(semaine) == {"id", "weekNumber", "name", "hidden", "startDate",
                            "endDate", "athlete", "sessions"}
    assert set(semaine["athlete"]) == {"firstName", "lastName", "weight", "height"}

    seance = semaine["sessions"][0]
    assert set(seance) == {"id", "name", "sessionDate", "formOfTheDay", "exercises", "lignesSansRessenti"}

    exo = seance["exercises"][0]
    assert set(exo) == {
        "id", "name", "variant", "kind", "tier", "format", "clusterMode",
        "clusterRest", "tempo", "sets", "reps", "repsUnit", "weight",
        "weightLocked", "assistance", "aimedRPE", "rest", "repsDone", "weightDone",
        "restActual", "feltRPE", "feltRPEBySet",
        # Le réalisé par SÉRIE (06/09) : trois tableaux parallèles, même ordre
        # — la position i décrit la même série dans les trois.
        "repsDoneBySet", "weightDoneBySet",
        # Les tours bouclés d'un AMRAP de groupe (FRE-116).
        "toursRealises",
        "athleteFeedback", "coachNote",
        "link", "groupId", "groupKind", "increment", "incrementUnit",
        # Sans lâcher jusqu'à la ligne suivante du groupe (FRE-116).
        "unbroken",
        # DÉRIVÉ, pas stocké : le score de mécanotransduction (FRE-103), calculé
        # par `ff_mechano` à la lecture. `None` sur toute ligne qui n'est pas de
        # nature « Kiné ».
        "mechano"}


_BASE_COMMUN = {
    "id", "name", "variant", "kind", "format", "clusterMode", "clusterRest",
    "tempo", "sets", "reps", "repsUnit", "weight", "weightLocked", "assistance",
    "aimedRPE", "rest", "coachNote", "increment", "incrementUnit",
}


def test_principes_et_accessoires_n_ont_PAS_les_memes_champs(monde):
    """⚠️ DEUX ENSEMBLES, ET C'EST VOULU. `_BASE_SORTIE` est partagé, mais
    `_sortie` saute les colonnes absentes de la ligne — et les deux tables n'ont
    pas les mêmes : un PRINCIPE porte un `tier` (il est placé par la grille de
    jours du bloc), un ACCESSOIRE porte un `day` et un `groupId` (il tombe un jour
    donné et peut entrer dans un bi-set).

    Les décrire par un seul modèle avec des champs optionnels effacerait cette
    distinction, et laisserait un principe accepter un `day` sans que rien ne
    proteste. D'où deux modèles côté contrat."""
    base = _arbre()["macros"][0]["blocks"][0]["base"]
    assert base["principles"] and base["accessories"], \
        "la fixture n'a pas les deux : ce test ne prouverait rien"

    assert set(base["principles"][0]) == _BASE_COMMUN | {"tier"}
    assert set(base["accessories"][0]) == _BASE_COMMUN | {"day", "groupId", "groupKind", "unbroken"}


def test_la_BASE_refuse_l_unité_POURCENT(monde):
    """⚠️ LA CONTRAINTE EXISTAIT DÉJÀ, ET C'EST CE QUI MANQUAIT À CETTE SUITE.

    `increment_unit` est contrainte en base depuis le schéma d'origine — un
    `CHECK … IN (…)` qui énumérait `%` avec les autres. Rien ne l'éprouvait ici,
    et la migration de retrait (01/09) a donc été écrite d'après le CODE : elle
    posait un `ADD CONSTRAINT` sur des contraintes déjà là, et s'est cassée en
    production sur « already exists » (42710).

    Cette spec attache le vocabulaire de la base à la suite : `docs/postgres-
    schema.sql` est ce dont pytest construit son Postgres, donc l'y modifier se
    vérifie ici pour de vrai — et pas seulement dans un fichier de migration que
    personne ne rejoue.

    ⚠️ ET LE CAS PASSANT EST DANS LA MÊME SPEC. Sans lui, une contrainte qui
    refuserait TOUT la laisserait verte."""
    exo = _arbre()["macros"][0]["blocks"][0]["weeks"][0]["sessions"][0]["exercises"][0]
    maj = text("UPDATE training_exercises SET increment_unit = :u "
               "WHERE id = CAST(:i AS uuid)")

    with pytest.raises(IntegrityError):
        with monde.begin_nested():
            monde.execute(maj, {"u": "%", "i": exo["id"]})

    # Le contre-exemple : les quatre unités qui restent passent toujours.
    for unite in ("kg", "reps", "rpe", "sets"):
        with monde.begin_nested():
            monde.execute(maj, {"u": unite, "i": exo["id"]})


def test_les_vocabulaires_ADMETTENT_L_ABSENCE_autant_que_leurs_valeurs(monde):
    """⚠️ L'ABSENCE FAIT PARTIE DU VOCABULAIRE, elle n'y traîne pas par accident.

    `reps_unit` et `increment_unit` sont contraintes en base (`CHECK … IN (…)`)
    mais NULLABLES, et c'est le cas MAJORITAIRE pour `repsUnit` : 3 157 lignes
    sur 13 312 en production. Un `Literal['count','sec']` sans absence ferait
    tomber en 500 la lecture de la plupart des programmes — `response_model`
    valide à l'exécution.

    ⚠️ ET CE TEST DISAIT `''` JUSQU'AU 11/09, parce que `_txt` traduisait le NULL.
    Le `Literal` portait donc une troisième valeur, `""`, qui n'existe dans aucun
    CHECK : le contrat inventait un membre de vocabulaire pour dire une absence.
    FRE-137 l'a retirée. Ce qu'il garde n'a pas changé — qu'on ne « nettoie » pas
    l'absence hors du type en la prenant pour une scorie."""
    exo = _arbre()["macros"][0]["blocks"][0]["weeks"][0]["sessions"][0]["exercises"][0]
    bloc_id = _arbre()["macros"][0]["blocks"][0]["id"]

    monde.execute(text("UPDATE training_exercises SET reps_unit = NULL, "
                       "increment_unit = NULL WHERE id = CAST(:i AS uuid)"),
                  {"i": exo["id"]})
    monde.execute(text("UPDATE training_base_principles SET reps_unit = NULL, "
                       "increment_unit = NULL WHERE block_id = CAST(:b AS uuid)"),
                  {"b": bloc_id})

    # La route répond 200 — donc le modèle a ACCEPTÉ l'absence — et la rend
    # telle quelle plutôt que d'inventer une valeur par défaut.
    relu = _arbre()["macros"][0]["blocks"][0]
    ligne = relu["weeks"][0]["sessions"][0]["exercises"][0]
    assert ligne["repsUnit"] is None and ligne["incrementUnit"] is None
    assert relu["base"]["principles"][0]["repsUnit"] is None


def test_un_vocabulaire_HORS_liste_est_refuse_par_la_lecture(monde):
    """Le pendant du test précédent : si `''` passe, ce n'est pas que tout passe.

    Sans cette spec, élargir un `Literal` en `str` pour faire taire une erreur
    passerait inaperçu — et le front reperdrait le vocabulaire qu'il connaît."""
    from pydantic import ValidationError

    from app.entrainement.schemas_training_lecture import LigneDeSeance

    exo = _arbre()["macros"][0]["blocks"][0]["weeks"][0]["sessions"][0]["exercises"][0]
    assert LigneDeSeance.model_validate(exo)

    with pytest.raises(ValidationError):
        LigneDeSeance.model_validate({**exo, "repsUnit": "minutes"})
    with pytest.raises(ValidationError):
        LigneDeSeance.model_validate({**exo, "incrementUnit": "livres"})


def test_un_objectif_de_bloc_porte_TOUS_ses_champs(monde):
    bloc = _arbre()["macros"][0]["blocks"][0]["id"]
    monde.execute(text(
        "INSERT INTO block_objectives (block_id, position, exercise, sets, reps) "
        "VALUES (CAST(:b AS uuid), 0, 'SQUAT', '5', '3')"), {"b": bloc})

    objectifs = _arbre()["macros"][0]["blocks"][0]["objectives"]
    assert len(objectifs) == 1
    assert set(objectifs[0]) == {"id", "exercise", "variant", "format", "sets",
                                 "reps", "weightMin", "weightMax", "assistance",
                                 "atteintLe"}
    # ⚠️ `None` ET NON `''` POUR CELUI-LÀ, seul du modèle. Les autres sortent en
    # chaîne vide parce qu'ils alimentent un tableau ÉDITABLE ; celui-ci est une
    # COCHE, et « pas atteint » est une absence de date, pas une date vide.
    assert objectifs[0]["atteintLe"] is None


def test_un_objectif_de_bloc_COCHÉ_rend_sa_date(monde):
    """⚠️ LA SPEC QUI MANQUAIT, ET SON ABSENCE S'EST VUE À LA MUTATION. Celle
    d'à côté n'observe qu'un objectif NON coché : une lecture qui rendrait
    toujours `None` la laissait VERTE. Elle gardait la présence de la clé, pas
    la valeur qui la remplit.

    Il faut donc une ligne réellement cochée, lue à travers l'arbre — le seul
    chemin par lequel l'écran la reçoit."""
    bloc = _arbre()["macros"][0]["blocks"][0]["id"]
    monde.execute(text(
        "INSERT INTO block_objectives (block_id, position, exercise, atteint_le) "
        "VALUES (CAST(:b AS uuid), 1, 'MUSCLE UP', DATE '2026-08-30')"), {"b": bloc})

    objectifs = _arbre()["macros"][0]["blocks"][0]["objectives"]
    coche = next(o for o in objectifs if o["exercise"] == "MUSCLE UP")
    assert coche["atteintLe"] == "2026-08-30"
    # Les colonnes nullables sortent en `''`, jamais en `null` : ce tableau est
    # ÉDITABLE, et un champ React contrôlé qui reçoit `null` casse la saisie.
    assert objectifs[0]["variant"] is None and objectifs[0]["weightMin"] is None


# --------------------------------------------------------------------------- #
# UNE SEMAINE MASQUÉE N'EST PAS SERVIE À QUI NE PROGRAMME PAS (FRE-158)
#
# ⚠️ ELLE L'ÉTAIT PAR LES TROIS LECTURES, et le front n'en retirait que la
# PASTILLE de la barre — le contenu restait affiché à l'athlète, séances
# comprises. Signalé par un coach le 09/09 : « on ne peut plus cacher un bloc ».
# Il masquait l'unique semaine du bloc, et son athlète voyait tout.
#
# Le masquage cesse donc d'être une politesse du front : c'est le serveur qui
# ne l'envoie plus. Le coach et le kiné, eux, continuent de la recevoir — sans
# quoi l'œil qui la démasque n'aurait plus rien à désigner.
# --------------------------------------------------------------------------- #


def _la_masquee_et_sa_voisine(pg) -> tuple[str, str, str]:
    """(la semaine masquée, sa voisine visible, leur bloc).

    ⚠️ RIEN N'EST MASQUÉ ICI : la fixture porte DÉJÀ une semaine masquée depuis
    toujours — « Décharge », `fixtures_training.py:127`. Personne n'avait jamais
    rien affirmé dessus, et c'est bien le sujet du ticket. La voisine visible
    compte autant : une garde qui emporterait le bloc entier laisserait l'athlète
    sans programme, et ce serait pire que le défaut."""
    lignes = pg.execute(text(
        "SELECT w.id AS wid, w.hidden, b.id AS bid FROM training_weeks w "
        "JOIN training_blocks b ON b.id = w.block_id "
        "JOIN training_macros m ON m.id = b.macro_id "
        "WHERE m.program_id = 'p1' ORDER BY b.number, w.number")).mappings().all()
    masquee = next(l for l in lignes if l["hidden"])
    visible = next(l for l in lignes if not l["hidden"] and l["bid"] == masquee["bid"])
    return str(masquee["wid"]), str(visible["wid"]), str(masquee["bid"])


def _semaines(arbre: dict) -> set[str]:
    return {w["id"] for m in arbre["macros"] for b in m["blocks"] for w in b["weeks"]}


def test_l_ARBRE_masque_la_semaine_a_l_athlete_et_la_garde_au_coach(monde):
    wid, visible, _ = _la_masquee_et_sa_voisine(monde)
    au_coach = _semaines(_arbre("coach-1"))
    a_l_athlete = _semaines(_arbre("ath-1"))
    assert wid in au_coach, "le coach doit la voir : c'est lui qui la démasque"
    assert wid not in a_l_athlete
    # ⚠️ ET SEULEMENT ELLE. Une garde qui emporterait tout le bloc laisserait
    # l'athlète sans programme — c'est le défaut jumeau, et il est pire.
    assert visible in a_l_athlete
    assert a_l_athlete == au_coach - {wid}


def test_la_CHARPENTE_masque_la_semaine_a_l_athlete(monde):
    """⚠️ LA CHARPENTE COMPTE AUTANT QUE L'ARBRE (FRE-119) : c'est elle que lit
    l'écran d'entraînement, et c'est d'elle que le front tire la semaine qu'il
    affiche. La filtrer dans `read_tree` seulement ne corrigerait rien."""
    wid, visible, _ = _la_masquee_et_sa_voisine(monde)

    def semaines(uid):
        r = _client(uid).get("/programs/p1/structure", headers=_AUTH)
        assert r.status_code == 200, r.text[:200]
        return {w["id"] for m in r.json()["macros"] for b in m["blocks"] for w in b["weeks"]}

    assert wid in semaines("coach-1")
    assert semaines("ath-1") == semaines("coach-1") - {wid}
    assert visible in semaines("ath-1")


def test_le_CONTENU_DU_BLOC_ne_porte_plus_les_seances_de_la_semaine_masquee(monde):
    """⚠️ LA TROISIÈME PORTE, et la plus facile à oublier. La charpente filtrée,
    le front ne DEMANDE plus la semaine — mais le contenu du bloc l'envoyait
    quand même, séances et lignes comprises. Une lecture directe la rendait."""
    wid, visible, bid = _la_masquee_et_sa_voisine(monde)

    def semaines(uid):
        r = _client(uid).get(f"/programs/p1/blocks/{bid}/content", headers=_AUTH)
        assert r.status_code == 200, r.text[:200]
        return {w["id"] for w in r.json()["weeks"]}

    assert wid in semaines("coach-1")
    assert semaines("ath-1") == semaines("coach-1") - {wid}
    assert visible in semaines("ath-1")


def test_le_coach_qui_est_AUSSI_l_athlete_continue_de_voir(monde):
    """⚠️ LE CAS QUI CASSE UNE GARDE ÉCRITE SUR « EST-CE L'ATHLÈTE ? » (FRE-142).
    Les 4 coachs de production sont athlètes. La question posée est « programme-
    t-il ? », pas « est-il l'athlète ? » : l'union des rôles, jamais le premier
    rencontré."""
    wid, _, _ = _la_masquee_et_sa_voisine(monde)
    monde.execute(text(
        "UPDATE athletes SET user_uid = 'coach-1' "
        "WHERE id = '11111111-1111-1111-1111-111111111111'"))
    assert wid in _semaines(_arbre("coach-1"))


def _blocs(arbre: dict) -> set[str]:
    return {b["id"] for m in arbre["macros"] for b in m["blocks"]}


def test_un_bloc_SANS_semaine_visible_ne_va_pas_a_l_athlete(monde):
    """⚠️ « NE PAS MONTRER LE BLOC », décision de William le 09/09. Un bloc dont
    toutes les semaines sont masquées n'est pas un bloc vide à afficher : c'est un
    bloc que le coach a voulu cacher. Les trois cas de production sont d'ailleurs
    des blocs à UNE semaine, masquée — il croyait masquer le bloc.

    Le bloc RÉELLEMENT sans semaine tombe par la même porte (« bloc-2 » de la
    fixture, et il en existe un en production) : depuis le 22/08 un bloc neuf
    naît sans Semaine 1, le coach le compose pendant des jours, et l'athlète n'a
    rien à y voir."""
    _, visible, bid = _la_masquee_et_sa_voisine(monde)
    vide = next(b for b in _blocs(_arbre("coach-1")) if b != bid)

    # Tant qu'une semaine reste visible, le bloc reste — c'est la moitié qui
    # empêche la garde d'être bien trop large.
    assert bid in _blocs(_arbre("ath-1"))
    # Le bloc sans aucune semaine, lui, ne part qu'à l'athlète.
    assert vide in _blocs(_arbre("coach-1"))
    assert vide not in _blocs(_arbre("ath-1"))

    # …et quand la DERNIÈRE semaine visible est masquée à son tour, le bloc s'en va.
    monde.execute(text("UPDATE training_weeks SET hidden = true WHERE id = CAST(:w AS uuid)"),
                  {"w": visible})
    assert _blocs(_arbre("ath-1")) == set()
    assert bid in _blocs(_arbre("coach-1")), "le coach garde tout : c'est lui qui démasque"


def test_les_OBJECTIFS_d_un_bloc_masque_ne_partent_pas_non_plus(monde):
    """⚠️ LE POINT LE MOINS VISIBLE, et celui que William a nommé. Le tableau de
    bord de l'athlète affiche `block.objectives` — « ils s'afficheront sur le
    tableau de bord de l'athlète », dit l'écran du coach. Cacher le bloc en
    laissant ses objectifs, c'est annoncer un travail qu'on vient de retirer.

    Ils voyagent AVEC le bloc dans la charpente : c'est pour ça qu'il suffit de
    retirer le bloc, et c'est aussi pourquoi personne ne l'aurait vu."""
    _, visible, bid = _la_masquee_et_sa_voisine(monde)
    monde.execute(text(
        "INSERT INTO block_objectives (block_id, position, exercise, sets, reps) "
        "VALUES (CAST(:b AS uuid), 0, 'SQUAT', '5', '3')"), {"b": bid})

    def objectifs(uid):
        return [o for m in _arbre(uid)["macros"] for b in m["blocks"] for o in b["objectives"]]

    assert len(objectifs("ath-1")) == 1, "tant que le bloc est visible, son objectif l'est"

    monde.execute(text("UPDATE training_weeks SET hidden = true WHERE id = CAST(:w AS uuid)"),
                  {"w": visible})
    assert objectifs("ath-1") == []
    assert len(objectifs("coach-1")) == 1


def test_la_CHARPENTE_retire_le_bloc_elle_aussi(monde):
    """C'est ELLE que lit le tableau de bord, donc elle qui porte les objectifs."""
    _, visible, bid = _la_masquee_et_sa_voisine(monde)
    monde.execute(text("UPDATE training_weeks SET hidden = true WHERE id = CAST(:w AS uuid)"),
                  {"w": visible})

    def blocs(uid):
        r = _client(uid).get("/programs/p1/structure", headers=_AUTH)
        assert r.status_code == 200, r.text[:200]
        return {b["id"] for m in r.json()["macros"] for b in m["blocks"]}

    assert bid in blocs("coach-1")
    assert blocs("ath-1") == set()
