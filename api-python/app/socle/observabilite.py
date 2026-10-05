"""Envoi des incidents à Sentry — et surtout, de ce qui n'y part PAS.

Ce module existe pour ses deux garde-fous : ce qui n'est pas un incident (4xx),
et ce qui doit être masqué avant de partir chez un tiers.

⚠️ `send_default_pii` reste à `False`, ÉCRIT plutôt qu'omis — l'extrait
d'onboarding de Sentry propose `True`, qui ferait partir en-têtes, adresse IP et
identité. L'application porte des données d'athlètes réels : poids, blessures,
suivi kiné.

⚠️ Sentry est hébergé dans l'UE (`ingest.de.sentry.io`) mais n'est pas certifié
HDS : la règle n'est pas « c'est en Europe », c'est « rien de sensible n'y arrive ».
"""

import logging
import re

from fastapi import HTTPException

from app.socle.config import settings
from app.socle.logging_config import request_id_var

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# GARDE-FOU 1 — ce qui n'est PAS un incident
# --------------------------------------------------------------------------- #

# ⚠️ Un 4xx est un fonctionnement NORMAL, pas une panne : un 403 est
# l'autorisation qui fait son travail. Les envoyer noierait le signal et
# brûlerait le quota. Seuls les 5xx sont des incidents : là, brokkr a échoué.
#
# Le 409 aussi reste ici : sa fréquence dit quelque chose, mais elle appelle une
# métrique, pas une alerte.
_STATUTS_ATTENDUS = range(400, 500)


def _est_un_incident(exc: BaseException | None) -> bool:
    if isinstance(exc, HTTPException):
        return exc.status_code not in _STATUTS_ATTENDUS
    return True


# --------------------------------------------------------------------------- #
# GARDE-FOU 2 — ce qui doit être masqué
# --------------------------------------------------------------------------- #

# ⚠️ Les `detail` de brokkr sont écrits pour un humain qui débogue (FRE-40), et
# certains interpolent de vraies valeurs :
#
#   f"{p['name']} : la catégorie de poids exige le genre du participant"
#   f"{wc} : catégorie « {wc} » invalide pour le genre {gender}"
#   f"{payload.day} n'est pas un jour de cette compétition"
#   f"mouvement « {mv} » : doit être un lift de compétition"
#
# Un nom, un genre, une catégorie de poids — qui corrèle avec le poids corporel.
# Rien de cela n'a à arriver chez un tiers.
#
# ⚠️ Le motif du masquage est la CONFIDENTIALITÉ, pas l'inutilité : la valeur
# masquée peut être exactement ce qu'il faut (une ligne manquante du
# référentiel). Elle reste dans Cloud Logging ; le `requestId` posé plus bas est
# ce qui permet d'y revenir. Le `code` d'erreur, lui, part : il dit quelle règle
# a cédé, et permet de regrouper.
_A_MASQUER = re.compile(
    r"""
      «\s*[^»]*\s*»          # tout ce qui est mis en avant par des guillemets
    | \bgenre\s+[MF]\b       # le genre d'un participant
    | \b\d{4}-\d{2}-\d{2}\b  # une date de passage
    """,
    re.VERBOSE,
)

# Les segments de chemin qui sont des identifiants. Pseudonymes, mais ils
# désignent une personne, et une URL suffit à recouper. Remplacés par un jeton
# STABLE pour que le regroupement de Sentry tienne : sinon chaque athlète produit
# sa propre « erreur », et une panne unique en paraît autant qu'il y a d'athlètes.
_SEGMENT_IDENTIFIANT = re.compile(r"/(athletes|programs|competitions|events)/[A-Za-z0-9_-]{6,}")


def _masquer(texte: str) -> str:
    texte = _A_MASQUER.sub("«…»", texte)
    return _SEGMENT_IDENTIFIANT.sub(r"/\1/{id}", texte)


def _nettoyer(evenement: dict, indice: dict) -> dict | None:
    """`before_send` — le dernier point de passage avant l'envoi.

    Rend `None` pour jeter l'événement. Tout ce qui sort d'ici part chez un
    tiers : dans le doute, on jette."""
    exc = (indice or {}).get("exc_info", (None, None, None))[1]
    if not _est_un_incident(exc):
        return None

    # ⚠️ Le fil entre Sentry et Cloud Logging : sans lui, le masquage est une
    # PERTE au lieu d'un déplacement. Ce jeton est celui que `logging_config` pose
    # sur CHAQUE ligne : une alerte Sentry devient une requête
    # `jsonPayload.requestId="…"` dans Cloud Logging, qui rend le détail complet.
    identifiant = request_id_var.get()
    if identifiant:
        evenement.setdefault("tags", {})["requestId"] = identifiant

    for cle in ("message",):
        if isinstance(evenement.get(cle), str):
            evenement[cle] = _masquer(evenement[cle])

    for valeur in evenement.get("exception", {}).get("values", []):
        if isinstance(valeur.get("value"), str):
            valeur["value"] = _masquer(valeur["value"])

    if isinstance(evenement.get("request", {}).get("url"), str):
        evenement["request"]["url"] = _masquer(evenement["request"]["url"])

    # ⚠️ Les fils d'Ariane aussi : ils rejouent les logs et les requêtes qui ont
    # précédé l'erreur, donc les chemins et leurs identifiants.
    for miette in evenement.get("breadcrumbs", {}).get("values", []):
        if isinstance(miette.get("message"), str):
            miette["message"] = _masquer(miette["message"])

    return evenement


def installer() -> None:
    """Branche Sentry, si un DSN est fourni.

    Sans DSN, ne fait rien — c'est ce qui garde les tests, `make dev` et le
    harnais e2e silencieux."""
    if not settings.sentry_dsn:
        logger.info("Sentry non configuré (SENTRY_DSN vide) — aucun envoi")
        return

    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        # ⚠️ Sans `release`, Sentry ne situe pas une erreur dans le temps : ni
        # « depuis quel déploiement », ni détection de régression. Aucun jeton
        # requis côté Python — il ne sert qu'aux source maps du front.
        release=settings.version_deployee,
        # ⚠️ EXPLICITEMENT FAUX — voir l'en-tête du module.
        send_default_pii=False,
        # Les corps de requête ne partent jamais : ils portent le poids, les
        # blessures, les notes du kiné.
        max_request_body_size="never",
        # Échantillonné : c'est le tracing qui consomme le quota, pas les
        # incidents, et une fraction suffit à voir une route se dégrader.
        traces_sample_rate=0.1,
        before_send=_nettoyer,
    )
    logger.info("Sentry actif (environnement %s)", settings.sentry_environment)
