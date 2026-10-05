"""Lecture de l'arbre d'entraînement d'un programme : l'arbre entier, la charpente, un bloc.

La LECTURE, et elle seule. L'écriture vit dans `routes_training_lines.py` (grain
de la ligne) et `routes_training_structure.py` (grain de l'objet).

Les trois routes portent la même autorisation — l'athlète, son coach, son kiné —
et la même règle sur les semaines masquées (`_programme`).
"""

from fastapi import APIRouter, Depends, status

from app.socle.erreurs import ErreurMetier, erreurs
from app.socle.authz import ProgramAccess, require_program_access
from app.socle.db import get_session
from app.entrainement.schemas_training_lecture import ArbreLu, ContenuDeBloc, StructureLue
from app.socle.perimetre import PROGRAMMEURS
from app.entrainement.training_tree import read_block_content, read_structure, read_tree

router = APIRouter(prefix="/programs/{program_id}", tags=["programs"])


def _programme(access: ProgramAccess) -> bool:
    """Dit si ce lecteur COMPOSE le programme (FRE-158).

    C'est ce qui décide des semaines masquées : celui qui programme les reçoit —
    sinon il ne pourrait plus les démasquer — celui qui s'entraîne ne les reçoit
    pas. `PROGRAMMEURS` est nommé une fois dans `perimetre.py`, pas recopié ici.

    ⚠️ L'UNION des rôles, jamais le premier : un coach est souvent AUSSI athlète
    (FRE-142).
    """
    return bool(PROGRAMMEURS & access.roles)


@router.get("/training", response_model=ArbreLu, responses=erreurs(401, 403, 404))
def get_training(
    access: ProgramAccess = Depends(require_program_access("coach_or_athlete_or_kine")),
) -> dict:
    """Assemble tout le programme (macros → blocs → semaines → séances → lignes).

    OUVERTE AU KINÉ de l'athlète (FRE-52), et sur le programme ENTIER, pas sur
    les seules lignes rehab : c'est le reste de la semaine — les charges, le
    volume, les jours de squat — qui dit s'il peut charger une épaule le
    lendemain.

    Celui qui programme reçoit aussi les semaines masquées ; l'athlète non.
    """
    with get_session() as session:
        return read_tree(session, access.program_id, _programme(access))

@router.get("/structure", response_model=StructureLue, responses=erreurs(401, 403, 404))
def get_structure(
    access: ProgramAccess = Depends(require_program_access("coach_or_athlete_or_kine")),
) -> dict:
    """Rend la charpente du programme — macros, blocs, semaines — SANS le contenu (FRE-119).

    `GET /training` rend l'arbre entier, qui grossit d'une semaine par semaine
    sans borne ; le calendrier n'affiche qu'une frise — numéros, dates, objectifs
    de bloc.

    Même autorisation que `/training` : c'est la même donnée, en moins détaillée.
    """
    with get_session() as session:
        return read_structure(session, access.program_id, _programme(access))


@router.get("/blocks/{block_id}/content", response_model=ContenuDeBloc,
            responses=erreurs(401, 403, 404))
def get_block_content(
    block_id: str,
    access: ProgramAccess = Depends(require_program_access("coach_or_athlete_or_kine")),
) -> dict:
    """Rend le CONTENU d'un bloc : sa trame, et les séances de ses semaines (FRE-119).

    ⚠️ Se lit AVEC `/structure`, jamais seule : la charpente donne les numéros,
    les dates et l'athlète ; celle-ci ne donne que ce qui manque. L'écran
    d'entraînement charge ainsi UN bloc, dont le poids ne grossit pas avec le
    programme.

    ⚠️ 404 si le bloc n'est pas dans CE programme, jamais 403. Sans cette
    vérification, l'autorisation porterait sur le programme de l'URL pendant que
    la réponse viendrait d'un autre — et les ids sont des uuid connus des coachs.

    Même autorisation que `/training` — l'athlète, son coach, son kiné.

    Raises:
        ErreurMetier: `objet_arbre_introuvable` (404).
    """
    with get_session() as session:
        contenu = read_block_content(session, access.program_id, block_id, _programme(access))
    if contenu is None:
        raise ErreurMetier("objet_arbre_introuvable", status.HTTP_404_NOT_FOUND,
                            detail="bloc introuvable")
    return contenu
