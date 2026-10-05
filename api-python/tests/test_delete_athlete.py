"""`delete_athlete` compte ce que la cascade emporte — TOUT, et rien de plus (FRE-89).

⚠️ POURQUOI CES SPECS. L'ancienne version listait cinq tables à la main ; la
cascade en traverse quatorze. Le dry-run sous-estimait donc ce qui part, sur le
seul geste du projet où le chiffre compte. La nouvelle version lit la cascade
dans `pg_constraint` : ces specs vérifient qu'elle descend jusqu'au bout de
l'arbre, qu'elle distingue ce qui est PRÉSERVÉ (SET NULL), et que `--commit`
fait exactement ce que le dry-run annonçait.
"""

import pytest
from sqlalchemy import text

from scripts.delete_athlete import main, parcourir

_ATH = "11111111-1111-1111-1111-111111111111"
_AUTRE = "22222222-2222-2222-2222-222222222222"


def _compte(conn, table: str) -> int:
    return conn.execute(text(f"SELECT count(*) FROM {table}")).scalar()


@pytest.fixture
def monde(pg):
    """Un athlète avec un compte, un programme et un arbre complet jusqu'à
    l'exercice, un bilan avec un résultat, une participation en compétition —
    et un SECOND athlète, témoin : rien de ce qui est à lui ne doit bouger."""
    pg.execute(text("INSERT INTO users (uid, email) VALUES ('coach-1','c@x.fr'), "
                    "('ath-1','a@x.fr'), ('ath-2','b@x.fr')"))
    pg.execute(text("INSERT INTO coaches (uid) VALUES ('coach-1')"))
    pg.execute(text(
        "INSERT INTO athletes (id, legacy_id, coach_uid, user_uid, first_name, last_name) VALUES "
        f"('{_ATH}', 'a1', 'coach-1', 'ath-1', 'Aubin', 'Martin'),"
        f"('{_AUTRE}', 'a2', 'coach-1', 'ath-2', 'Bea', 'Second')"))
    for pid, ath in (("p1", _ATH), ("p2", _AUTRE)):
        pg.execute(text("INSERT INTO programs (id, coach_uid, athlete_id) "
                        f"VALUES ('{pid}', 'coach-1', '{ath}')"))
        macro = pg.execute(text(
            "INSERT INTO training_macros (program_id, legacy_id, number, name) "
            f"VALUES ('{pid}', 'm-{pid}', 1, 'Prépa') RETURNING id")).scalar()
        bloc = pg.execute(text(
            "INSERT INTO training_blocks (macro_id, legacy_id, number, name) "
            f"VALUES ('{macro}', 'b-{pid}', 1, 'B1') RETURNING id")).scalar()
        semaine = pg.execute(text(
            "INSERT INTO training_weeks (block_id, legacy_id, number, name) "
            f"VALUES ('{bloc}', 'w-{pid}', 1, 'S1') RETURNING id")).scalar()
        seance = pg.execute(text(
            "INSERT INTO training_sessions (week_id, legacy_id, position, name) "
            f"VALUES ('{semaine}', 's-{pid}', 1, 'Séance A') RETURNING id")).scalar()
        for i in (1, 2):
            pg.execute(text(
                "INSERT INTO training_exercises (session_id, position, name) "
                f"VALUES ('{seance}', {i}, 'SQUAT')"))
    pg.execute(text(
        "INSERT INTO athlete_prs (athlete_id, movement, reps, weight_kg) "
        f"VALUES ('{_ATH}', 'SQUAT', 1, 150)"))
    bilan = pg.execute(text(
        "INSERT INTO bilans (athlete_id, modele_nom, bilan_date) "
        f"VALUES ('{_ATH}', 'Bilan kiné', DATE '2026-08-01') RETURNING id")).scalar()
    pg.execute(text(
        "INSERT INTO bilan_resultats (bilan_id, test_libelle, mesure, bilateral) "
        f"VALUES ('{bilan}', 'Grip', 'aucune', false)"))
    pg.execute(text(
        "INSERT INTO competitions (id, name, start_date, end_date, created_by) VALUES "
        "('cccccccc-0000-0000-0000-000000000001', 'Open', DATE '2026-05-01', "
        "DATE '2026-05-01', 'coach-1')"))
    pg.execute(text(
        "INSERT INTO competition_participants (competition_id, athlete_id, name) VALUES "
        f"('cccccccc-0000-0000-0000-000000000001', '{_ATH}', 'Aubin Martin')"))
    return pg


def _branches_a_plat(branches) -> dict[str, int]:
    plat = {}
    for b in branches:
        plat[b.table] = plat.get(b.table, 0) + b.lignes
        plat.update({k: plat.get(k, 0) + v for k, v in _branches_a_plat(b.enfants).items()})
    return plat


def test_la_cascade_est_lue_JUSQU_AU_BOUT_de_l_arbre(monde):
    """L'ancien script s'arrêtait à `programs`. La cascade, elle, descend jusqu'à
    l'exercice — et c'est là que vivent deux ans d'historique."""
    branches, preserves = parcourir(
        monde, "athletes", "SELECT id FROM athletes WHERE id = :a", {"a": _ATH})
    plat = _branches_a_plat(branches)

    assert plat == {
        "programs": 1, "training_macros": 1, "training_blocks": 1, "training_weeks": 1,
        "training_sessions": 1, "training_exercises": 2,
        "athlete_prs": 1, "bilans": 1, "bilan_resultats": 1,
    }
    # Ce qui SURVIT est dit aussi : le récapitulatif est complet dans les deux sens.
    assert preserves == {"competition_participants": 1}


def test_le_DRY_RUN_ne_supprime_rien(monde, capsys):
    assert main(["a1"]) == 0
    sortie = capsys.readouterr().out
    assert "DRY-RUN" in sortie and "training_exercises" in sortie and "PRÉSERVÉ" in sortie
    assert _compte(monde, "athletes") == 2 and _compte(monde, "training_exercises") == 4


def test_COMMIT_emporte_l_arbre_et_PRESERVE_la_participation(monde):
    assert main(["a1", "--commit"]) == 0

    assert monde.execute(text("SELECT legacy_id FROM athletes")).scalars().all() == ["a2"]
    # L'arbre du témoin est intact : la cascade n'a suivi que SES clés.
    assert _compte(monde, "training_exercises") == 2
    assert _compte(monde, "bilans") == 0 and _compte(monde, "athlete_prs") == 0
    # La participation reste, orpheline de sa fiche mais pas de son nom.
    assert monde.execute(text(
        "SELECT athlete_id IS NULL, name FROM competition_participants")).first() == (True, "Aubin Martin")
    # Le compte n'est PAS dans la cascade : conservé sans --with-user.
    assert _compte(monde, "users") == 3


def test_WITH_USER_supprime_aussi_le_compte(monde):
    assert main(["a1", "--commit", "--with-user"]) == 0
    assert monde.execute(text("SELECT uid FROM users ORDER BY uid")).scalars().all() == [
        "ath-2", "coach-1"]


def test_un_athlete_inconnu_arrete_tout_AVANT_d_ecrire(monde):
    with pytest.raises(SystemExit, match="introuvable"):
        main(["a1", "inconnu", "--commit"])
    assert _compte(monde, "athletes") == 2
