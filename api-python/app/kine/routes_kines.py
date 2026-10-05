"""Le répertoire des KINÉS déclarés (FRE-65).

Une seule lecture, pour un seul consommateur : le sélecteur « Suivi kiné » de la
fiche athlète, où le coach choisit à qui il confie un suivi. D'où `require_coach`.

⚠️ Elle ne rend que l'identité de compte (uid, nom, email), JAMAIS les athlètes
suivis : « qui est suivi par un kiné » est une information de santé, servie par
`/athletes/mine` au seul coach concerné (cf. `_MINE_*_SQL`).
"""

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.socle.erreurs import erreurs
from app.socle.authz import is_admin, require_coach
from app.socle.db import get_session
from app.kine.schemas_kine import KineLu

router = APIRouter(prefix="/kines", tags=["kines"])

# ⚠️ Les kinés de la STRUCTURE du coach (FRE-13) — l'admin les voit tous. Sans ce
# filtre, un coach confierait un athlète au kiné d'une autre structure sans que
# celle-ci l'ait décidé. Le LIEN reste libre à l'écriture
# (`PATCH /athletes/{id}/kine`) : un kiné peut suivre un athlète d'une autre
# structure (l'habilitation nominative de l'étude, §5.3). Ce qui se borne ici,
# c'est ce qu'on PROPOSE.
_LIST_KINES_SQL = text(
    """
    SELECT k.uid, u.display_name, u.email
    FROM kines k JOIN users u ON u.uid = k.uid
    WHERE CAST(:admin AS boolean)
       OR k.structure = (SELECT c.structure FROM coaches c WHERE c.uid = :uid)
    ORDER BY u.display_name, u.email
    """
)


@router.get("", response_model=list[KineLu], responses=erreurs(401, 403))
def list_kines(claims: dict = Depends(require_coach)) -> list:
    """Les kinés déclarés, pour le sélecteur d'affectation du coach."""
    with get_session() as session:
        rows = session.execute(
            _LIST_KINES_SQL, {"uid": claims["uid"], "admin": is_admin(claims["uid"])}).mappings().all()
    return [
        {"uid": r["uid"], "displayName": r["display_name"], "email": r["email"]}
        for r in rows
    ]
