"""Santé et identité — aucune logique métier.

Ce que le déploiement interroge : le service répond, la base aussi, et l'ID token
Firebase se vérifie de bout en bout.
"""

import logging

from fastapi import APIRouter, Depends, status
from sqlalchemy import text

from app.socle.erreurs import erreurs
from app.socle.auth import verify_token
from app.socle.config import settings
from app.socle.db import BORNES_DU_ROLE, get_session
from app.socle.erreurs import ErreurMetier

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    """Liveness — public, pas d'auth. Rend aussi la version déployée.

    ⚠️ `version` est la seule façon de savoir ce qui TOURNE : le tag de l'image
    dit ce qu'on a POUSSÉ, pas ce que Cloud Run EXÉCUTE. Ici la réponse vient du
    processus lui-même, et `make verifier` la compare au SHA après un déploiement.

    Public délibérément : une sonde qu'il faut un jeton pour lire n'est pas
    consultée en incident, et un SHA n'apprend rien que le dépôt ne dise déjà.

    `null` en local, où rien n'injecte `GIT_SHA` (cf. `config.version_deployee`).
    """
    return {
        "status": "ok",
        "service": "brokkr",
        "version": settings.version_deployee,
    }


@router.get("/health/db", responses=erreurs(503))
def health_db() -> dict:
    """Readiness Postgres — public, pas d'auth. 200 si la connexion répond, 503 sinon.

    ⚠️ Rend aussi les BORNES DE SESSION telles que brokkr les reçoit (FRE-154).
    Elles vivent sur le rôle (`ALTER ROLE … SET`, FRE-135), et le pooler de Neon
    ne les propage pas. Un invariant joué depuis un poste lit la connexion du
    `.env`, qui vise l'hôte direct : seul le processus qui tourne dit ce que la
    PRODUCTION reçoit, par le chemin qu'elle emprunte.

    `make verifier` compare ces valeurs à `BORNES_DU_ROLE` après chaque
    déploiement : c'est ce couple qui garde le choix d'endpoint de Cloud Run.

    Rien de secret : un délai maximum et un fuseau horaire."""
    try:
        with get_session() as session:
            bornes = {
                reglage: session.execute(
                    text("SELECT current_setting(:r)"), {"r": reglage}).scalar()
                for reglage in BORNES_DU_ROLE
            }
    except Exception:
        logger.exception("health/db : connexion Postgres injoignable")
        raise ErreurMetier("base_injoignable",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="base de données injoignable",
        )
    return {"ok": True, "bornes": bornes}


@router.get("/whoami", responses=erreurs(401))
def whoami(claims: dict = Depends(verify_token)) -> dict:
    """Renvoie l'identité dérivée du token — prouve que l'auth marche."""
    return {"uid": claims["uid"], "email": claims.get("email")}
