"""Profil public d'un coach (FRE-30) — édité depuis l'app, lu par le site vitrine.

⚠️ `GET /{slug}` sert de la DONNÉE MÉTIER sans authentification. Elle est sûre
pour UNE raison : elle lit la seule table `coach_profiles`, qui ne contient QUE du
public, et ne joint JAMAIS `athletes`. Ne pas « simplifier » en une jointure : la
redondance des 1RM (`one_rm`, projection de la fiche athlète) EST la sécurité.

`GET /me` sert le MÊME profil au coach qui l'édite, et rien de plus. `PATCH` et
upload passent par `require_coach` et n'agissent QUE sur le profil dont
`coach_uid` est l'uid appelant : on vérifie l'IDENTITÉ, pas le rôle.
"""

from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from sqlalchemy import text

from app.personnes import storage
from app.socle.erreurs import erreurs
from app.socle.audit import log_write
from app.socle.authz import require_coach
from app.socle.config import settings
from app.socle.db import get_session
from app.personnes.schemas_coach_profile import CoachProfilePatch, ProfilCoachLu
from app.socle.schemas_ecriture import PhotoCoachEcrite, ProfilCoachEcrit
from app.socle.erreurs import ErreurMetier

router = APIRouter(prefix="/coach-profiles", tags=["coach-profiles"])

# PNG uniquement (l'objet stocké est `profil.png`). Le Content-Type déclaré ne
# prouve rien : c'est la signature du fichier qui est vérifiée.
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 Mo : une photo de profil pèse quelques centaines de ko

# La SEULE table `coach_profiles`, aucune jointure. Une liste de colonnes UNIQUE
# pour les deux lectures : `coach_uid` (identifiant interne) n'y est pas, et la
# lecture authentifiée ne rend RIEN de plus que la publique.
_PUBLIC_COLUMNS = "slug, accroche, bio, instagram, photo_url, one_rm, langues"

_PUBLIC_SELECT = text(f"SELECT {_PUBLIC_COLUMNS} FROM coach_profiles WHERE slug = :slug")
_MINE_SELECT = text(f"SELECT {_PUBLIC_COLUMNS} FROM coach_profiles WHERE coach_uid = :u")


def _payload(row) -> dict:
    """La forme de réponse COMMUNE aux deux GET.

    Le front les type avec une seule interface : une divergence de nom ou de casse
    s'y paierait en `undefined` silencieux. Une seule fonction, jamais deux dicts.
    """
    return {
        "slug": row["slug"],
        "accroche": row["accroche"],
        "bio": row["bio"],
        "instagram": row["instagram"],
        "photoUrl": row["photo_url"],
        "oneRm": row["one_rm"],
        # text[] → liste JSON telle quelle. ⚠️ NULL reste `null` : le front
        # distingue « non renseigné » d'une liste vide, et n'affiche alors aucune
        # section « Langues ».
        "langues": row["langues"],
    }


# ⚠️ DÉCLARÉE AVANT `/{slug}` : FastAPI résout les routes dans l'ordre de
# déclaration, et `/{slug}` capturerait « me » — un coach lirait le profil public
# du slug littéral « me » (404, ou celui d'un AUTRE coach si ce slug est pris).
# L'ordre de ces deux routes EST le contrat ; ne pas les réordonner.
@router.get("/me", response_model=ProfilCoachLu, responses=erreurs(401, 403, 404))
def get_my_profile(claims: dict = Depends(require_coach)) -> dict:
    """Le profil du coach APPELANT (identité = son uid), pour l'écran d'édition.

    404 quand il n'a pas encore de profil : c'est un ÉTAT NORMAL côté front
    (afficher le formulaire de création, pas une erreur). Un coach ne connaît pas
    son slug tant qu'il n'a pas de page : il ne peut pas passer par la route publique.

    Raises:
        ErreurMetier: `profil_introuvable` (404).
    """
    with get_session() as session:
        row = session.execute(_MINE_SELECT, {"u": claims["uid"]}).mappings().first()
    if row is None:
        raise ErreurMetier("profil_introuvable", status.HTTP_404_NOT_FOUND, "aucun profil pour ce coach")
    return _payload(row)


# Cache COURT, mais cache : une page coach circule en bio Instagram, et chaque
# visite taperait sinon le service. À 60 s, un coach qui publie voit son changement
# dans la minute. `stale-while-revalidate` sert la version tiède pendant le
# rafraîchissement plutôt que de faire attendre le visiteur.
#
# ⚠️ `public` ne vaut QUE pour cette route. Le poser sur `/me` (authentifiée)
# autoriserait un cache partagé à resservir le profil d'un coach à un autre.
_CACHE_PUBLIC = "public, max-age=60, stale-while-revalidate=300"


@router.get("/{slug}", response_model=ProfilCoachLu, responses=erreurs(404))
def get_public_profile(slug: str, response: Response) -> dict:
    """Le profil public d'un coach, par son slug. PUBLIC : aucune dépendance d'auth.

    Raises:
        ErreurMetier: `profil_introuvable` (404).
    """
    with get_session() as session:
        row = session.execute(_PUBLIC_SELECT, {"slug": slug}).mappings().first()
    if row is None:
        # Pas de cache sur le 404 : un profil qui vient d'être créé serait sinon
        # annoncé introuvable pendant une minute.
        raise ErreurMetier("profil_introuvable", status.HTTP_404_NOT_FOUND, "profil introuvable")
    response.headers["Cache-Control"] = _CACHE_PUBLIC
    return _payload(row)


@router.patch("/me", response_model=ProfilCoachEcrit, responses=erreurs(401, 403, 409))
def upsert_my_profile(
    payload: CoachProfilePatch,
    claims: dict = Depends(require_coach),
) -> dict:
    """Crée ou met à jour le profil du coach APPELANT (identité = son uid).

    Upsert de clé `coach_uid` : le slug est REQUIS à la création et IMMUABLE ensuite
    (le changer casserait les liens du site). `one_rm` et `photo_url` ne s'écrivent
    pas ici : l'un est une projection de la fiche athlète, l'autre vient de l'upload.

    Raises:
        ErreurMetier: `slug_requis` (422), `slug_deja_pris` (409),
            `slug_immuable` (409).
    """
    coach_uid = claims["uid"]
    fields = payload.model_dump(exclude_unset=True)

    with get_session() as session:
        existing = session.execute(
            text("SELECT slug FROM coach_profiles WHERE coach_uid = :u"), {"u": coach_uid}
        ).first()

        if existing is None:
            slug = fields.get("slug")
            if not slug:
                raise ErreurMetier("slug_requis", 
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "slug requis à la création du profil",
                )
            if session.execute(
                text("SELECT 1 FROM coach_profiles WHERE slug = :s"), {"s": slug}
            ).first():
                raise ErreurMetier("slug_deja_pris", status.HTTP_409_CONFLICT, "slug déjà pris")
            session.execute(
                text(
                    "INSERT INTO coach_profiles "
                    "(coach_uid, slug, accroche, bio, instagram, langues) "
                    "VALUES (:coach_uid, :slug, :accroche, :bio, :instagram, :langues)"
                ),
                {
                    "coach_uid": coach_uid, "slug": slug,
                    "accroche": fields.get("accroche"), "bio": fields.get("bio"),
                    "instagram": fields.get("instagram"),
                    # list[str] | None → text[] : psycopg3 adapte nativement. Pas de
                    # littéral '{fr,en}' recomposé à la main (échappement à refaire).
                    "langues": fields.get("langues"),
                },
            )
            result_slug = slug
        else:
            if "slug" in fields and fields["slug"] != existing[0]:
                raise ErreurMetier("slug_immuable", 
                    status.HTTP_409_CONFLICT, "le slug d'un profil ne peut pas changer"
                )
            updatable = {
                k: fields[k]
                for k in ("accroche", "bio", "instagram", "langues")
                if k in fields
            }
            if updatable:
                set_clause = ", ".join(f"{k} = :{k}" for k in updatable)
                session.execute(
                    text(f"UPDATE coach_profiles SET {set_clause} WHERE coach_uid = :u"),
                    {**updatable, "u": coach_uid},
                )
            result_slug = existing[0]

    log_write(
        uid=coach_uid, resource="coach_profile",
        doc_path=f"coach_profiles/{result_slug}", fields=sorted(fields.keys()),
    )
    return {"ok": True, "slug": result_slug}


@router.post("/me/photo", response_model=PhotoCoachEcrite, responses=erreurs(401, 403, 404, 413, 415))
def upload_my_photo(
    file: UploadFile = File(...),
    claims: dict = Depends(require_coach),
) -> dict:
    """Téléverse la photo de profil du coach appelant vers le bucket PUBLIC.

    L'objet est `<slug>/profil.png` : le slug est celui du profil appelant, jamais
    fourni par le client — un coach ne peut pas écraser la photo d'un autre. Le
    profil doit exister (PATCH d'abord). brokkr téléverse lui-même, sans URL signée.

    Raises:
        ErreurMetier: `profil_requis_avant_photo` (404), `photo_trop_lourde` (413),
            `photo_pas_png` (415).
    """
    coach_uid = claims["uid"]
    with get_session() as session:
        row = session.execute(
            text("SELECT slug FROM coach_profiles WHERE coach_uid = :u"), {"u": coach_uid}
        ).first()
    if row is None:
        raise ErreurMetier("profil_requis_avant_photo", 
            status.HTTP_404_NOT_FOUND, "crée d'abord ton profil (PATCH) avant d'uploader une photo"
        )
    slug = row[0]

    # ⚠️ La TAILLE avant le contenu : `UploadFile.size` est connue dès le parsing
    # multipart, donc un envoi énorme est refusé sans être chargé en mémoire.
    if file.size is not None and file.size > _MAX_PHOTO_BYTES:
        raise ErreurMetier("photo_trop_lourde", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "photo trop lourde (max 5 Mo)")

    data = file.file.read()
    # Second filet : `size` est optionnelle dans le contrat Starlette.
    if len(data) > _MAX_PHOTO_BYTES:
        raise ErreurMetier("photo_trop_lourde", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "photo trop lourde (max 5 Mo)")
    if not data.startswith(_PNG_MAGIC):
        raise ErreurMetier("photo_pas_png", 
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "un fichier PNG est attendu"
        )

    object_path = f"{slug}/profil.png"  # PAS de préfixe 'coachs/' : vérifié contre le bucket
    storage.upload_public_media(object_path, data, "image/png")
    photo_url = f"https://storage.googleapis.com/{settings.public_media_bucket}/{object_path}"

    with get_session() as session:
        session.execute(
            text("UPDATE coach_profiles SET photo_url = :url WHERE coach_uid = :u"),
            {"url": photo_url, "u": coach_uid},
        )

    log_write(
        uid=coach_uid, resource="coach_profile_photo",
        doc_path=f"coach_profiles/{slug}/profil.png", fields=["photo_url"],
    )
    return {"ok": True, "photoUrl": photo_url}
