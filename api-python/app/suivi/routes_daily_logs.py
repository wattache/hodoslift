"""Le journal quotidien d'un athlète (`daily_logs`, une ligne par athlète et par jour).

- PATCH `/{date}` : upsert qui n'écrase que les champs FOURNIS. Mode `owner` :
  seul l'athlète écrit.
- GET : une plage de dates (défaut : les 30 derniers jours). Mode
  `owner_or_staff`.

`athlete_id` du chemin est `athletes.legacy_id` : l'uuid se résout avant toute
lecture ou écriture, 404 sinon — jamais d'opération silencieuse. Un champ que
`DailyLogPatch` ne déclare pas est refusé par `extra="forbid"`, pas ici.
"""

import re
from datetime import date as date_cls, timedelta

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import text

from app.socle.erreurs import erreurs
from app.socle.audit import log_write
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.suivi.schemas_daily_log import DailyLogPatch, JourneeLue
from app.socle.schemas_ecriture import ChampsEcrits
from app.socle.erreurs import ErreurMetier

router = APIRouter(prefix="/athletes/{athlete_id}/daily-logs", tags=["daily-logs"])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MIN_YEAR = 2015
_MAX_YEAR = 2100


def _validate_date(value: str) -> date_cls:
    if not _DATE_RE.match(value):
        raise ErreurMetier("date_invalide", status.HTTP_422_UNPROCESSABLE_CONTENT, "date attendue au format YYYY-MM-DD")
    try:
        parsed = date_cls.fromisoformat(value)
    except ValueError:
        raise ErreurMetier("date_invalide", status.HTTP_422_UNPROCESSABLE_CONTENT, "date invalide")
    if not (_MIN_YEAR <= parsed.year <= _MAX_YEAR):
        raise ErreurMetier("date_invalide", status.HTTP_422_UNPROCESSABLE_CONTENT, f"année hors bornes ({_MIN_YEAR}-{_MAX_YEAR})")
    return parsed


_ATHLETE_SQL = text("SELECT id FROM athletes WHERE legacy_id = :legacy")

_UPSERT_SQL = text(
    """
    INSERT INTO daily_logs (athlete_id, log_date, weight_kg, sleep_hours,
                            water_liters, calories, cycle_phase)
    VALUES (:athlete_id, :log_date, :weight_kg, :sleep_hours, :water_liters,
            :calories,
            -- Le CAST parce que la même valeur sert dans un CASE plus bas, où
            -- Postgres ne devine plus le type d'un paramètre texte.
            CAST(:cycle AS cycle_phase))
    ON CONFLICT (athlete_id, log_date) DO UPDATE SET
        weight_kg    = COALESCE(EXCLUDED.weight_kg, daily_logs.weight_kg),
        sleep_hours  = COALESCE(EXCLUDED.sleep_hours, daily_logs.sleep_hours),
        water_liters = COALESCE(EXCLUDED.water_liters, daily_logs.water_liters),
        calories     = COALESCE(EXCLUDED.calories, daily_logs.calories),
        -- ⚠️ PAS DE COALESCE SUR LA PHASE, et c'est toute la différence : elle se
        -- REMPLACE. `null` FOURNI efface, absent ne touche pas (FRE-173) — et
        -- « fourni » voyage à part de la valeur (`:cycle_fourni`) parce qu'on ne
        -- peut pas les déduire l'un de l'autre : les deux arrivent ici en
        -- `EXCLUDED.cycle_phase IS NULL`, et les confondre remet l'effacement à
        -- « ne touche pas ». C'est la confusion `''`/NULL du projet, cachée dans
        -- un ON CONFLICT.
        cycle_phase = CASE WHEN :cycle_fourni THEN EXCLUDED.cycle_phase
                           ELSE daily_logs.cycle_phase END
    """
)

_READ_SQL = text(
    """
    SELECT dl.log_date, dl.weight_kg, dl.sleep_hours, dl.water_liters, dl.calories,
           dl.cycle_phase
    FROM daily_logs dl
    JOIN athletes a ON a.id = dl.athlete_id
    WHERE a.legacy_id = :legacy AND dl.log_date BETWEEN :from AND :to
    ORDER BY dl.log_date
    """
)


def _resolve_athlete(session, legacy_id: str) -> str:
    """Résout le `legacy_id` du chemin en uuid SQL.

    Raises:
        ErreurMetier: `athlete_introuvable` (404) si l'athlète n'est pas en base.
    """
    row = session.execute(_ATHLETE_SQL, {"legacy": legacy_id}).first()
    if row is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND, "athlète inconnu en base SQL")
    return row[0]


@router.patch("/{date}", response_model=ChampsEcrits, responses=erreurs(401, 403, 404))
def patch_daily_log(
    date: str,
    payload: DailyLogPatch,
    access: AthleteAccess = Depends(require_athlete_access("owner")),
) -> dict:
    log_date = _validate_date(date)
    # `exclude_unset` et pas `exclude_none` : `cycle: null` doit ARRIVER jusqu'ici
    # — fourni, il efface.
    fields = payload.model_dump(exclude_unset=True)
    params = {
        "log_date": log_date,
        "weight_kg": fields.get("weight"),
        "sleep_hours": fields.get("sleep"),
        "water_liters": fields.get("water"),
        "calories": fields.get("calories"),
        "cycle": fields.get("cycle"),
        "cycle_fourni": "cycle" in fields,
    }
    with get_session() as session:
        params["athlete_id"] = _resolve_athlete(session, access.athlete_id)
        session.execute(_UPSERT_SQL, params)

    log_write(
        uid=access.claims["uid"],
        resource="daily_log",
        doc_path=f"athletes/{access.athlete_id}/dailyLogs/{date}",
        fields=sorted(fields.keys()),
    )
    return {"ok": True, "written": sorted(fields.keys())}


@router.get("", response_model=dict[str, JourneeLue], response_model_exclude_unset=True, responses=erreurs(401, 403, 404))
def list_daily_logs(
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    access: AthleteAccess = Depends(require_athlete_access("owner_or_staff")),
) -> dict:
    to_date = _validate_date(to) if to else date_cls.today()
    from_date = _validate_date(from_) if from_ else to_date - timedelta(days=29)
    if from_date > to_date:
        raise ErreurMetier("intervalle_inverse", status.HTTP_422_UNPROCESSABLE_CONTENT, "from > to")

    with get_session() as session:
        _resolve_athlete(session, access.athlete_id)  # 404 si absent
        rows = session.execute(
            _READ_SQL, {"legacy": access.athlete_id, "from": from_date, "to": to_date}
        ).all()

    out: dict[str, dict] = {}
    for log_date, weight, sleep, water, calories, cycle in rows:
        entry: dict[str, object] = {}
        if weight is not None:
            entry["weight"] = float(weight)
        if sleep is not None:
            entry["sleep"] = float(sleep)
        if water is not None:
            entry["water"] = float(water)
        if calories is not None:
            entry["calories"] = float(calories)
        if cycle is not None:
            entry["cycle"] = cycle
        key = log_date.isoformat() if hasattr(log_date, "isoformat") else str(log_date)
        out[key] = entry
    return out
