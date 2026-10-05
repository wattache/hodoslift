"""LA MÉCANOTRANSDUCTION — contre le VRAI moteur Postgres (FRE-103).

`somme des chiffres du tempo × répétitions`, demandé par Thomas (kiné). La
définition vit dans `ff_mechano`, et c'est ELLE qui est éprouvée ici : la même
fonction sert la lecture de l'arbre (`GET /training`) et la projection
`training_sets`, pour qu'il n'existe pas deux formules qui divergent en silence.

💡 CE QUE LE NOMBRE EST, et c'est le meilleur garde-fou pour relire ces cas : le
tempo décrit des phases en secondes, donc le score est le TEMPS SOUS TENSION
d'une série, en secondes.

⚠️ LES CAS SONT TIRÉS DU PARC RÉEL, pas inventés — relevé du 25/08 sur la base de
production. C'est ce qui les rend utiles plutôt que décoratifs : ils épinglent le
comportement sur les formes qui existent vraiment, y compris (et surtout) celles
qui ne doivent RIEN produire.

⚠️ CES CAS SONT LE MIROIR DE `eitri/src/lib/mechano.test.ts`. Les deux suites
doivent rester d'accord tant que le front n'a pas cessé de calculer. Le jour où
il lit `ex.mechano`, celle du front disparaît — et celle-ci devient la seule.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.socle.auth import verify_token
from app.main import app
from tests.chargeur_arbre import Arbre, load
from tests.fixtures_training import arbre_de_test


@pytest.fixture
def monde_lu(pg):
    """Un programme complet, pour éprouver le chemin de LECTURE de bout en bout.

    Les tests de `ff_mechano` ci-dessus n'ont besoin que du moteur ; ceux-ci ont
    besoin de l'arbre, parce que ce qu'ils gardent n'est pas le calcul mais la
    décision de ne l'appeler que sur les lignes « Kiné »."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name, last_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','coach-1','Léa','Martin')"))
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
        "('p1','coach-1','11111111-1111-1111-1111-111111111111')"))
    load(pg, Arbre(macros=arbre_de_test("p1")))
    return pg


@pytest.fixture
def client_lu():
    app.dependency_overrides[verify_token] = lambda: {"uid": "coach-1"}
    return TestClient(app)


def _somme(pg, tempo):
    return pg.execute(text("SELECT ff_tempo_somme(:t)"), {"t": tempo}).scalar()


def _score(pg, tempo, reps, unite="count"):
    return pg.execute(
        text("SELECT ff_mechano(:t, :r, :u)"),
        {"t": tempo, "r": reps, "u": unite},
    ).scalar()


# --------------------------------------------------------------------------- #
# ff_tempo_somme — la reconnaissance du rythme
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("tempo,attendu", [
    # La forme du ticket : quatre temps.
    ("4040", 8), ("2030", 5), ("4321", 10), ("3010", 4),
    # ⚠️ TROIS TEMPS, ET C'EST LA FORME MAJORITAIRE : 1 055 tempos chiffrés
    # tiennent en trois caractères contre 515 en quatre, et « 300 » à lui seul
    # en compte 598. Coder « A+B+C+D » aurait écarté les deux tiers du parc.
    ("300", 3), ("310", 4), ("330", 6), ("200", 2),
    # ⚠️ LE X EST RECONNU MAIS NE COMPTE PAS, et les deux moitiés importent.
    # Le reconnaître : « 31X1 » est canonique depuis FRE-17 et 309 lignes en
    # portent un. Ne pas le compter : « explosif » n'ajoute pas de tension.
    ("31X1", 5), ("31X0", 4), ("30X1", 4), ("32X0", 5), ("31X", 4),
    # Un rythme tout explosif : un temps sous tension NUL, pas une absence.
    ("XXX", 0),
    # Le champ est du texte libre : la casse ne doit pas décider.
    ("31x1", 5),
])
def test_la_somme_des_chiffres(pg, tempo, attendu):
    assert _somme(pg, tempo) == attendu


@pytest.mark.parametrize("tempo", [
    # ⚠️ LE CŒUR DE LA GARDE. Ces valeurs sont conservées VOLONTAIREMENT depuis
    # FRE-17 — « elles décrivent une intention, pas un rythme en quatre temps » —
    # et elles pèsent 1 462 lignes, la moitié du parc. Un parseur laxiste rendrait
    # 1 pour « 1CT PAUSE » et 130 pour « E1:30mom » : des nombres plausibles et
    # faux, les pires de tous.
    "1CT PAUSE", "2CT PAUSE", "3CT CONCENTRIQUE", "3CT EXCENTRIQUE",
    "DS", "DS PAUSE", "RESET", "E1:30mom",
    # Les écritures tiretées ont disparu du parc avec FRE-17 (normalisées en
    # compact) : les accepter reviendrait à rouvrir un format qu'on a fermé.
    "3-0-1-0", "3/1/X/1",
    # Trop court, trop long : hors de la fenêtre 3-4.
    "30", "3", "31X11", "40400",
    # Le silence ordinaire.
    "", "   ", None,
])
def test_ce_qui_n_est_PAS_un_rythme_ne_rend_rien(pg, tempo):
    assert _somme(pg, tempo) is None


# --------------------------------------------------------------------------- #
# ff_mechano — le score d'une série
# --------------------------------------------------------------------------- #


def test_le_score_multiplie_la_somme_par_les_repetitions(pg):
    # L'exemple donné : 3 séries de 6 reps, tempo 4040 → 6 × 8 par série.
    assert _score(pg, "4040", 6) == 48
    assert _score(pg, "2030", 6) == 30
    assert _score(pg, "300", 8) == 24


def test_un_rythme_tout_explosif_vaut_ZERO_et_non_NULL(pg):
    """⚠️ `0` ET `NULL` NE SE REPLIENT PAS L'UN SUR L'AUTRE, et l'écran en dépend.

    « XXX » est un rythme reconnu dont le temps sous tension est nul : le score
    existe et vaut 0. `NULL` dirait « pas de score », ce qui est faux — et côté
    front le raccourci `if (!score)` ferait disparaître la ligne. C'est le même
    piège que `reps_done = 0` ailleurs dans ce projet."""
    assert _score(pg, "XXX", 6) == 0
    assert _score(pg, "XXX", 6) is not None


@pytest.mark.parametrize("tempo,reps,unite", [
    # ⚠️ EN SECONDES, ON NE SCORE PAS. Un gainage « 3 × 60 s » : multiplier une
    # durée par une somme de durées ne veut rien dire, et le résultat aurait
    # pourtant l'air d'un score. Même raison que l'exclusion du tonnage en
    # isométrie (FRE-20) — « non applicable » n'est pas « zéro ».
    ("4040", 30, "sec"),
    # Pas de rythme lisible : rien à multiplier.
    ("1CT PAUSE", 6, "count"), ("", 6, "count"), (None, 6, "count"),
    # ⚠️ SEULE L'ABSENCE de répétitions se tait — PAS le zéro, qui a son propre
    # test ci-dessous. Confondre les deux ferait disparaître le score d'une série
    # ratée au lieu de la compter pour ce qu'elle vaut.
    ("4040", None, "count"),
])
def test_les_silences(pg, tempo, reps, unite):
    assert _score(pg, tempo, reps, unite) is None


def test_l_unite_vide_ou_absente_score_comme_des_repetitions(pg):
    """⚠️ `reps_unit` EST NULLABLE ET VAUT SOUVENT `''` — 3 157 lignes de
    production sur 13 312 n'ont pas d'unité. Seul `'sec'` doit faire taire le
    score : traiter « pas d'unité » comme « pas de répétitions » aurait effacé
    le score d'un quart du parc, sans erreur ni trace."""
    assert _score(pg, "4040", 6, "") == 48
    assert _score(pg, "4040", 6, None) == 48


# --------------------------------------------------------------------------- #
# LE CHEMIN DE LECTURE — `GET /training`
#
# ⚠️ C'est CETTE partie qui justifie tout le déplacement. Le score est aussi
# projeté dans `training_sets` pour l'analytique, mais le front rend l'ARBRE, pas
# la projection : sans le score ici, il aurait gardé sa propre implémentation, et
# on se serait retrouvé avec DEUX formules — dont un « X » qui pourrait valoir 0
# d'un côté et 1 de l'autre sans que personne ne le voie pendant six mois.
# --------------------------------------------------------------------------- #


def _lignes(client, pid="p1"):
    r = client.get(f"/programs/{pid}/training", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200, r.text[:300]
    return [e for m in r.json()["macros"] for b in m["blocks"] for w in b["weeks"]
            for s in w["sessions"] for e in s["exercises"]]


def test_la_lecture_porte_le_score_des_lignes_KINE(monde_lu, client_lu):
    """Une ligne « Kiné » avec un tempo lisible porte son score. 3+0+1+0 = 4, × 12."""
    monde_lu.execute(text(
        # ⚠️ `NULL` ET NON `''` : depuis FRE-137 la base refuse la chaîne vide.
        # Ce décor disait « pas de réalisé » — il le dit maintenant comme une
        # absence, ce qui est le même cas et la seule écriture possible.
        "UPDATE training_exercises SET kind = 'rehab', tempo = '3010', "
        "reps = '12', reps_done = NULL, reps_unit = 'count' WHERE name = 'SQUAT'"))
    squat = next(e for e in _lignes(client_lu) if e["name"] == "SQUAT")
    assert squat["mechano"] == 48


def test_la_lecture_NE_score_PAS_les_lignes_d_entrainement(monde_lu, client_lu):
    """⚠️ L'ASSERTION QUI PORTE LA DEMANDE, et la seule que `ff_mechano` ne peut
    pas garder seule : la fonction, elle, calcule tout ce qu'on lui donne. C'est
    la LECTURE qui décide de ne l'appeler que sur `rehab`.

    Le même tempo et les mêmes reps que le test précédent, sans la nature :
    le score serait parfaitement calculable, il ne doit pas être servi. Sans
    cette moitié, la métrique s'afficherait sur les 11 820 lignes d'entraînement
    de la production."""
    monde_lu.execute(text(
        "UPDATE training_exercises SET kind = NULL, tempo = '3010', reps = '12' "
        "WHERE name = 'SQUAT'"))
    squat = next(e for e in _lignes(client_lu) if e["name"] == "SQUAT")
    assert squat["mechano"] is None


def test_le_score_est_NULL_et_JAMAIS_chaine_vide(monde_lu, client_lu):
    """⚠️ LE DÉFAUT LE PLUS RÉCURRENT DU PROJET, pris à la frontière de sortie.

    `_sortie` transforme par défaut tout NULL en `''` — le contrat front type la
    plupart de ces champs `string`. Appliquée à `mechano`, cette règle produisait
    `''` là où le contrat annonce `float | None`, et FastAPI rendait un **500**
    sur l'arbre ENTIER : douze erreurs de validation pour une ligne sans score.

    D'où `mechano` dans `_NON_TEXTE`. Ce test garde l'exception, sans quoi elle
    se ferait retirer un jour par souci de symétrie."""
    lignes = _lignes(client_lu)
    assert any(e["mechano"] is None for e in lignes), "aucune ligne sans score : ce test ne prouve rien"
    assert not any(e["mechano"] == "" for e in lignes)


def test_le_score_RENVOYE_a_l_ecriture_est_ignore_sans_erreur(monde_lu, client_lu):
    """⚠️ L'INVARIANT DU PROJET : ce que la lecture rend doit pouvoir lui être
    RENVOYÉ tel quel. Un client qui relit une ligne et la réécrit — le geste le
    plus banal qui soit — renvoie forcément `mechano`.

    Deux façons de casser, toutes deux rencontrées en écrivant ce ticket :
    `extra="forbid"` sur le schéma rendait 422, et laisser le champ atteindre le
    SQL levait `KeyError: 'mechano'`, donc 500. Le contrat l'ACCEPTE et
    `_LECTURE_SEULE` l'écarte avant la requête."""
    monde_lu.execute(text(
        "UPDATE training_exercises SET kind = 'rehab', tempo = '3010', reps = '12' "
        "WHERE name = 'SQUAT'"))
    squat = next(e for e in _lignes(client_lu) if e["name"] == "SQUAT")

    r = client_lu.patch(f"/programs/p1/exercises/{squat['id']}",
                        headers={"Authorization": "Bearer x"},
                        json={"mechano": 999, "coachNote": "vu"})
    assert r.status_code == 200, r.text[:300]

    # La note est passée, le score n'a pas été « écrit » — il se recalcule.
    relu = next(e for e in _lignes(client_lu) if e["name"] == "SQUAT")
    assert relu["coachNote"] == "vu"
    assert relu["mechano"] == 48


def test_une_serie_a_ZERO_repetition_vaut_ZERO(pg):
    """⚠️ `0` N'EST PAS « PAS DE SCORE », ET LA NUANCE EST DE WILLIAM (25/08).

    J'avais d'abord fait retomber ce cas sur la prescription, pour coller à
    `effectiveReps` côté front (`0 || x` y rend `x`). Sa remarque tient en une
    ligne : « 0 × quelque chose, ça fait 0 ». Une série rapportée à zéro
    répétition n'a produit AUCUN temps sous tension — créditer le prescrit
    compterait un travail qui n'a pas eu lieu, et le ferait en silence, sur la
    seule métrique dont le kiné se sert.

    C'est aussi la convention que le tonnage tient déjà : `coalesce(reps_done,
    reps)`, où `0` est une valeur et non une absence."""
    assert _score(pg, "4040", 0) == 0
    assert _score(pg, "4040", 0) is not None
