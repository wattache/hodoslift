"""L'envoi des notifications push — Web Push standard, VAPID, sans FCM.

⚠️ RIEN ICI NE FAIT ÉCHOUER LE GESTE QUI NOTIFIE. Générer une semaine est
l'acte ; prévenir l'athlète est un effet. Un service de push injoignable, une
clé absente, un endpoint mort : ça se journalise, ça ne remonte pas.

⚠️ PAS FCM, bien que `firebase-admin` soit déjà là : la sortie de GCP est
décidée, et Web Push + VAPID parle directement au service de push de chaque
navigateur — la clé privée est à nous, le jour où brokkr change d'hébergeur
rien ne bouge.
"""
import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy import text

from app.socle.config import settings
from app.socle.db import get_session

logger = logging.getLogger(__name__)

#: L'envoi lui-même, séparé pour que les tests le remplacent.
_envoyer = webpush

_POSER_SQL = text(
    "INSERT INTO push_subscriptions (endpoint, uid, p256dh, auth) "
    "VALUES (:endpoint, :uid, :p256dh, :auth) "
    # Le même appareil sous un autre compte : l'abonnement change de main.
    "ON CONFLICT (endpoint) DO UPDATE SET uid = EXCLUDED.uid, p256dh = EXCLUDED.p256dh, "
    "auth = EXCLUDED.auth, created_at = now()"
)
_RETIRER_SQL = text("DELETE FROM push_subscriptions WHERE endpoint = :endpoint AND uid = :uid")
_MORT_SQL = text("DELETE FROM push_subscriptions WHERE endpoint = :endpoint")
_DE_SQL = text("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE uid = :uid ORDER BY created_at")
_EST_ABONNE_SQL = text("SELECT 1 FROM push_subscriptions WHERE endpoint = :endpoint AND uid = :uid")
_DESTINATAIRE_SQL = text(
    "SELECT a.user_uid FROM programs p JOIN athletes a ON a.id = p.athlete_id WHERE p.id = :program_id"
)
_LANGUE_SQL = text("SELECT preferences->>'langue' FROM users WHERE uid = :uid")

#: Ce que l'athlète lit, dans SA langue (`users.preferences.langue`, posée par le
#: front à chaque changement). Le français quand il n'a rien dit.
_NOUVELLE_SEMAINE = {
    "fr": ("Nouvelle semaine", "Ton coach vient de préparer la semaine {n}."),
    "en": ("New week", "Your coach has just prepared week {n}."),
    "pl": ("Nowy tydzień", "Twój trener właśnie przygotował tydzień {n}."),
}


def poser_abonnement(conn, *, uid: str, endpoint: str, p256dh: str, auth: str) -> None:
    conn.execute(_POSER_SQL, {"endpoint": endpoint, "uid": uid, "p256dh": p256dh, "auth": auth})


def retirer_abonnement(conn, *, uid: str, endpoint: str) -> None:
    conn.execute(_RETIRER_SQL, {"endpoint": endpoint, "uid": uid})


def est_abonne(conn, *, uid: str, endpoint: str) -> bool:
    return conn.execute(_EST_ABONNE_SQL, {"endpoint": endpoint, "uid": uid}).first() is not None


def abonnements_de(conn, uid: str) -> list[dict]:
    return [dict(r) for r in conn.execute(_DE_SQL, {"uid": uid}).mappings()]


def destinataire_du_programme(conn, program_id: str) -> str | None:
    """Le compte de l'athlète du programme — `None` s'il n'a pas de compte."""
    return conn.execute(_DESTINATAIRE_SQL, {"program_id": program_id}).scalar()


def langue_de(conn, uid: str) -> str:
    """La langue de l'interface de ce compte ; `fr` s'il n'en a pas choisi."""
    langue = conn.execute(_LANGUE_SQL, {"uid": uid}).scalar()
    return langue if langue in _NOUVELLE_SEMAINE else "fr"


def configure() -> bool:
    return bool(settings.vapid_private_key and settings.vapid_public_key)


def envoyer(uid: str, *, titre: str, corps: str, url: str) -> int:
    """Pousse une notification à chaque appareil abonné de `uid`. Rend le nombre
    d'envois acceptés par les services de push.

    Un endpoint que le service déclare parti (404, 410) est supprimé : il ne
    reviendra pas, et le réessayer à chaque semaine ne ferait que du bruit."""
    if not configure():
        return 0
    with get_session() as conn:
        abonnements = abonnements_de(conn, uid)
    envoyes = 0
    for abo in abonnements:
        try:
            _envoyer(
                subscription_info={"endpoint": abo["endpoint"], "keys": {"p256dh": abo["p256dh"], "auth": abo["auth"]}},
                data=json.dumps({"titre": titre, "corps": corps, "url": url}, separators=(",", ":")),
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_contact},
                ttl=24 * 3600,
            )
            envoyes += 1
        except WebPushException as exc:
            code = getattr(getattr(exc, "response", None), "status_code", None)
            if code in (404, 410):
                with get_session() as conn:
                    conn.execute(_MORT_SQL, {"endpoint": abo["endpoint"]})
                logger.info("push : endpoint parti (%s), abonnement retiré", code)
            else:
                logger.warning("push : envoi refusé (%s) — %s", code, exc)
    return envoyes


def notifier_nouvelle_semaine(*, program_id: str, numero: int, auteur_uid: str) -> None:
    """Le coach vient de générer une semaine : l'athlète du programme le sait.

    Jamais l'auteur lui-même — un coach-athlète qui se programme n'a rien à
    apprendre. Et jamais une exception : la semaine EST générée, la réponse
    part quoi qu'il arrive ici."""
    try:
        with get_session() as conn:
            destinataire = destinataire_du_programme(conn, program_id)
            langue = langue_de(conn, destinataire) if destinataire else "fr"
        if not destinataire or destinataire == auteur_uid:
            return
        titre, corps = _NOUVELLE_SEMAINE[langue]
        envoyer(destinataire, titre=titre, corps=corps.format(n=numero), url="/training")
    except Exception:  # noqa: BLE001 — un effet, pas l'acte
        logger.exception("push : la notification de nouvelle semaine n'est pas partie")
