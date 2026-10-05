"""Les médias de démonstration : téléversement et catalogue (FRE-99).

Ce que la kiné dépose pour montrer un mouvement. Non sensibles
(`docs/bilan-kine.md` §3.6) : le mouvement, identique pour tous, sans personne
d'identifiable.

⚠️ `require_kine` PARTOUT, lecture comprise : composer un bilan est un acte de
praticien. L'athlète voit l'image par son TEST, jamais par ce catalogue.
⚠️ AUCUNE route de suppression : la clé Scaleway de brokkr ne porte pas
`ObjectStorageObjectsDelete` (nidavellir/variables.tf). Retirer une photo
demande d'élargir la permission ET d'écrire la route.
"""

import uuid

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy import text

from app.kine import mediatheque
from app.socle.audit import log_write
from app.socle.authz import require_kine
from app.socle.db import get_session
from app.socle.erreurs import ErreurMetier, erreurs
from app.kine.schemas_bilan_media import MediaDemoLu

router = APIRouter(prefix="/bilan-medias-demo", tags=["bilans"])

# La borne ne serre pas l'usage : elle refuse un envoi accidentel énorme avant
# qu'il soit chargé en mémoire.
_MAX_OCTETS = 5 * 1024 * 1024

# ⚠️ Le format se reconnaît aux OCTETS, pas à l'extension ni au `Content-Type` :
# les deux viennent du client et ne prouvent rien. Un exécutable renommé `.png`
# passerait l'un et l'autre.
_SIGNATURES = {
    b"\x89PNG\r\n\x1a\n": ("png", "image/png"),
    b"\xff\xd8\xff": ("jpg", "image/jpeg"),
}


def _format_ou_415(data: bytes) -> tuple[str, str]:
    for magie, (extension, mime) in _SIGNATURES.items():
        if data.startswith(magie):
            return extension, mime
    raise ErreurMetier(
        "media_format_refuse", status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        "seules les images PNG et JPEG sont acceptées",
    )


# ⚠️ Nom UNIQUE dans tout le projet. Le relevé des codes atteignables
# (`app/socle/erreurs.py`) construit son graphe d'appels par NOM de fonction, sans
# qualifier le module : un `lister` ici hériterait des codes du `lister` de
# `kine_notes`, et le test du contrat d'erreurs réclamerait un 404 que cette
# route ne lève jamais.
@router.get("", response_model=list[MediaDemoLu], responses=erreurs(401, 403))
def lister_medias(claims: dict = Depends(require_kine)) -> list:
    """Le catalogue, du plus récent au plus ancien.

    C'est l'ordre dans lequel on retrouve ce qu'on vient de déposer.
    """
    with get_session() as session:
        lignes = session.execute(text(
            "SELECT id, chemin, type, legende, cree_par, cree_le "
            "FROM bilan_medias_demo ORDER BY cree_le DESC")).mappings().all()
    return [_media_lu(r) for r in lignes]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=MediaDemoLu,
             responses=erreurs(401, 403, 413, 415))
def televerser_media(
    file: UploadFile = File(...),
    legende: str | None = None,
    claims: dict = Depends(require_kine),
) -> dict:
    """Dépose une image de démonstration dans le seau PRIVÉ.

    ⚠️ Brokkr écrit LUI-MÊME plutôt que de délivrer une URL d'upload signée :
    c'est ce qui permet de VÉRIFIER (taille, format réel) avant que le fichier
    n'existe. Une URL signée laisserait le client déposer ce qu'il veut.

    ⚠️ Le chemin est FABRIQUÉ ici, jamais reçu : laisser le client nommer l'objet
    le laisserait écraser celui d'un autre test.

    Raises:
        ErreurMetier: `media_trop_lourd` (413).
    """
    uid = claims["uid"]

    # Taille contrôlée AVANT `read()` : `size` est connue dès le parsing
    # multipart, donc un envoi énorme est refusé sans être chargé en mémoire.
    if file.size is not None and file.size > _MAX_OCTETS:
        raise ErreurMetier("media_trop_lourd", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                           "image trop lourde (max 5 Mo)")
    data = file.file.read()
    # Second filet : `size` est optionnelle dans le contrat Starlette.
    if len(data) > _MAX_OCTETS:
        raise ErreurMetier("media_trop_lourd", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                           "image trop lourde (max 5 Mo)")

    extension, mime = _format_ou_415(data)
    chemin = f"demo/{uuid.uuid4()}.{extension}"
    mediatheque.televerser(chemin, data, mime)

    with get_session() as session:
        ligne = session.execute(text(
            "INSERT INTO bilan_medias_demo (chemin, type, legende, cree_par) "
            "VALUES (:chemin, 'image', :legende, :uid) "
            "RETURNING id, chemin, type, legende, cree_par, cree_le"),
            {"chemin": chemin, "legende": legende, "uid": uid}).mappings().first()

    log_write(uid=uid, resource="bilan_media_demo",
              doc_path=f"bilan-medias-demo/{ligne['id']}", fields=["chemin"])
    return _media_lu(ligne)


def _media_lu(r) -> dict:
    """La ligne du catalogue, avec son URL SIGNÉE — jamais le chemin.

    Le seau est privé : le chemin n'apprendrait rien au front, et figerait
    l'hébergeur dans le contrat. La signature est TENTÉE, pas exigée
    (`mediatheque.url_ou_none`) : sans clé, `url: null` plutôt qu'un catalogue
    qui tombe.
    """
    return {
        "id": str(r["id"]),
        "url": mediatheque.url_ou_none(r["chemin"]),
        "type": r["type"],
        "legende": r["legende"],
        "creePar": r["cree_par"],
        "creeLe": r["cree_le"].isoformat(),
    }
