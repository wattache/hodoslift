"""Le suivi de poids par semaine — le calcul, côté serveur (29/09).

⚠️ ICI ET NULLE PART AILLEURS : la moyenne, l'écart depuis le départ et la
droite vers la cible se calculent une fois. Le front affiche un tableau, il ne
recompte rien — la règle dupliquée est le défaut le plus cher de ce dépôt.
"""
from datetime import date, timedelta

from sqlalchemy import text

_DEPART_SQL = text(
    "SELECT id, poids_depart_kg, poids_depart_le FROM athletes WHERE legacy_id = :legacy"
)
_POSER_DEPART_SQL = text(
    "UPDATE athletes SET poids_depart_kg = :kg, poids_depart_le = :le WHERE legacy_id = :legacy"
)
_EFFACER_DEPART_SQL = text(
    "UPDATE athletes SET poids_depart_kg = NULL, poids_depart_le = NULL WHERE legacy_id = :legacy"
)
#: La prochaine compétition où l'athlète est inscrit AVEC une catégorie fermée :
#: une catégorie ouverte (« + », max_kg NULL) ne vise rien.
_CIBLE_SQL = text(
    "SELECT c.name, coalesce(p.competes_on, c.start_date) AS le, w.max_kg, p.weight_category "
    "FROM competition_participants p "
    "JOIN competitions c ON c.id = p.competition_id "
    "JOIN weight_categories w ON w.gender = p.gender AND w.code = p.weight_category "
    "WHERE p.athlete_id = :aid AND w.max_kg IS NOT NULL "
    "AND coalesce(p.competes_on, c.start_date) >= :aujourdhui "
    "ORDER BY le LIMIT 1"
)
_PESEES_SQL = text(
    "SELECT log_date, weight_kg FROM daily_logs "
    "WHERE athlete_id = :aid AND weight_kg IS NOT NULL AND log_date >= :depuis AND log_date <= :jusqua "
    "ORDER BY log_date"
)

#: Sans départ posé, on regarde en arrière jusque-là pour trouver la première pesée.
FENETRE_SANS_DEPART = timedelta(days=90)


def lire_depart(conn, legacy_id: str) -> dict | None:
    row = conn.execute(_DEPART_SQL, {"legacy": legacy_id}).mappings().first()
    if row is None:
        return None
    return {"id": str(row["id"]),
            "depart": {"kg": float(row["poids_depart_kg"]), "date": row["poids_depart_le"]}
                      if row["poids_depart_kg"] is not None else None}


def poser_depart(conn, legacy_id: str, *, kg: float, le: date) -> int:
    return conn.execute(_POSER_DEPART_SQL, {"legacy": legacy_id, "kg": kg, "le": le}).rowcount


def effacer_depart(conn, legacy_id: str) -> int:
    return conn.execute(_EFFACER_DEPART_SQL, {"legacy": legacy_id}).rowcount


def lire_cible(conn, athlete_uuid: str, aujourdhui: date) -> dict | None:
    row = conn.execute(_CIBLE_SQL, {"aid": athlete_uuid, "aujourdhui": aujourdhui}).mappings().first()
    if row is None:
        return None
    return {"kg": float(row["max_kg"]), "date": row["le"], "competition": row["name"], "categorie": row["weight_category"]}


def lire_pesees(conn, athlete_uuid: str, depuis: date, jusqua: date) -> list[tuple[date, float]]:
    return [(r[0], float(r[1])) for r in conn.execute(_PESEES_SQL, {"aid": athlete_uuid, "depuis": depuis, "jusqua": jusqua})]


def theorique_le(jour: date, depart: dict, cible: dict) -> float | None:
    """La droite du départ à la cible, lue à `jour` — bornée à la cible : après
    la pesée, la ligne ne descend plus."""
    duree = (cible["date"] - depart["date"]).days
    if duree <= 0:
        return None
    avance = min(max((jour - depart["date"]).days, 0), duree)
    return round(depart["kg"] + (cible["kg"] - depart["kg"]) * avance / duree, 2)


def semaines(pesees: list[tuple[date, float]], *, depart: dict | None, cible: dict | None, aujourdhui: date) -> dict:
    """Les semaines de sept jours depuis le départ (ou la première pesée), jusqu'à
    celle d'aujourd'hui incluse. Les écarts se comptent depuis `reference`."""
    origine = depart["date"] if depart else (pesees[0][0] if pesees else None)
    if origine is None or origine > aujourdhui:
        return {"reference": depart["kg"] if depart else None, "semaines": []}

    lignes = []
    reference: float | None = depart["kg"] if depart else None
    du = origine
    numero = 1
    while du <= aujourdhui:
        au = du + timedelta(days=6)
        de_la_semaine = [kg for (jour, kg) in pesees if du <= jour <= au]
        moyenne = round(sum(de_la_semaine) / len(de_la_semaine), 2) if de_la_semaine else None
        if reference is None and moyenne is not None:
            reference = moyenne
        ecart = round(moyenne - reference, 2) if moyenne is not None and reference is not None else None
        pct = round(ecart / reference * 100, 2) if ecart is not None and reference else None
        theorique = theorique_le(min(au, aujourdhui), depart, cible) if depart and cible else None
        # Vers la cible : ce qui reste, et le chemin fait depuis la RÉFÉRENCE
        # (le départ, ou la première semaine) — 100 % à la cible, négatif si on
        # s'en éloigne. Sans cible, ou si la référence est déjà sous la cible,
        # il n'y a pas de chemin.
        reste = round(moyenne - cible["kg"], 2) if moyenne is not None and cible else None
        chemin = (round((reference - moyenne) / (reference - cible["kg"]) * 100, 1)
                  if reste is not None and reference is not None and reference > cible["kg"] else None)
        lignes.append({
            "numero": numero, "du": du, "au": au, "jours": len(de_la_semaine), "moyenne": moyenne,
            "ecartKg": ecart, "ecartPct": pct, "theorique": theorique,
            "ecartTheorique": round(moyenne - theorique, 2) if moyenne is not None and theorique is not None else None,
            "resteKg": reste, "cheminPct": chemin,
        })
        du = au + timedelta(days=1)
        numero += 1
    return {"reference": reference, "semaines": lignes}
