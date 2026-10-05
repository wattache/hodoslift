"""Le stockage des médias : Scaleway Object Storage, en S3 (FRE-99).

Scaleway Object Storage EST une API S3 : `boto3` suffit.

⚠️ BROKKR TÉLÉVERSE LUI-MÊME, il ne délivre pas d'URL d'upload signée : passer
par lui permet de VÉRIFIER le fichier (taille, format réel) avant qu'il n'existe.
⚠️ La LECTURE est signée et directe. Le seau est privé, chaque image se lit par
une URL à durée limitée ; la signature est un HMAC calculé LOCALEMENT, sans appel
réseau ni quota. Les vidéos d'athlète (FRE-58) passeront par la même signature.
"""

from __future__ import annotations

from functools import lru_cache

from app.socle.config import settings

# Assez pour composer un modèle sans que ses images meurent sous les yeux, assez
# peu pour qu'une URL récupérée dans un journal ne vaille plus rien le lendemain.
DUREE_URL_SECONDES = 6 * 3600


class MediathequeIndisponible(RuntimeError):
    """Aucune clé Scaleway configurée.

    ⚠️ Sans clé, `boto3` construit quand même un client et n'échoue qu'à l'appel,
    par une erreur d'authentification illisible. Lever tout de suite dit ce qui
    manque.
    """


@lru_cache(maxsize=1)
def _client():
    """Le client S3, construit une fois.

    ⚠️ Import PARESSEUX de `boto3` : ni l'application ni les tests ne paient son
    chargement au démarrage. Les tests remplacent les fonctions de ce module
    plutôt que de parler au réseau.

    Raises:
        MediathequeIndisponible: aucune clé Scaleway configurée.
    """
    if not (settings.scaleway_access_key and settings.scaleway_secret_key):
        raise MediathequeIndisponible(
            "SCALEWAY_ACCESS_KEY / SCALEWAY_SECRET_KEY absents — "
            "le stockage des médias n'est pas configuré"
        )
    import boto3  # import paresseux — cf. docstring

    return boto3.client(
        "s3",
        endpoint_url=settings.scaleway_endpoint,
        region_name=settings.scaleway_region,
        aws_access_key_id=settings.scaleway_access_key,
        aws_secret_access_key=settings.scaleway_secret_key,
    )


def televerser(chemin: str, data: bytes, content_type: str) -> None:
    """Écrit `data` dans le seau PRIVÉ, au chemin donné."""
    _client().put_object(
        Bucket=settings.scaleway_bucket_prive,
        Key=chemin,
        Body=data,
        ContentType=content_type,
    )


def url_signee(chemin: str, duree: int = DUREE_URL_SECONDES) -> str:
    """L'URL de lecture temporaire d'un objet du seau privé.

    ⚠️ Calcul LOCAL : `generate_presigned_url` signe avec la clé en mémoire et ne
    vérifie PAS que l'objet existe. Une URL vers un chemin absent est valide et
    rend un 404 au navigateur — elle ne sert donc pas à tester une présence.
    """
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.scaleway_bucket_prive, "Key": chemin},
        ExpiresIn=duree,
    )


def sql_medias(liaison: str, cle: str, ref: str) -> str:
    """Le fragment SQL qui rapporte les IMAGES d'une ligne, dans leur ordre.

    ⚠️ Une sous-requête AGRÉGÉE, pas une jointure : joindre multiplierait les
    lignes du test par ses images, à recoller en Python — et le moindre oubli
    dupliquerait un test à l'écran.

    ⚠️ Écrite UNE fois pour les deux tables de liaison — celle du modèle, vivante,
    et celle du bilan, figée avec son résultat : deux copies, c'est deux
    occasions d'oublier l'ordre d'un côté.
    """
    return (
        f"COALESCE((SELECT json_agg(json_build_object("
        f"'id', mm.id, 'chemin', mm.chemin, 'legende', mm.legende) ORDER BY l.ordre) "
        f"FROM {liaison} l JOIN bilan_medias_demo mm ON mm.id = l.media_id "
        f"WHERE l.{cle} = {ref}), '[]')"
    )


def liste_lue(medias) -> list[dict]:
    """`[{id, chemin, legende}]` → `[{id, url, legende}]`, par des URL signées.

    Le seau est privé : le chemin ne servirait à rien au front, et figerait
    l'hébergeur dans le contrat.
    """
    return [
        {"id": str(m["id"]), "url": url_ou_none(m["chemin"]), "legende": m["legende"]}
        for m in (medias or [])
    ]


def url_ou_none(chemin: str | None) -> str | None:
    """La signature TENTÉE : la forme sous laquelle les lectures s'en servent.

    ⚠️ Une image manquante est un désagrément, une lecture qui tombe est une
    PANNE. Sans clé configurée (local, tests, clé expirée — FRE-104), on rend
    `None` plutôt que de faire échouer la lecture ENTIÈRE pour une vignette.

    ⚠️ Les trois lectures qui affichent des images (catalogue, modèle, bilan)
    passent par ICI : une copie qui oublierait d'attraper ferait tomber un écran.
    """
    if not chemin:
        return None
    try:
        return url_signee(chemin)
    except MediathequeIndisponible:
        return None
