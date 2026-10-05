"""LES MOYENNES D'UN RÉALISÉ SAISI PAR SÉRIE — la règle, et son écriture (FRE-136).

⚠️ CE FICHIER EXISTE PARCE QUE LA RÈGLE A VÉCU EN TYPESCRIPT. `felt_rpe`,
`reps_done` et `weight_done` sont, depuis la saisie par série, la MOYENNE des
séries — et le navigateur l'envoyait dans le même PATCH que le tableau. La
colonne était une dérivée écrite par le client, avec une règle qui n'existait
qu'à un seul endroit, et pas celui-là.

Ce n'était pas théorique : deux lignes de production portaient déjà un
`reps_done` qui n'est AUCUNE de leurs séries — `['8','7','7']` rendu `7.3`,
`['41','42']` rendu `41.5`.
"""

import json
import pathlib

import pytest
from sqlalchemy import text

from tests.conftest import semer_un_membre

_AUTH = {"Authorization": "Bearer x"}


# ⚠️ UNE SEULE TABLE POUR LES DEUX SUITES (`docs/moyennes-par-serie.json`).
#
# La règle vit à deux endroits, et c'est délibéré : en SQL parce que le serveur
# DÉRIVE la colonne, en TypeScript parce que le chiffre doit suivre la frappe
# sans réseau. Leur accord avait été prouvé une fois par exécution des deux
# côtés — puis figé dans DEUX tables séparées, ce qui ne rougissait pas si l'une
# bougeait sans l'autre. Celle-ci est la seule ; `eitri` en lit une copie
# commitée (`npm run fixtures:brokkr`), comme il le fait des types OpenAPI.
#
# Les valeurs attendues ont été produites en EXÉCUTANT la règle TypeScript, pas
# en la relisant : mon premier jeu écrit à la main en contenait un faux
# (`['Sub5','6']` fait bien 5).
_TABLE = json.loads(
    (pathlib.Path(__file__).parent.parent / "docs/moyennes-par-serie.json").read_text())
_MOYENNE_SERIE = [(c["series"], c["attendu"]) for c in _TABLE["moyenneDesSeries"]]
_MOYENNE_RPE = [(c["series"], c["attendu"]) for c in _TABLE["feltRPEFromSets"]]


def _sans_encodage(valeur) -> str:
    """⚠️ LA TABLE DIT LA VALEUR, PAS COMMENT L'ABSENCE S'ÉCRIT — et elle est
    PARTAGÉE avec le front (`eitri/src/lib/__fixtures__/moyennes-par-serie.json`).

    Depuis FRE-137, les fonctions SQL rendent `NULL` quand rien n'est noté ; le
    front, lui, rend `''` parce que le contrat type ces champs `string` et qu'un
    champ contrôlé React n'accepte pas `null`. Les deux disent la même absence,
    chacun dans son encodage, et `_sortie` les réconcilie.

    Toucher la table pour y mettre `null` aurait fait tomber la suite du front
    sans rien prouver de plus : c'est l'encodage qu'on normalise ici, pas la
    règle."""
    return "" if valeur is None else valeur


@pytest.mark.parametrize("series,attendu", _MOYENNE_SERIE)
def test_la_moyenne_d_un_realise(pg, series, attendu):
    assert _sans_encodage(pg.execute(text("SELECT ff_moyenne_serie(CAST(:v AS text[]))"),
                                     {"v": series}).scalar()) == attendu


@pytest.mark.parametrize("series,attendu", _MOYENNE_RPE)
def test_la_moyenne_d_un_RPE(pg, series, attendu):
    """⚠️ DEUX FONCTIONS ET NON UNE, et cette table dit pourquoi. `FAIL`
    absorbant et l'arrondi au demi-point SUPÉRIEUR n'appartiennent qu'au RPE :
    passer des répétitions par ici rendrait « 11 » sur « 10, 11, 12 », et
    plafonnerait toute charge au-dessus de 10."""
    assert _sans_encodage(pg.execute(text("SELECT ff_moyenne_rpe(CAST(:v AS text[]))"),
                                     {"v": series}).scalar()) == attendu


# --------------------------------------------------------------------------- #
# LE CHEMIN D'ÉCRITURE
# --------------------------------------------------------------------------- #


@pytest.fixture
def ligne(pg):
    """Une ligne d'exercice, et son id — le plus court chemin jusqu'au PATCH."""
    semer_un_membre(pg, "coach-1")
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1') ON CONFLICT DO NOTHING"))
    athlete = pg.execute(text(
        "INSERT INTO athletes (legacy_id, coach_uid, first_name) "
        "VALUES ('a-moy','coach-1','A') RETURNING id")).scalar()
    pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                    "VALUES ('p-moy','coach-1',:a)"), {"a": athlete})
    macro = pg.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number) "
        "VALUES ('p-moy','m',1) RETURNING id")).scalar()
    bloc = pg.execute(text("INSERT INTO training_blocks (macro_id, legacy_id, number) "
                           "VALUES (:m,'b',1) RETURNING id"), {"m": macro}).scalar()
    sem = pg.execute(text("INSERT INTO training_weeks (block_id, legacy_id, number) "
                          "VALUES (:b,'w',1) RETURNING id"), {"b": bloc}).scalar()
    seance = pg.execute(text(
        "INSERT INTO training_sessions (week_id, legacy_id, position, name) "
        "VALUES (:w,'s',0,'Lundi') RETURNING id"), {"w": sem}).scalar()
    eid = pg.execute(text(
        "INSERT INTO training_exercises (session_id, position, name, sets, reps) "
        "VALUES (:s, 0, 'SQUAT', '3', '5') RETURNING id"), {"s": seance}).scalar()
    return pg, str(eid)


def _lu(pg, eid):
    return pg.execute(text(
        "SELECT reps_done, weight_done, felt_rpe, "
        # Les TABLEAUX aussi : sans eux, une spec ne peut pas distinguer « le
        # scalaire est juste » de « le scalaire est juste ET le détail a bien
        # disparu » — et c'est le détail périmé qui faisait le faux badge.
        "       reps_done_by_set, weight_done_by_set, felt_rpe_by_set "
        "FROM training_exercises "
        "WHERE id = CAST(:e AS uuid)"), {"e": eid}).mappings().one()


def test_le_serveur_DERIVE_la_moyenne_et_IGNORE_celle_du_client(auth_as, ligne):
    """⚠️ LA SPEC CENTRALE. Le client envoie le tableau ET un scalaire faux ; le
    serveur écrit le sien. C'est ce qui fait de la colonne une dérivée du
    serveur, et non plus une valeur que le navigateur affirme."""
    pg, eid = ligne
    r = auth_as(uid="coach-1").patch(
        f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
        json={"repsDoneBySet": ["10", "12"], "repsDone": "999",
              "weightDoneBySet": ["40", "50"], "weightDone": "0",
              "feltRPEBySet": ["7", "8"], "feltRPE": "1"})
    assert r.status_code == 200

    lu = _lu(pg, eid)
    assert lu["reps_done"] == "11", "la moyenne du serveur, pas le 999 du client"
    assert lu["weight_done"] == "45"
    assert lu["felt_rpe"] == "7.5"


def test_un_scalaire_SEUL_reste_la_saisie_de_l_athlete(auth_as, ligne):
    """⚠️ ET C'EST 86 % DES LIGNES. Sans tableau, le scalaire n'est pas une
    dérivée : c'est ce que l'athlète a tapé. Le recalculer l'effacerait."""
    pg, eid = ligne
    r = auth_as(uid="coach-1").patch(
        f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
        json={"repsDone": "7", "feltRPE": "9"})
    assert r.status_code == 200

    lu = _lu(pg, eid)
    assert lu["reps_done"] == "7" and lu["felt_rpe"] == "9"


def test_le_patch_de_l_ANCIEN_FRONT_passe_encore(auth_as, ligne):
    """⚠️ LA FILE HORS-LIGNE EN DÉPEND, et c'est pour elle que le serveur IGNORE
    au lieu de REFUSER. Les patchs en attente vivent sur le disque de l'athlète
    (IndexedDB, FRE-118) et survivent aux déploiements : un patch écrit par
    l'ancien front porte `{tableau, scalaire}`. Un 422 sur le scalaire — la
    première rédaction du ticket — aurait perdu au rejeu une séance saisie hors
    ligne. Ignorer ne perd rien : le serveur écrit la valeur juste."""
    pg, eid = ligne
    r = auth_as(uid="coach-1").patch(
        f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
        json={"feltRPEBySet": ["8", "9"], "feltRPE": "8.5"})
    assert r.status_code == 200, "un patch de l'ancien front ne doit jamais être refusé"
    assert _lu(pg, eid)["felt_rpe"] == "8.5"


def test_un_FAIL_par_serie_remonte_dans_le_scalaire(auth_as, ligne):
    """`FAIL` est absorbant : une série ratée rate le format entier. C'est la
    règle que `records.py` relit ensuite pour écarter la ligne."""
    pg, eid = ligne
    auth_as(uid="coach-1").patch(
        f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
        json={"feltRPEBySet": ["8", "8", "FAIL"]})
    assert _lu(pg, eid)["felt_rpe"] == "FAIL"


def test_vider_le_tableau_vide_le_scalaire(auth_as, ligne):
    """⚠️ ET PAS `'0'`. « Il n'a rien noté » n'est pas « il a fait zéro » — le
    défaut le plus récurrent du projet, ici à la frontière de l'écriture."""
    pg, eid = ligne
    auth_as(uid="coach-1").patch(f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
                                 json={"repsDoneBySet": ["10", "12"]})
    assert _lu(pg, eid)["reps_done"] == "11"

    auth_as(uid="coach-1").patch(f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
                                 json={"repsDoneBySet": []})
    # ⚠️ `None` ET NON `''` DEPUIS FRE-137 : `ff_moyenne_serie` rend l'absence
    # comme une absence. Le comportement ne change pas — la colonne se vide —
    # seule la façon de le dire change, et `_sortie` la retraduit pour le front.
    assert _lu(pg, eid)["reps_done"] is None


def test_fermer_le_pli_garde_le_RESSENTI_et_jette_le_TABLEAU(auth_as, ligne):
    """⚠️ LE DÉFAUT DU 10/09, CÔTÉ SERVEUR. La carte de l'athlète écrivait
    TOUJOURS par série — même pli fermé, même sans avoir montré une seule
    pastille. Une ligne à quatre séries repartait donc avec `['8']`, et le badge
    de FRE-156 la lisait « 1/4 ». 7 255 lignes sur les 13 475 à plusieurs séries
    portaient un badge, l'écrasante majorité pour rien.

    Fermer le pli doit pouvoir se DIRE : le tableau part vide, le ressenti part
    avec, et c'est lui qui fait foi. Sans ça, `ff_moyenne_rpe('{}')` rendrait
    `''` et effacerait la saisie du même patch.

    ⚠️ À NE PAS CONFONDRE avec `test_vider_le_tableau_vide_le_scalaire`, juste
    au-dessus : là, le tableau part SEUL, et il n'y a rien à garder."""
    pg, eid = ligne
    auth_as(uid="coach-1").patch(f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
                                 json={"feltRPEBySet": ["7", "8"]})
    assert _lu(pg, eid)["felt_rpe"] == "7.5"

    r = auth_as(uid="coach-1").patch(f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
                                     json={"feltRPE": "9", "feltRPEBySet": []})
    assert r.status_code == 200
    lu = _lu(pg, eid)
    assert lu["felt_rpe"] == "9", "le ressenti global de l'appelant, pas la moyenne d'un vide"
    assert not lu["felt_rpe_by_set"], "et plus aucun détail par série"


def test_le_retour_au_global_vaut_aussi_pour_les_REPS_et_la_CHARGE(auth_as, ligne):
    """Les trois colonnes suivent la même règle. Elles ne sont pas concernées par
    le défaut de la carte — reps et charge y testaient DÉJÀ le pli avant
    d'écrire, et c'est cette asymétrie qui a fait le trou : 54 lignes de
    production ont un tableau de répétitions contre 8 539 un tableau de RPE.
    Mais une règle qui ne vaudrait que pour une colonne sur trois se
    retrouverait fausse au premier écran qui change."""
    pg, eid = ligne
    auth_as(uid="coach-1").patch(
        f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
        json={"repsDoneBySet": ["10", "12"], "weightDoneBySet": ["40", "50"]})
    assert _lu(pg, eid)["reps_done"] == "11"

    auth_as(uid="coach-1").patch(
        f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
        json={"repsDone": "8", "repsDoneBySet": [],
              "weightDone": "60", "weightDoneBySet": []})
    lu = _lu(pg, eid)
    assert (lu["reps_done"], lu["weight_done"]) == ("8", "60")
    assert not lu["reps_done_by_set"] and not lu["weight_done_by_set"]


# --------------------------------------------------------------------------- #
# LA REPRISE DES LIGNES DÉJÀ ÉCRITES (migration du 10/09)
# --------------------------------------------------------------------------- #

def test_la_migration_ne_touche_QUE_le_scalaire_deguise(ligne):
    """⚠️ LA MIGRATION EST LA MOITIÉ QUI FAIT DISPARAÎTRE LE BADGE. Le correctif
    de `derivations` empêche d'ÉCRIRE un tableau déguisé ; il ne répare pas les
    4 953 lignes qui en portent déjà un.

    Ce qu'elle doit viser et ce qu'elle doit épargner tient en cinq cas. Le plus
    important est le deuxième : `ff_series_tenues` ne compte les séries tenues
    depuis le tableau QUE s'il contient un `FAIL` — vider `{'FAIL'}` ferait
    retomber la ligne sur « toutes les séries prescrites ont été tenues », et un
    échec deviendrait une séance pleine. 75 lignes de production sont dans ce
    cas."""
    import pathlib
    pg, eid = ligne
    seance = pg.execute(text("SELECT session_id FROM training_exercises "
                             "WHERE id = CAST(:e AS uuid)"), {"e": eid}).scalar()
    cas = [
        # (repère,            sets, felt_rpe, tableau,      attendu après)
        ("global-deguise",    "4",  "8",      ["8"],        None),
        ("fail-seul",         "3",  "FAIL",   ["FAIL"],     ["FAIL"]),
        ("vrai-par-serie",    "3",  "7.5",    ["7", "8"],   ["7", "8"]),
        ("une-seule-serie",   "1",  "8",      ["8"],        None),
        ("scalaire-different", "3", "9",      ["8"],        ["8"]),
    ]
    for position, (repere, sets, rpe, tableau, _) in enumerate(cas, start=1):
        pg.execute(text(
            "INSERT INTO training_exercises (session_id, position, name, sets, felt_rpe, "
            # ⚠️ LE NOM EST UNE CLÉ ÉTRANGÈRE vers la bibliothèque : on ne peut
            # pas y mettre le repère du cas. C'est la POSITION qui les distingue.
            "felt_rpe_by_set) VALUES (CAST(:s AS uuid), :p, 'SQUAT', :sets, :rpe, :arr)"),
            {"s": seance, "p": position, "sets": sets, "rpe": rpe, "arr": tableau})

    corps = pathlib.Path(
        "docs/migrations/2026-09-10_un_rpe_global_n_est_pas_une_serie.sql"
    ).read_text().replace("BEGIN;", "").replace("COMMIT;", "")
    pg.execute(text(corps))

    obtenu = {r[0]: (r[1], r[2]) for r in pg.execute(text(
        "SELECT position, felt_rpe_by_set, felt_rpe FROM training_exercises "
        "WHERE position > 0"))}
    for position, (repere, _sets, rpe, _t, attendu) in enumerate(cas, start=1):
        tableau, scalaire = obtenu[position]
        assert tableau == attendu, repere
        # ⚠️ ET LE RESSENTI N'A BOUGÉ NULLE PART. Sans cette moitié, une
        # migration qui viderait AUSSI `felt_rpe` passerait au vert : le badge
        # disparaîtrait, et la saisie de l'athlète avec.
        assert scalaire == rpe, repere


def test_un_tableau_VIDE_s_ecrit_NULL_et_pas_accolades(auth_as, ligne):
    """⚠️ « PAS DE DÉTAIL » N'A QU'UNE SEULE ÉCRITURE. `NULL` et `{}` disaient la
    même chose et ne se lisaient pas pareil : le suivi marque une ligne « faite »
    sur `felt_rpe_by_set IS NOT NULL`, qu'un tableau VIDE satisfait. 102 lignes
    de production sans le moindre ressenti étaient comptées comme faites.

    C'est `''` contre `NULL`, le défaut le plus récurrent du projet, sur un type
    tableau. On le rend impossible à l'écriture plutôt que de le rattraper à
    chaque lecture."""
    pg, eid = ligne
    auth_as(uid="coach-1").patch(f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
                                 json={"feltRPEBySet": ["7", "8"]})
    auth_as(uid="coach-1").patch(f"/programs/p-moy/exercises/{eid}", headers=_AUTH,
                                 json={"feltRPEBySet": []})

    brut = pg.execute(text("SELECT felt_rpe_by_set, felt_rpe FROM training_exercises "
                           "WHERE id = CAST(:e AS uuid)"), {"e": eid}).one()
    assert brut[0] is None, "un tableau vidé s'écrit NULL, jamais '{}'"
    assert brut[1] is None, "et le scalaire dérivé se vide, comme avant"
