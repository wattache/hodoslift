"""Le palmarès d'un athlète : ses meilleurs singles, ses compétitions, et le 1RM qui en découle.

Un single, c'est une répétition réussie, d'où qu'elle vienne : une séance tracée
(`lire_records`), un record saisi à la main (`athlete_prs`), un essai réussi en
compétition. Le plus lourd de chaque mouvement fait le palmarès.

⚠️ LE 1RM DE LA TABLE EST LE PLUS LOURD des deux : la saisie du coach
(`athletes.current_one_rm`) et le meilleur single. Une saisie n'est jamais
écrasée vers le bas, un single plus lourd la dépasse sans qu'on ait à y penser.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import text

from app.competitions import metier_competitions
from app.competitions.scoring import compute_ris
from app.entrainement.records import lire_records

#: Le nom d'un mouvement ↔ sa clé dans `athletes.current_one_rm`.
CLE_DU_MOUVEMENT = {
    "MUSCLE UP": "muscleUp", "PULL UP": "pullUp", "CHIN UP": "chinUp", "DIPS": "dip",
    "SQUAT": "squat", "BENCH PRESS": "benchPress", "DEADLIFT": "deadlift",
}

_ATHLETE_SQL = text("""
    SELECT a.id, a.current_one_rm, a.gender::text AS genre, a.weight_kg,
           (SELECT w.code FROM weight_categories w
             WHERE w.gender = a.gender AND (w.max_kg IS NULL OR w.max_kg >= a.weight_kg)
             ORDER BY w.position LIMIT 1) AS categorie
    FROM athletes a WHERE a.legacy_id = :legacy
""")
_PROGRAMME_SQL = text("SELECT id FROM programs WHERE athlete_id = CAST(:aid AS uuid)")
_PRS_SQL = text(
    "SELECT upper(movement) AS mouvement, weight_kg, performed_on FROM athlete_prs "
    "WHERE athlete_id = CAST(:aid AS uuid) AND reps = 1 AND movement IS NOT NULL"
)
# ⚠️ PAR LA FICHE (`athlete_id`), pas par le nom : un invité homonyme n'est pas lui.
_ESSAIS_SQL = text("""
    SELECT upper(m.movement) AS mouvement, a.weight_kg, co.name AS competition,
           coalesce(p.competes_on, co.start_date) AS jour
    FROM competition_attempts a
    JOIN competition_participants p ON p.id = a.participant_id
    JOIN competition_movements m ON m.id = a.movement_id
    JOIN competitions co ON co.id = p.competition_id
    WHERE p.athlete_id = CAST(:aid AS uuid) AND a.result = 'rep' AND a.weight_kg > 0
""")
_PARTICIPATIONS_SQL = text("""
    SELECT p.competition_id, p.name FROM competition_participants p
    WHERE p.athlete_id = CAST(:aid AS uuid)
""")


def _meilleur(singles: dict, mouvement: str, candidat: dict) -> None:
    """Garde le plus lourd ; à charge égale, le plus ancien — c'est là qu'il a été fait."""
    actuel = singles.get(mouvement)
    if (actuel is None or candidat["charge"] > actuel["charge"]
            or (candidat["charge"] == actuel["charge"] and (candidat["date"] or "9") < (actuel["date"] or "9"))):
        singles[mouvement] = candidat


def meilleurs_singles(session, aid: str) -> dict[str, dict[str, Any]]:
    """Le meilleur single de chaque mouvement, avec sa source et son contexte."""
    singles: dict[str, dict[str, Any]] = {}
    programme = session.execute(_PROGRAMME_SQL, {"aid": aid}).scalar()
    if programme is not None:
        for r in lire_records(session, programme):
            if r["reps"] == 1:
                _meilleur(singles, r["movement"].upper(), {
                    "charge": r["weight"], "date": r["date"] or None,
                    "source": "entrainement", "contexte": r["location"]})
    for r in session.execute(_PRS_SQL, {"aid": aid}).mappings():
        _meilleur(singles, r["mouvement"], {
            "charge": float(r["weight_kg"]), "date": r["performed_on"].isoformat() if r["performed_on"] else None,
            "source": "manuel", "contexte": None})
    for r in session.execute(_ESSAIS_SQL, {"aid": aid}).mappings():
        _meilleur(singles, r["mouvement"], {
            "charge": float(r["weight_kg"]), "date": r["jour"].isoformat() if r["jour"] else None,
            "source": "competition", "contexte": r["competition"]})
    return singles


def competitions_de(session, aid: str) -> list[dict[str, Any]]:
    """Ses compétitions, la plus récente d'abord : total, RIS, et sa place au RIS.

    La place se lit parmi ceux qui ONT un RIS : un athlète qu'on ne sait pas
    classer n'est pas dernier, il est hors classement.
    """
    sortie = []
    for cid, nom in session.execute(_PARTICIPATIONS_SQL, {"aid": aid}).all():
        docs = metier_competitions.recompose_all(session, cid)
        if not docs:
            continue
        doc = docs[0]
        participants = doc["participants"]
        lui = next((p for p in participants if p["name"] == nom), None)
        if lui is None:
            continue
        classes = sorted((p["ris"] for p in participants if p.get("ris") is not None), reverse=True)
        sortie.append({
            "id": doc["id"], "nom": doc["name"], "date": doc["startDate"],
            "total": lui["score"], "ris": lui.get("ris"),
            "place": classes.index(lui["ris"]) + 1 if lui.get("ris") is not None else None,
            "classes": len(classes),
        })
    return sorted(sortie, key=lambda c: c["date"], reverse=True)


def palmares(session, legacy: str) -> dict[str, Any] | None:
    """Le palmarès servi au tableau de bord ; `None` si l'athlète n'existe pas."""
    athlete = session.execute(_ATHLETE_SQL, {"legacy": legacy}).mappings().first()
    if athlete is None:
        return None
    aid = str(athlete["id"])
    singles = meilleurs_singles(session, aid)
    saisi = athlete["current_one_rm"] or {}
    un_rm: dict[str, float] = {}
    for mouvement, cle in CLE_DU_MOUVEMENT.items():
        candidats = [float(saisi[cle])] if isinstance(saisi.get(cle), (int, float)) and saisi[cle] > 0 else []
        if mouvement in singles:
            candidats.append(singles[mouvement]["charge"])
        if candidats:
            un_rm[cle] = max(candidats)
    # Le total des QUATRE PLACES du barème, le pull up et le chin up s'en disputant
    # une ; `None` s'il en manque une — un total amputé n'en est pas un.
    tire = max((singles[m]["charge"] for m in ("PULL UP", "CHIN UP") if m in singles), default=None)
    places = [singles.get("MUSCLE UP", {}).get("charge"), tire,
              singles.get("DIPS", {}).get("charge"), singles.get("SQUAT", {}).get("charge")]
    total = sum(places) if all(p is not None for p in places) else None
    poids = float(athlete["weight_kg"]) if athlete["weight_kg"] is not None else None
    return {
        "genre": athlete["genre"], "categorie": athlete["categorie"] if poids else None,
        "total": total, "ris": compute_ris(total, poids, athlete["genre"]) if total else None,
        "records": [{"mouvement": m, **s} for m, s in singles.items() if m in CLE_DU_MOUVEMENT],
        "competitions": competitions_de(session, aid),
        "unRm": un_rm,
    }
