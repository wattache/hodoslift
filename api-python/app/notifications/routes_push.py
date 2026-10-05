"""Les abonnements push de l'appelant : s'abonner, se désabonner, et la clé
publique qu'il faut au navigateur pour le faire."""
from fastapi import APIRouter, Depends

from app.notifications import metier_push
from app.notifications.schemas_push import AbonnementPush, ClePubliquePush, RetraitPush
from app.personnes.metier_athletes import ensure_user
from app.socle.audit import log_write
from app.socle.auth import verify_token
from app.socle.config import settings
from app.socle.db import get_session
from app.socle.erreurs import erreurs
from app.socle.schemas_ecriture import Confirmation

router = APIRouter(tags=["push"])


@router.get("/push/vapid", response_model=ClePubliquePush, responses=erreurs(401))
def cle_publique(claims: dict = Depends(verify_token)) -> dict:
    """La clé publique VAPID — `null` tant que le serveur n'en a pas : le front
    ne propose alors pas le réglage, plutôt qu'un abonnement qui ne recevra rien."""
    return {"clePublique": settings.vapid_public_key or None}


@router.post("/users/me/push", response_model=Confirmation, responses=erreurs(401))
def s_abonner(payload: AbonnementPush, claims: dict = Depends(verify_token)) -> dict:
    """Enregistre l'abonnement de CE navigateur pour l'appelant."""
    uid = claims["uid"]
    with get_session() as session:
        ensure_user(session, uid=uid, email=(claims.get("email") or "").strip().lower())
        metier_push.poser_abonnement(session, uid=uid, endpoint=payload.endpoint,
                                     p256dh=payload.keys.p256dh, auth=payload.keys.auth)
    log_write(uid=uid, resource="push_subscription", doc_path=f"users/{uid}/push", fields=["subscribe"])
    return {"ok": True}


@router.post("/users/me/push/retrait", response_model=Confirmation, responses=erreurs(401))
def se_desabonner(payload: RetraitPush, claims: dict = Depends(verify_token)) -> dict:
    """Retire l'abonnement de CE navigateur. Idempotent : un endpoint inconnu
    ou déjà parti ne fait rien."""
    uid = claims["uid"]
    with get_session() as session:
        metier_push.retirer_abonnement(session, uid=uid, endpoint=payload.endpoint)
    log_write(uid=uid, resource="push_subscription", doc_path=f"users/{uid}/push", fields=["unsubscribe"])
    return {"ok": True}
