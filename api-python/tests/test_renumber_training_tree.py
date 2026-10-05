"""Réparation des numéros de l'arbre (macro / bloc / semaine) — vrai Postgres.

L'anomalie de référence est REELLE et reproduite telle quelle : le bloc 3 de
« ROAD TO 100 » porte quatre semaines numérotées 2, 2, 3, 4. Elle ne peut plus
être fabriquée par l'API (les suppressions recompactent depuis FRE-12), elle est
donc semée en SQL — c'est bien de la donnée écrite AVANT le correctif que ce
script s'occupe.

⚠️ ET DEPUIS FRE-134, LA BASE ELLE-MÊME LA REFUSE. Trois contraintes
`UNIQUE (parent, number)` ferment la porte au doublon ; ces specs sont donc
devenues INSEMABLES du jour au lendemain (11 rouges le 09/09). On les diffère
explicitement pour semer, ce que la déclaration `DEFERRABLE` autorise — et le
report ne dure que la transaction du test, qui est annulée.

⚠️ CE FICHIER RESTE, ET C'EST DÉLIBÉRÉ. La contrainte empêche les doublons
FUTURS, elle ne répare pas les anciens ni ne ferme les TROUS — un `number` qui
saute de 2 à 4 est toujours possible sur de la donnée d'avant FRE-12, et c'est ce
que ce script sert à corriger.

Ce qu'on vérifie, par ordre d'importance :
  1. la PORTÉE : un parent voisin ne bouge jamais (un id Firestore n'est pas
     unique entre programmes) ;
  2. le NON-RÉORDONNANCEMENT : le script ferme les trous, il ne rebat pas les
     cartes ;
  3. le dry-run, l'idempotence, et le fait que les NOMS survivent.
"""

import pytest
from sqlalchemy import text

from scripts.renumber_training_tree import analyser, main

_MACRO = "aaaaaaaa-0000-0000-0000-{:012d}"
_BLOC = "bbbbbbbb-0000-0000-0000-{:012d}"


@pytest.fixture
def monde(pg):
    """Deux programmes, chacun un macro, chacun deux blocs. Les semaines sont
    semées par test : c'est leur numérotation qui est le sujet."""
    # Le report des trois contraintes de numéro : sans lui, `_semer_semaines`
    # ne peut plus écrire l'anomalie que ce script répare (cf. l'en-tête).
    pg.execute(text("SET CONSTRAINTS training_macros_program_number_unique, "
                    "training_blocks_macro_number_unique, "
                    "training_weeks_block_number_unique DEFERRED"))
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','a@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, coach_uid, first_name, last_name) VALUES "
        "('11111111-1111-1111-1111-111111111111','coach-1','Aubin','Martin'),"
        "('22222222-2222-2222-2222-222222222222','coach-1','Bea','Second')"))
    pg.execute(text(
        "INSERT INTO programs (id, coach_uid, athlete_id) VALUES "
        "('p1','coach-1','11111111-1111-1111-1111-111111111111'),"
        "('p2','coach-1','22222222-2222-2222-2222-222222222222')"))
    for i, pid in enumerate(("p1", "p2"), start=1):
        pg.execute(text(
            "INSERT INTO training_macros (id, program_id, legacy_id, number, name) "
            "VALUES (CAST(:id AS uuid), :p, :l, 1, 'Prépa')"),
            {"id": _MACRO.format(i), "p": pid, "l": f"macro-{pid}"})
        for b in (1, 2):
            pg.execute(text(
                "INSERT INTO training_blocks (id, macro_id, legacy_id, number, name) "
                "VALUES (CAST(:id AS uuid), CAST(:m AS uuid), :l, :n, :name)"),
                {"id": _BLOC.format(i * 10 + b), "m": _MACRO.format(i),
                 "l": f"bloc-{pid}-{b}", "n": b, "name": f"ROAD {pid}-{b}"})
    return pg


def _semer_semaines(conn, block_id: str, numeros: list[int], noms: list[str] | None = None):
    """Sème des semaines aux numéros DONNÉS — doublons et trous compris. Les
    `legacy_id` sont croissants dans l'ordre d'appel : c'est eux qui départagent
    deux semaines de même numéro, comme en production."""
    for rang, numero in enumerate(numeros):
        conn.execute(text(
            "INSERT INTO training_weeks (block_id, legacy_id, number, name) "
            "VALUES (CAST(:b AS uuid), :l, :n, :name)"),
            {"b": block_id, "l": f"sem-{rang:03d}", "n": numero,
             "name": noms[rang] if noms else None})


def _numeros(conn, block_id: str) -> list[int]:
    return [r[0] for r in conn.execute(text(
        "SELECT number FROM training_weeks WHERE block_id = CAST(:b AS uuid) "
        "ORDER BY number, legacy_id"), {"b": block_id}).all()]


def _noms(conn, block_id: str) -> list[str | None]:
    return [r[0] for r in conn.execute(text(
        "SELECT name FROM training_weeks WHERE block_id = CAST(:b AS uuid) "
        "ORDER BY number, legacy_id"), {"b": block_id}).all()]


# --------------------------------------------------------------------------- #
# Le constat
# --------------------------------------------------------------------------- #

def test_l_anomalie_reelle_est_detectee(monde):
    """2, 2, 3, 4 — pas de S1, deux S2. Le cas relevé sur ROAD TO 100."""
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4])
    groupes = analyser(monde)
    assert len(groupes) == 1
    g = groupes[0]
    assert (g.niveau, g.avant, g.apres) == ("semaine", [2, 2, 3, 4], [1, 2, 3, 4])
    assert g.doublons is True
    # UNE seule ligne à écrire : la première S2 devient S1, les trois autres
    # portent déjà le bon numéro. Le `WHERE number <> rang` du script les épargne.
    assert g.bouge == 1
    assert "Aubin Martin" in g.athlete and "ROAD p1-1" in g.contexte


def test_une_numerotation_deja_contigue_n_est_pas_signalee(monde):
    _semer_semaines(monde, _BLOC.format(11), [1, 2, 3])
    assert analyser(monde) == []


def test_un_simple_TROU_est_signale_aussi(monde):
    """Pas besoin de doublon : 1, 3, 4 est déjà de quoi faire sauter le numéro
    suivant à 5 (`max + 1`) et creuser l'écart avec ce que le front affiche."""
    _semer_semaines(monde, _BLOC.format(11), [1, 3, 4])
    (g,) = analyser(monde)
    assert (g.avant, g.apres, g.doublons) == ([1, 3, 4], [1, 2, 3], False)


# --------------------------------------------------------------------------- #
# Portée — le piège central
# --------------------------------------------------------------------------- #

def test_la_reparation_est_bornee_au_PARENT(monde):
    """Deux blocs, chacun ses semaines. Réparer l'un ne renumérote pas l'autre
    à la suite — ce que ferait un `row_number()` sans `PARTITION BY`."""
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4])
    _semer_semaines(monde, _BLOC.format(12), [1, 2, 3])
    assert main(["--commit"]) == 0
    assert _numeros(monde, _BLOC.format(11)) == [1, 2, 3, 4]
    assert _numeros(monde, _BLOC.format(12)) == [1, 2, 3]   # intact, pas 5, 6, 7


def test_deux_blocs_abimes_sont_reparES_independamment(monde):
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4])
    _semer_semaines(monde, _BLOC.format(12), [3, 7])
    assert main(["--commit"]) == 0
    assert _numeros(monde, _BLOC.format(11)) == [1, 2, 3, 4]
    assert _numeros(monde, _BLOC.format(12)) == [1, 2]


def test_le_programme_voisin_n_est_pas_touche(monde):
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4])
    _semer_semaines(monde, _BLOC.format(21), [1, 2])
    assert main(["--commit"]) == 0
    assert _numeros(monde, _BLOC.format(21)) == [1, 2]


def test_program_restreint_la_portee(monde):
    """Première passe prudente : on répare un programme, on regarde, on continue."""
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4])
    _semer_semaines(monde, _BLOC.format(21), [5, 6])
    assert main(["--commit", "--program", "p1"]) == 0
    assert _numeros(monde, _BLOC.format(11)) == [1, 2, 3, 4]
    assert _numeros(monde, _BLOC.format(21)) == [5, 6]      # p2 pas encore traité
    assert [g.contexte for g in analyser(monde, "p1")] == []
    assert len(analyser(monde, "p2")) == 1


# --------------------------------------------------------------------------- #
# Ce qui ne doit PAS bouger
# --------------------------------------------------------------------------- #

def test_la_reparation_NE_REORDONNE_PAS(monde):
    """Le tri est `number, legacy_id` — celui des lectures. Les deux semaines
    numéro 2 restent dans leur ordre relatif, elles ne s'échangent pas."""
    noms = ["Semaine 1", "Semaine 2", "Semaine 3", None]
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4], noms)
    avant = _noms(monde, _BLOC.format(11))
    assert main(["--commit"]) == 0
    assert _noms(monde, _BLOC.format(11)) == avant


def test_les_NOMS_ne_sont_pas_recales(monde):
    """Le coach a saisi « Semaine 1 / 2 / 3 » à la main. Les aligner sur les
    numéros serait écrire à sa place — après réparation, « Semaine 1 » porte le
    badge 1 par un heureux hasard, et c'est à lui de trancher pour la suite."""
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4],
                    ["Semaine 1", "Semaine 2", "Semaine 3", None])
    assert main(["--commit"]) == 0
    assert _noms(monde, _BLOC.format(11)) == ["Semaine 1", "Semaine 2", "Semaine 3", None]


def test_les_dates_et_le_reste_survivent(monde):
    monde.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number, start_date, hidden) "
        "VALUES (CAST(:b AS uuid), 'sem-a', 2, DATE '2026-01-05', true)"),
        {"b": _BLOC.format(11)})
    _semer_semaines(monde, _BLOC.format(11), [4])
    assert main(["--commit"]) == 0
    ligne = monde.execute(text(
        "SELECT number, start_date, hidden FROM training_weeks WHERE legacy_id = 'sem-a'")
    ).first()
    assert ligne.number == 1
    assert str(ligne.start_date) == "2026-01-05" and ligne.hidden is True


# --------------------------------------------------------------------------- #
# Dry-run, idempotence, comptes rendus
# --------------------------------------------------------------------------- #

def test_le_dry_run_n_ecrit_RIEN(monde, capsys):
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4])
    assert main([]) == 0
    assert _numeros(monde, _BLOC.format(11)) == [2, 2, 3, 4]
    sortie = capsys.readouterr().out
    assert "DRY-RUN" in sortie
    assert "2, 2, 3, 4  →  1, 2, 3, 4" in sortie


def test_le_dry_run_annonce_les_consequences(monde, capsys):
    """Les deux effets à connaître AVANT de décider sont dits en dry-run, pas
    seulement après écriture : `training_sets.week_number` en dérive, et les noms
    ne sont pas recalés."""
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4])
    main([])
    sortie = capsys.readouterr().out
    assert "training_sets`.week_number" in sortie or "week_number" in sortie
    assert "NOMS" in sortie


def test_idempotent(monde, capsys):
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4])
    assert main(["--commit"]) == 0
    assert main(["--commit"]) == 0
    assert "Rien à faire" in capsys.readouterr().out
    assert _numeros(monde, _BLOC.format(11)) == [1, 2, 3, 4]


def test_une_base_saine_ne_declenche_rien(monde, capsys):
    _semer_semaines(monde, _BLOC.format(11), [1, 2, 3])
    assert main(["--commit"]) == 0
    assert "Rien à faire" in capsys.readouterr().out


# --------------------------------------------------------------------------- #
# Les deux autres niveaux
# --------------------------------------------------------------------------- #

def test_les_BLOCS_troues_sont_repares(monde):
    monde.execute(text(
        "UPDATE training_blocks SET number = 7 WHERE legacy_id = 'bloc-p1-2'"))
    assert main(["--commit"]) == 0
    numeros = [r[0] for r in monde.execute(text(
        "SELECT number FROM training_blocks WHERE macro_id = CAST(:m AS uuid) "
        "ORDER BY number, legacy_id"), {"m": _MACRO.format(1)}).all()]
    assert numeros == [1, 2]


def test_les_MACROS_troues_sont_repares(monde):
    monde.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number) "
        "VALUES ('p1', 'macro-p1-b', 5)"))
    assert main(["--commit"]) == 0
    numeros = [r[0] for r in monde.execute(text(
        "SELECT number FROM training_macros WHERE program_id = 'p1' "
        "ORDER BY number, legacy_id")).all()]
    assert numeros == [1, 2]
    # …et le macro de p2 garde le sien.
    assert monde.execute(text(
        "SELECT number FROM training_macros WHERE program_id = 'p2'")).scalar() == 1


def test_les_trois_niveaux_en_une_passe(monde, capsys):
    monde.execute(text(
        "INSERT INTO training_macros (program_id, legacy_id, number) "
        "VALUES ('p1', 'macro-p1-b', 5)"))
    monde.execute(text(
        "UPDATE training_blocks SET number = 7 WHERE legacy_id = 'bloc-p1-2'"))
    _semer_semaines(monde, _BLOC.format(11), [2, 2, 3, 4])
    assert main(["--commit"]) == 0
    sortie = capsys.readouterr().out
    assert "=== MACRO" in sortie and "=== BLOC" in sortie and "=== SEMAINE" in sortie
    assert analyser(monde) == []
