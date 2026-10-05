"""Le référentiel des catégories de poids, en lecture, réservé aux membres.

Il alimente le sélecteur du front, filtré par le genre du participant. Le couple
(gender, code) est la clé de la FK competition_participants → weight_categories :
sans référentiel servi, le front saisirait en texte libre des valeurs que la FK
refuse. Aucune donnée personnelle ici.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.socle.erreurs import erreurs
from app.socle.authz import require_membre
from app.socle.db import get_session
from app.competitions.schemas_weight_category import CategoriesDePoids

router = APIRouter(prefix="/weight-categories", tags=["weight-categories"])

# `position` encode l'ordre LOGIQUE (les -XX croissants, le +XX en dernier) : un
# tri sur `code` donnerait -101 avant -66.
_LIST_SQL = text("SELECT gender, code FROM weight_categories ORDER BY gender, position")


@router.get("", response_model=CategoriesDePoids, responses=erreurs(401, 403))
def list_weight_categories(claims: dict = Depends(require_membre)) -> dict:
    """Les catégories groupées par genre, dans l'ordre logique.

    Ex. : {"M": ["-66", …, "+101"], "F": ["-52", …, "+70"]}.

    ⚠️ MEMBRES, par cohérence plus que par risque : la règle tient si elle est
    simple — lire le contenu du club demande d'appartenir au club, sans exception
    à retenir.
    """
    with get_session() as session:
        rows = session.execute(_LIST_SQL).all()
    grouped: dict[str, list[str]] = {}
    for gender, code in rows:
        grouped.setdefault(gender, []).append(code)
    return {g: grouped.get(g, []) for g in ("M", "F")}
