"""Les records manuels d'un athlète (`athlete_prs`), saisis par le staff.

À ne pas confondre avec le 1RM de PROGRAMMATION (`athletes.current_one_rm`).
L'identité d'un PR est le tuple COMPLET (athlete_id, movement, sets, reps,
variant, format) — « 4 reps à 60 » ≠ « 4×4 à 60 ».
AUTZ — GET `owner_or_staff` ; POST/DELETE `staff` : l'athlète lit ses records, il
ne les saisit pas. `athlete_id` du chemin est `athletes.legacy_id`.

⚠️ Dédup PORTABLE : SELECT null-safe (`IS NOT DISTINCT FROM`) puis UPDATE/INSERT,
pas d'`ON CONFLICT` — les tests SQLite ignorent `UNIQUE NULLS NOT DISTINCT`.
L'UNIQUE en base reste le garde-fou anti-course.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy import text

from app.socle.erreurs import erreurs
from app.socle.audit import log_write
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.suivi.schemas_prs import PrCreate, PrLu
from app.socle.schemas_ecriture import ObjetSupprime
from app.socle.erreurs import ErreurMetier

router = APIRouter(prefix="/athletes/{athlete_id}/prs", tags=["prs"])

_ATHLETE_SQL = text("SELECT id FROM athletes WHERE legacy_id = :legacy")

# Un record se tient sur un LIFT DE COMPÉTITION (category='exercices' ET
# competition=true) — pas sur du renforcement. Insensible à la casse.
_COMP_LIFTS_SQL = text(
    # ⚠️ `ORDER BY name` : deux entrées qui ne diffèrent que par la CASSE donnent
    # la même clé, et le dernier rang gagne — sans tri, au hasard du plan
    # d'exécution.
    # ⚠️ La bibliothèque de la STRUCTURE de l'athlète : c'est elle que vise la clé
    # étrangère du record (`athlete_prs.structure`, posée par la base).
    "SELECT upper(name), name FROM library_entries "
    "WHERE category = 'exercices' AND competition = true "
    "  AND structure = (SELECT structure FROM athletes WHERE id = :aid) "
    "ORDER BY name"
)

_READ_SQL = text(
    "SELECT p.id, p.movement, p.reps, p.weight_kg, p.sets, p.format, p.variant, p.performed_on "
    "FROM athlete_prs p JOIN athletes a ON a.id = p.athlete_id "
    "WHERE a.legacy_id = :legacy ORDER BY p.movement, p.reps"
)

# La ligne d'identité, en null-safe : `sets`, `variant` et `format` sont
# nullables, d'où `IS NOT DISTINCT FROM`.
_FIND_SQL = text(
    "SELECT id FROM athlete_prs WHERE athlete_id = :aid AND movement = :movement AND reps = :reps "
    "AND sets IS NOT DISTINCT FROM :sets AND variant IS NOT DISTINCT FROM :variant "
    "AND format IS NOT DISTINCT FROM :format"
)
_UPDATE_SQL = text(
    "UPDATE athlete_prs SET weight_kg = :weight_kg, performed_on = :performed_on WHERE id = :id"
)
_INSERT_SQL = text(
    "INSERT INTO athlete_prs (athlete_id, movement, reps, weight_kg, sets, format, variant, performed_on) "
    "VALUES (:aid, :movement, :reps, :weight_kg, :sets, :format, :variant, :performed_on) RETURNING id"
)
_DELETE_SQL = text(
    "DELETE FROM athlete_prs WHERE CAST(id AS text) = :pr_id AND athlete_id = :aid"
)


def _resolve_athlete(session, legacy_id: str) -> str:
    row = session.execute(_ATHLETE_SQL, {"legacy": legacy_id}).first()
    if row is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND, "athlète inconnu en base SQL")
    return row[0]


def _iso(value) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


@router.get("", response_model=list[PrLu], responses=erreurs(401, 403, 404))
def list_prs(
    access: AthleteAccess = Depends(require_athlete_access("owner_or_staff")),
) -> list:
    """Rend les records de l'athlète, triés par mouvement puis répétitions."""
    with get_session() as session:
        _resolve_athlete(session, access.athlete_id)  # 404 si absent
        rows = session.execute(_READ_SQL, {"legacy": access.athlete_id}).all()

    return [
        {
            "id": str(pr_id),
            "movement": movement,
            "reps": reps,
            "weight": float(weight_kg),
            "sets": sets,
            "format": fmt,
            "variant": variant,
            "performedOn": _iso(performed_on) if performed_on is not None else None,
        }
        for pr_id, movement, reps, weight_kg, sets, fmt, variant, performed_on in rows
    ]


@router.post("", response_model=PrLu, responses=erreurs(401, 403, 404))
def upsert_pr(
    payload: PrCreate,
    access: AthleteAccess = Depends(require_athlete_access("staff")),
) -> dict:
    """Ajoute ou met à jour un PR, par son tuple d'identité.

    Raises:
        ErreurMetier: `pas_un_lift_de_competition` (422), avant toute écriture, si
            le mouvement n'est pas un lift de compétition de la bibliothèque.
    """
    with get_session() as session:
        aid = _resolve_athlete(session, access.athlete_id)

        # ⚠️ On écrit le nom CANONIQUE, pas celui qui a été tapé (FRE-123) : la
        # validation est insensible à la casse, et « squat » à côté de « SQUAT »
        # ferait DEUX lifts dans le tableau des records. La clé étrangère vers la
        # bibliothèque le refuserait de toute façon.
        canonique = {r[0]: r[1] for r in session.execute(_COMP_LIFTS_SQL, {"aid": aid}).all()}
        if payload.movement.upper() not in canonique:
            raise ErreurMetier("pas_un_lift_de_competition", 
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"mouvement « {payload.movement} » : doit être un lift de compétition "
                "(library_entries category='exercices' et competition=true)",
            )

        params = {
            "aid": aid, "movement": canonique[payload.movement.upper()], "reps": payload.reps,
            "weight_kg": payload.weight, "sets": payload.sets, "format": payload.format,
            "variant": payload.variant, "performed_on": payload.performedOn,
        }
        existing = session.execute(_FIND_SQL, params).first()
        if existing is not None:
            pr_id = existing[0]
            session.execute(
                _UPDATE_SQL,
                {"id": pr_id, "weight_kg": payload.weight, "performed_on": payload.performedOn},
            )
        else:
            pr_id = session.execute(_INSERT_SQL, params).scalar()

    log_write(
        uid=access.claims["uid"], resource="athlete_prs",
        doc_path=f"athletes/{access.athlete_id}/prs", fields=["movement", "reps", "weight_kg"],
    )
    return {
        "id": str(pr_id),
        "movement": payload.movement,
        "reps": payload.reps,
        "weight": payload.weight,
        "sets": payload.sets,
        "format": payload.format,
        "variant": payload.variant,
        "performedOn": payload.performedOn,
    }


@router.delete("/{pr_id}", response_model=ObjetSupprime, responses=erreurs(401, 403, 404))
def delete_pr(
    pr_id: str,
    access: AthleteAccess = Depends(require_athlete_access("staff")),
) -> dict:
    """Supprime un PR par son id.

    Raises:
        ErreurMetier: `record_introuvable` (404) s'il n'existe pas OU n'est pas à
            cet athlète — on ne supprime jamais le PR d'un autre.
    """
    with get_session() as session:
        aid = _resolve_athlete(session, access.athlete_id)
        result = session.execute(_DELETE_SQL, {"pr_id": pr_id, "aid": aid})
        if result.rowcount == 0:
            raise ErreurMetier("record_introuvable", status.HTTP_404_NOT_FOUND, "record introuvable pour cet athlète")

    log_write(
        uid=access.claims["uid"], resource="athlete_prs",
        doc_path=f"athletes/{access.athlete_id}/prs/{pr_id}", fields=[], status="deleted",
    )
    return {"ok": True, "deleted": pr_id}
