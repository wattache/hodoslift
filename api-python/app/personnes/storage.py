"""Téléversement vers le seau de médias PUBLICS — Scaleway Object Storage, en S3.

Le seau `scaleway_bucket_public` porte la photo détourée de chaque coach, lue par
des visiteurs NON authentifiés du site vitrine : lisible par n'importe qui, par
construction. brokkr téléverse lui-même, avec le client S3 de la médiathèque.

⚠️ L'OBJET EST POSÉ `public-read`. L'ACL publique du SEAU ne rend pas ses objets
lisibles en S3 : sans l'ACL de l'objet, la photo existe et rend 403 au site.

⚠️ L'URL se construit ICI, une fois : la route l'enregistre en base, le site
vitrine la recompose depuis le même schéma (`web/landing/build-coachs.mjs`).
"""

from app.socle.config import settings
from app.kine import mediatheque


def url_publique(object_path: str) -> str:
    """L'URL publique d'un objet du seau public (style « hôte virtuel » de Scaleway)."""
    return (f"https://{settings.scaleway_bucket_public}.s3.{settings.scaleway_region}.scw.cloud/"
            f"{object_path}")


def upload_public_media(object_path: str, data: bytes, content_type: str) -> None:
    """Écrit `data` dans le seau public, lisible par tous, en cache un jour.

    Raises:
        MediathequeIndisponible: aucune clé Scaleway configurée.
    """
    mediatheque._client().put_object(
        Bucket=settings.scaleway_bucket_public,
        Key=object_path,
        Body=data,
        ContentType=content_type,
        ACL="public-read",
        CacheControl="public, max-age=86400",
    )
