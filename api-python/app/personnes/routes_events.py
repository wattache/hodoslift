"""Les événements du calendrier d'un athlète (compétitions, vacances, voyages, repos…).

Table `calendar_events`, UNIQUE (athlete_id, legacy_id). L'`athlete_id` du chemin
est `athletes.legacy_id` : l'uuid se résout avant toute opération (404 si absent,
jamais silencieux). Autorisation `owner_or_staff` partout, GET compris.

PUT réécrit TOUTE la ligne ; PATCH est un read-modify-write, parce que
`fin >= début` se juge sur la ligne FINALE. `emoji` et `can_train` sont gardés
quel que soit le type.

⚠️ PAS DE CYCLE ICI (FRE-173) : ni type `cycle`, ni colonne `phase`. Le cycle est
un fait du jour, déclaré par l'athlète seule (`app/suivi/routes_daily_logs.py`).
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy import text

from app.socle.audit import log_write
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.personnes.schemas_event import EventCreate, EventPatch, EvenementLu
from app.socle.schemas_ecriture import ChampsEcrits, ObjetCree, ObjetSupprime
from app.socle.erreurs import ErreurMetier, IdentifiantDeChemin, erreurs

router = APIRouter(prefix="/athletes/{athlete_id}/events", tags=["events"])


_ATHLETE_SQL = text("SELECT id FROM athletes WHERE legacy_id = :legacy")

_UPSERT_SQL = text(
    """
    INSERT INTO calendar_events
        (athlete_id, legacy_id, type, name, start_date, end_date, emoji, can_train)
    VALUES
        (:athlete_id, :legacy_id, :type, :name, :start_date, :end_date, :emoji, :can_train)
    ON CONFLICT (athlete_id, legacy_id) DO UPDATE SET
        type       = EXCLUDED.type,
        name       = EXCLUDED.name,
        start_date = EXCLUDED.start_date,
        end_date   = EXCLUDED.end_date,
        emoji      = EXCLUDED.emoji,
        can_train  = EXCLUDED.can_train
    """
)

_SELECT_ONE_SQL = text(
    """
    SELECT type, name, start_date, end_date, emoji, can_train
    FROM calendar_events
    WHERE athlete_id = :athlete_id AND legacy_id = :legacy
    """
)

_UPDATE_SQL = text(
    """
    UPDATE calendar_events SET
        type = :type, name = :name, start_date = :start_date, end_date = :end_date,
        emoji = :emoji, can_train = :can_train
    WHERE athlete_id = :athlete_id AND legacy_id = :legacy
    """
)

_DELETE_SQL = text(
    "DELETE FROM calendar_events WHERE athlete_id = :athlete_id AND legacy_id = :legacy"
)

_READ_ALL_SQL = text(
    """
    SELECT ce.legacy_id, ce.type, ce.name, ce.start_date, ce.end_date,
           ce.emoji, ce.can_train
    FROM calendar_events ce
    JOIN athletes a ON a.id = ce.athlete_id
    WHERE a.legacy_id = :legacy
    ORDER BY ce.start_date
    """
)


def _resolve_athlete(session, legacy_id: str) -> str:
    """Traduit le `legacy_id` (l'id que le front utilise) en uuid SQL.

    Raises:
        ErreurMetier: `athlete_introuvable` (404).
    """
    row = session.execute(_ATHLETE_SQL, {"legacy": legacy_id}).first()
    if row is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND, "athlète inconnu en base SQL")
    return row[0]


def _iso(value) -> str:
    """Date SQL → 'YYYY-MM-DD' (Postgres renvoie un date, SQLite une str)."""
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


@router.put("/{event_id}", response_model=ObjetCree, responses=erreurs(401, 403, 404))
def put_event(
    event_id: IdentifiantDeChemin,
    payload: EventCreate,
    access: AthleteAccess = Depends(require_athlete_access("owner_or_staff")),
) -> dict:
    """Crée ou remplace l'événement : réécrit TOUTE la ligne.

    `EventCreate` a déjà rejeté `end < start` (422) — et `cycle`, qui n'est pas un
    type d'événement (FRE-173).
    """

    params = {
        "legacy_id": event_id,
        "type": payload.type,
        "name": payload.name,
        "start_date": payload.startDate,
        "end_date": payload.endDate,
        "emoji": payload.emoji,
        "can_train": payload.canTrain,
    }
    with get_session() as session:
        params["athlete_id"] = _resolve_athlete(session, access.athlete_id)
        session.execute(_UPSERT_SQL, params)

    log_write(
        uid=access.claims["uid"],
        resource="event",
        doc_path=f"athletes/{access.athlete_id}/events/{event_id}",
        fields=["type", "name", "start_date", "end_date", "emoji", "can_train"],
    )
    return {"ok": True, "id": event_id}


@router.patch("/{event_id}", response_model=ChampsEcrits, responses=erreurs(401, 403, 404))
def patch_event(
    event_id: IdentifiantDeChemin,
    payload: EventPatch,
    access: AthleteAccess = Depends(require_athlete_access("owner_or_staff")),
) -> dict:
    """Patch partiel d'un événement, en read-modify-write.

    `fin >= début` se juge sur la ligne FINALE, une date fournie contre l'autre
    lue en base : un COALESCE colonne à colonne ne le saurait pas.

    Raises:
        ErreurMetier: `evenement_introuvable` (404), `fin_avant_debut` (422).
    """
    fields = payload.model_dump(exclude_none=True)

    with get_session() as session:
        athlete_uuid = _resolve_athlete(session, access.athlete_id)
        existing = session.execute(
            _SELECT_ONE_SQL, {"athlete_id": athlete_uuid, "legacy": event_id}
        ).mappings().first()
        if existing is None:
            raise ErreurMetier("evenement_introuvable", status.HTTP_404_NOT_FOUND, "event introuvable")

        start_final = fields.get("startDate", _iso(existing["start_date"]))
        end_final = fields.get("endDate", _iso(existing["end_date"]))
        # Comparaison lexicale d'ISO 'YYYY-MM-DD' = comparaison de dates.
        if end_final < start_final:
            raise ErreurMetier("fin_avant_debut", 
                status.HTTP_422_UNPROCESSABLE_CONTENT, "endDate ne peut pas précéder startDate"
            )

        session.execute(
            _UPDATE_SQL,
            {
                "athlete_id": athlete_uuid,
                "legacy": event_id,
                "type": fields.get("type", existing["type"]),
                "name": fields.get("name", existing["name"]),
                "start_date": start_final,
                "end_date": end_final,
                "emoji": fields.get("emoji", existing["emoji"]),
                "can_train": fields.get("canTrain", existing["can_train"]),
            },
        )

    log_write(
        uid=access.claims["uid"],
        resource="event",
        doc_path=f"athletes/{access.athlete_id}/events/{event_id}",
        fields=sorted(fields.keys()),
    )
    return {"ok": True, "written": sorted(fields.keys())}


@router.delete("/{event_id}", response_model=ObjetSupprime, responses=erreurs(401, 403, 404))
def delete_event(
    event_id: IdentifiantDeChemin,
    access: AthleteAccess = Depends(require_athlete_access("owner_or_staff")),
) -> dict:

    with get_session() as session:
        athlete_uuid = _resolve_athlete(session, access.athlete_id)
        result = session.execute(
            _DELETE_SQL, {"athlete_id": athlete_uuid, "legacy": event_id}
        )
        if result.rowcount == 0:
            raise ErreurMetier("evenement_introuvable", status.HTTP_404_NOT_FOUND, "event introuvable")

    log_write(
        uid=access.claims["uid"],
        resource="event",
        doc_path=f"athletes/{access.athlete_id}/events/{event_id}",
        fields=[],
        status="deleted",
    )
    return {"ok": True, "deleted": event_id}


@router.get("", response_model=list[EvenementLu], response_model_exclude_unset=True, responses=erreurs(401, 403, 404))
def list_events(
    access: AthleteAccess = Depends(require_athlete_access("owner_or_staff")),
) -> list:
    """Tous les événements de l'athlète, en camelCase ; un `NULL` est OMIS, pas rendu."""
    with get_session() as session:
        _resolve_athlete(session, access.athlete_id)  # 404 si absent
        rows = session.execute(_READ_ALL_SQL, {"legacy": access.athlete_id}).all()

    out: list[dict] = []
    for legacy_id, ev_type, name, start_date, end_date, emoji, can_train in rows:
        entry: dict = {
            "id": legacy_id,
            "type": ev_type,
            "name": name,
            "startDate": _iso(start_date),
            "endDate": _iso(end_date),
        }
        if emoji is not None:
            entry["emoji"] = emoji
        if can_train is not None:
            entry["canTrain"] = bool(can_train)
        out.append(entry)
    return out
