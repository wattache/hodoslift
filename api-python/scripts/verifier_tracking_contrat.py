"""Le modèle de sortie du tracking tient-il face aux VRAIES données ? (FRE-70)

⚠️ POURQUOI CE SCRIPT EXISTE. `tests/test_tracking.py` tourne sur un stub SQLite,
et l'agrégat hebdomadaire est Postgres-only (`date_trunc`, `FILTER (WHERE …)`,
`count(DISTINCT (a, b))`). Les tests ne couvrent donc que le cas VIDE, qui
court-circuite avant l'agrégat : ils ne verraient pas un `response_model` qui
ferait tomber la route sur une valeur inattendue.

Or un modèle de sortie VALIDE à l'exécution : un type qui ne colle pas rend 500,
et le Tracking est un écran que les coachs ouvrent tous les jours.

Ce script rejoue les requêtes du routeur sur la base RÉELLE, pour CHAQUE athlète,
et passe chaque réponse à travers `SuiviLu`. C'est plus fort qu'une fixture : c'est
exactement la donnée qui sera servie.

LECTURE SEULE, et sans écrire nulle part. Se lance à la main avant de déployer un
changement du contrat de tracking :

    set -a; . ./.env; set +a && .venv/bin/python scripts/verifier_tracking_contrat.py
"""

import os
import pathlib
import sys
import warnings

warnings.filterwarnings("ignore")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from pydantic import ValidationError  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.suivi.metier_tracking import ATHLETE_WEEKS_SQL, EXERCISES_SQL, LAST_SESSION_SQL, ONE_RM_SQL, RPE_BLOCKS_SQL, WEEKS_SQL  # noqa: E402
from app.suivi.metier_tracking import num, one_rm_key, pick_exercise  # noqa: E402
from app.socle.db import _normalize_url  # noqa: E402
from app.suivi.schemas_tracking import SuiviLu  # noqa: E402


def reponse(conn, legacy: str) -> dict:
    """La MÊME construction que `get_tracking`, sans FastAPI ni autorisation."""
    exercises = [{"name": r.exercise, "count": r.n}
                 for r in conn.execute(EXERCISES_SQL, {"legacy": legacy}).all()]
    selected = pick_exercise(exercises, None)
    if selected is None:
        return {"exercise": None, "exercises": [], "weeks": [], "athleteWeeks": [],
                "rpeBlocks": [], "lastSessionDate": None, "oneRmKg": None}

    rows = conn.execute(WEEKS_SQL, {"legacy": legacy, "exercise": selected}).all()
    last = conn.execute(LAST_SESSION_SQL, {"legacy": legacy}).scalar()
    # ⚠️ MÊMES PARAMÈTRES QUE LA ROUTE. La première version passait « exercise »
    # à ces deux requêtes-là, qui n'en veulent pas — et le 1RM se lit par une CLÉ
    # de mouvement (`one_rm_key`), pas par son nom. Un script de vérification qui
    # diverge de ce qu'il vérifie ne vérifie rien.
    rm_key = one_rm_key(selected)
    one_rm = conn.execute(ONE_RM_SQL, {"key": rm_key, "legacy": legacy}).scalar() if rm_key else None
    one_rm = float(one_rm) if one_rm else None
    athlete_rows = conn.execute(ATHLETE_WEEKS_SQL, {"legacy": legacy}).all()
    block_rows = conn.execute(RPE_BLOCKS_SQL, {"legacy": legacy}).all()

    return {
        "exercise": selected,
        "exercises": exercises,
        "lastSessionDate": last.isoformat() if last else None,
        "oneRmKg": one_rm,
        "rpeBlocks": [
            {"macroNumber": r.macro_number, "blockNumber": r.block_number,
             "from": r.from_date.isoformat() if r.from_date else None,
             "to": r.to_date.isoformat() if r.to_date else None,
             "weeks": r.weeks, "feltRpe": num(r.felt_rpe),
             "aimedRpe": num(r.aimed_rpe), "gap": num(r.gap), "rated": r.rated}
            for r in block_rows
        ],
        "athleteWeeks": [
            {"week": r.semaine.isoformat(), "feltRpe": num(r.felt_rpe),
             "aimedRpe": num(r.aimed_rpe), "sessions": r.sessions,
             "macroNumber": r.macro_number, "blockNumber": r.block_number}
            for r in athlete_rows
        ],
        "weeks": [
            {"week": r.semaine.isoformat(), "chargeMaxKg": num(r.charge_max_kg),
             "tonnageAtMaxKg": num(r.tonnage_at_max_kg), "topSetFormat": r.top_set_format,
             "tonnageTotalKg": num(r.tonnage_total_kg), "repsTotal": num(r.reps_total),
             "feltRpe": num(r.felt_rpe), "aimedRpe": num(r.aimed_rpe),
             "sessions": r.sessions, "fails": r.fails, "failsAtMax": r.fails_at_max,
             "macroNumber": r.macro_number, "blockNumber": r.block_number}
            for r in rows
        ],
    }


def main() -> int:
    # `_normalize_url` et pas l'URL brute : SQLAlchemy mappe `postgresql://` sur
    # psycopg2, que le projet n'installe pas. C'est la même normalisation que
    # `app/socle/db.py`, réutilisée plutôt que recopiée.
    engine = create_engine(_normalize_url(os.environ["DATABASE_URL"]))
    with engine.connect() as conn:
        athletes = [r[0] for r in conn.execute(
            text("SELECT legacy_id FROM athletes WHERE legacy_id IS NOT NULL ORDER BY 1")).all()]
        print(f"{len(athletes)} athlètes à traverser\n")
        peuples = refuses = 0
        for legacy in athletes:
            corps = reponse(conn, legacy)
            if corps["weeks"] or corps["athleteWeeks"] or corps["rpeBlocks"]:
                peuples += 1
            try:
                SuiviLu.model_validate(corps)
            except ValidationError as e:
                refuses += 1
                print(f"⛔ {legacy} : {e.errors()[0]}")

    print(f"\n  réponses PEUPLÉES (donc passées par l'agrégat) : {peuples}")
    print(f"  refusées par le modèle                        : {refuses}")
    print("\n→", "LE CONTRAT TIENT sur toute la production" if not refuses
          else "⛔ le modèle refuse des données RÉELLES — ne pas déployer")
    return 1 if refuses else 0


if __name__ == "__main__":
    raise SystemExit(main())
