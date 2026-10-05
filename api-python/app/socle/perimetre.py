"""Qui écrit QUOI : le périmètre d'écriture de chaque rôle, en un seul endroit.

Deux structures, deux questions :

  * `CHAMPS_PAR_ROLE` — quels CHAMPS, à quel NIVEAU de structure ;
  * `CHAMPS_REALISE` — quels champs d'une LIGNE sont du réalisé, le complément
    étant de la prescription.

⚠️ La NATURE d'une ligne ne porte aucun droit : `rehab` est une étiquette, comme
`warmup`. Le kiné programme comme le coach sur l'athlète qu'il suit.

⚠️ La règle vient TOUJOURS de `access.roles`, jamais d'une comparaison d'uid.
`require_program_access` (`app/socle/authz.py`) est le seul endroit qui sache
d'où viennent les rôles (FRE-64) : ce module en consomme, il n'en fabrique pas.
"""

from fastapi import status

from app.socle.authz import ProgramAccess
from app.socle.erreurs import ErreurMetier

# --------------------------------------------------------------------------- #
# GRAIN 1 — les CHAMPS, par niveau de structure
# --------------------------------------------------------------------------- #

# QUI PROGRAMME : le coach de l'athlète et son kiné, à égalité — le staff
# s'organise entre humains, le logiciel n'arbitre pas. Nommé une fois ici plutôt
# que répété à chaque garde : l'ensemble s'élargit d'un seul endroit.
PROGRAMMEURS = frozenset({"coach", "kine"})

# Ce que chaque rôle NON-PROGRAMMEUR écrit, par niveau. Le staff n'y figure pas :
# il écrit tout.
#
# ⚠️ L'athlète décrit SON ÉTAT — ce qu'il pèse, comment il se sent — jamais la
# programmation. La méta d'une semaine (nom, dates, `hidden`) lui reste fermée,
# même là où la route lui est ouverte (`coach_or_athlete`).
CHAMPS_PAR_ROLE: dict[str, dict[str, set[str]]] = {
    "athlete": {
        "semaine": {"athleteWeightKg", "athleteHeightCm"},
        "seance": {"formOfTheDay"},
    },
}


def refuser_hors_perimetre(access: ProgramAccess, niveau: str, fourni: dict) -> None:
    """403 sur les champs de STRUCTURE que le rôle de l'appelant ne couvre pas.

    ⚠️ Le rôle vient de `access.roles`, JAMAIS d'une comparaison d'uid faite ici :
    un deuxième endroit qui sait d'où viennent les rôles serait oublié le jour où
    leur source change (FRE-64), et ouvrirait un accès sans que rien le signale.

    Raises:
        ErreurMetier: `champs_reserves_au_staff` (403).
    """
    if PROGRAMMEURS & access.roles:
        return                          # le staff écrit tout
    # UNION des rôles portés : on peut être l'athlète ET le kiné d'un programme,
    # et le périmètre est alors la somme des deux, pas le premier rencontré.
    permis: set[str] = set()
    for role in access.roles:
        permis |= CHAMPS_PAR_ROLE.get(role, {}).get(niveau, set())
    interdits = sorted(set(fourni) - permis)
    if interdits:
        # 403 et non 404 : l'objet existe et le porteur y a bien accès — c'est le
        # CHAMP qui lui est refusé. Le masquer n'aurait aucun sens, il le lit.
        raise ErreurMetier("champs_reserves_au_staff", status.HTTP_403_FORBIDDEN,
                            detail=f"champs réservés au staff : {', '.join(interdits)}")


# --------------------------------------------------------------------------- #
# GRAIN 2 — les CHAMPS d'une LIGNE : prescription contre réalisé
# --------------------------------------------------------------------------- #

# Les champs du RÉALISÉ : ce que l'ATHLÈTE saisit après sa séance. Le complément
# (tout le reste d'une ligne) est la PRESCRIPTION, et n'appartient qu'à ceux qui
# programment.
#
# On définit le PETIT ensemble et on déduit le grand : un champ neuf tombe alors
# du côté prescription, c'est-à-dire du côté fermé. L'inverse aurait ouvert par
# défaut, et un oubli d'écriture est plus coûteux qu'un refus de trop.
CHAMPS_REALISE = frozenset({
    "repsDone", "weightDone", "restActual", "feltRPE", "feltRPEBySet",
    "repsDoneBySet", "weightDoneBySet", "toursRealises",
    "athleteFeedback",
})


def refuser_prescription(access: ProgramAccess, fourni: dict) -> None:
    """403 si l'appelant écrit de la PRESCRIPTION sans programmer ce programme.

    L'interface n'offre à l'athlète que le réalisé (`session-table.tsx`), mais
    « aucun écran ne le fait » n'est pas une autorisation (FRE-52) : sans cette
    garde, il écrit la charge PRESCRITE par la route.

    Raises:
        ErreurMetier: `prescription_reservee_au_staff` (403).
    """
    prescription = set(fourni) - CHAMPS_REALISE
    if prescription and not (PROGRAMMEURS & access.roles):
        raise ErreurMetier("prescription_reservee_au_staff", 
            status.HTTP_403_FORBIDDEN,
            detail=f"champs de prescription réservés au staff : "
                   f"{', '.join(sorted(prescription))}")
