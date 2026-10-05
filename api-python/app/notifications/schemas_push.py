"""Le contrat des notifications push : ce que le navigateur donne, ce qu'on lui rend."""
from pydantic import BaseModel, ConfigDict, Field


class ClesPush(BaseModel):
    """Les clés de chiffrement du navigateur (RFC 8291) : sans elles, aucun
    envoi n'est possible."""

    model_config = ConfigDict(extra="forbid")

    p256dh: str = Field(min_length=1)
    auth: str = Field(min_length=1)


class AbonnementPush(BaseModel):
    """`PushSubscription.toJSON()` tel que le navigateur le produit — l'endpoint
    est la clé, et il est propre au navigateur qui l'a émis."""

    model_config = ConfigDict(extra="ignore")

    endpoint: str = Field(min_length=1, pattern=r"^https://")
    keys: ClesPush


class RetraitPush(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=1)


class ClePubliquePush(BaseModel):
    """La clé publique VAPID, que le navigateur exige pour s'abonner. `None`
    tant que le serveur n'est pas configuré : le front n'offre alors rien."""

    model_config = ConfigDict(extra="forbid")

    clePublique: str | None
