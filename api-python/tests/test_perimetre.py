"""LE PÉRIMÈTRE PAR CHAMP, ET SES DEUX CODES (FRE-142).

⚠️ `grep champs_reserves_au_staff tests/` = 0, `grep prescription_reservee_au_staff
tests/` = 0 au 06/09. Les refus du périmètre n'étaient éprouvés que par leur
STATUT : une route qui aurait inversé les deux codes — ou qui aurait rendu un
`programme_hors_perimetre` à la place — restait verte. Or le front branche son
message sur le CODE (`save-error.ts`), pas sur le 403.

⚠️ ET LE RÔLE COMBINÉ N'EXISTAIT DANS AUCUN HARNAIS. Mesuré sur Neon : les 4
coachs sont athlètes, 1 kiné sur 2 est coach. `refuser_hors_perimetre` et
`refuser_prescription` font l'UNION des rôles ; aucune spec ne construisait
`{coach, athlete}`. FRE-118 et FRE-127 ont chacune laissé passer un défaut par
là. William est les deux, et toute règle branchée sur le rôle lui passait au
vert sans être éprouvée.

Ici les fonctions sont appelées DIRECTEMENT, avec un `ProgramAccess` fabriqué :
c'est le grain où l'union se lit. Le chemin par la route est dans
`test_training_lines.py` (le coach-athlète écrit sa prescription).
"""

import pytest

from app.socle.authz import ProgramAccess
from app.socle.erreurs import ErreurMetier
from app.socle.perimetre import refuser_hors_perimetre, refuser_prescription


def _acces(*roles: str) -> ProgramAccess:
    return ProgramAccess(program_id="p1", claims={"uid": "x"}, roles=frozenset(roles))


# --------------------------------------------------------------------------- #
# Grain 1 — les champs de structure
# --------------------------------------------------------------------------- #


def test_l_athlete_seul_est_refuse_AVEC_LE_BON_CODE():
    with pytest.raises(ErreurMetier) as exc:
        refuser_hors_perimetre(_acces("athlete"), "semaine", {"name": "Deload"})
    assert exc.value.code == "champs_reserves_au_staff"
    assert exc.value.status_code == 403


def test_l_athlete_ecrit_ce_qui_est_a_lui():
    refuser_hors_perimetre(_acces("athlete"), "semaine", {"athleteWeightKg": 80})
    refuser_hors_perimetre(_acces("athlete"), "seance", {"formOfTheDay": 7})


def test_le_coach_qui_est_aussi_l_athlete_ecrit_tout():
    """⚠️ L'UNION, PAS LE PREMIER RÔLE RENCONTRÉ. Un `for role in roles: return
    CHAMPS_PAR_ROLE[role]` tomberait sur `athlete` une fois sur deux — un
    `frozenset` n'a pas d'ordre — et refuserait au coach son propre programme."""
    refuser_hors_perimetre(_acces("coach", "athlete"), "semaine", {"name": "Deload"})
    refuser_hors_perimetre(_acces("athlete", "coach"), "semaine", {"name": "Deload"})


# --------------------------------------------------------------------------- #
# Grain 2 — prescription contre réalisé
# --------------------------------------------------------------------------- #


def test_l_athlete_seul_n_ecrit_pas_la_prescription_AVEC_LE_BON_CODE():
    with pytest.raises(ErreurMetier) as exc:
        refuser_prescription(_acces("athlete"), {"weight": "80", "feltRPE": "8"})
    assert exc.value.code == "prescription_reservee_au_staff"
    assert exc.value.status_code == 403
    # Le détail NOMME le champ fautif — c'est ce que le coach recopie.
    assert "weight" in exc.value.detail
    assert "feltRPE" not in exc.value.detail


def test_l_athlete_seul_ecrit_son_realise():
    refuser_prescription(_acces("athlete"), {"feltRPE": "8", "repsDone": "5"})


def test_le_coach_qui_est_aussi_l_athlete_ecrit_la_prescription():
    refuser_prescription(_acces("coach", "athlete"), {"weight": "80"})
    refuser_prescription(_acces("athlete", "coach"), {"weight": "80"})


def test_les_deux_codes_ne_se_confondent_pas():
    """La spec qui manquait : une route qui inverserait les deux gardes rend le
    MAUVAIS code, et c'est un message faux à l'écran."""
    with pytest.raises(ErreurMetier) as structure:
        refuser_hors_perimetre(_acces("athlete"), "seance", {"name": "X"})
    with pytest.raises(ErreurMetier) as ligne:
        refuser_prescription(_acces("athlete"), {"name": "X"})
    assert structure.value.code != ligne.value.code
