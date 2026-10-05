"""Les modèles de la vague 4 tiennent-ils face aux VRAIES données ? (FRE-70)

⚠️ POURQUOI CE SCRIPT EXISTE, et ce que les tests ne peuvent pas faire.

`tests/test_library.py` et `tests/test_competitions.py` tournent sur un stub
SQLite. Deux choses y échappent par construction :

* `library_entries.supports` est un TABLEAU en Postgres et du TEXT dans le stub —
  le commentaire du schéma de test le dit lui-même. Le cas « supports peuplé »,
  soit 26 exercices réels, n'y est donc jamais exercé ;
* les compétitions réelles portent des combinaisons que la fixture n'imagine pas
  (participants sans athlète lié, essais à moitié renseignés, mouvements sans
  essai).

Or un `response_model` VALIDE à l'exécution : un type qui ne colle pas rend 500.

Ce script rejoue les requêtes des routeurs sur la base RÉELLE et passe chaque
réponse à travers son modèle. C'est plus fort qu'une fixture : c'est exactement
la donnée qui sera servie.

LECTURE SEULE, sans écrire nulle part. À lancer avant de déployer un changement
de ces contrats :

    set -a; . ./.env; set +a && uv run python scripts/verifier_vague4_contrat.py
"""

import os
import pathlib
import sys
import warnings

warnings.filterwarnings("ignore")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from pydantic import ValidationError  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.socle.db import _normalize_url  # noqa: E402
from app.competitions.metier_competitions import AVAIL_SQL, COACH_AVAIL_SQL  # noqa: E402
from app.competitions.metier_competitions import days, iso, recompose_all  # noqa: E402
from app.bibliotheque.routes_library import _CATEGORIES, _GET_ALL_SQL  # noqa: E402
from app.competitions.schemas_competition_lecture import CompetitionLue, DispoDeCoach, LigneDeMatrice  # noqa: E402
from app.bibliotheque.schemas_library import BibliothequeLue  # noqa: E402


def bibliotheque(conn) -> dict:
    """La MÊME construction que `get_library`."""
    out: dict[str, list] = {c: [] for c in _CATEGORIES}
    for entry_id, category, name, competition, supports in conn.execute(_GET_ALL_SQL).all():
        entry = {"id": str(entry_id), "name": name}
        if category == "exercices":
            entry["competition"] = bool(competition)
        if supports:
            entry["supports"] = list(supports)
        out.setdefault(category, []).append(entry)
    return out


def matrice(conn, comp) -> list[dict]:
    """La MÊME construction que `get_availability`, matrice comblée comprise."""
    stored = {
        (r.coach_uid, iso(r.day)): r.status
        for r in conn.execute(AVAIL_SQL, {"cid": comp.id}).all()
    }
    coaches = conn.execute(text(
        "SELECT c.uid, COALESCE(u.display_name, u.email, c.uid) AS name "
        "FROM coaches c LEFT JOIN users u ON u.uid = c.uid ORDER BY name")).all()
    return [
        {"coachUid": c.uid, "coachName": c.name, "day": day,
         "status": stored.get((c.uid, day), "pending")}
        for c in coaches for day in days(comp.start_date, comp.end_date)
    ]


def _valider(modele, objets, etiquette: str, refus: list) -> int:
    for o in objets:
        try:
            modele.model_validate(o)
        except ValidationError as e:
            refus.append(f"⛔ {etiquette} : {e.errors()[0]}")
    return len(objets)


def main() -> int:
    engine = create_engine(_normalize_url(os.environ["DATABASE_URL"]))
    refus: list[str] = []

    with engine.connect() as conn:
        biblio = bibliotheque(conn)
        try:
            BibliothequeLue.model_validate(biblio)
        except ValidationError as e:
            refus.append(f"⛔ bibliothèque : {e.errors()[0]}")
        avec_supports = sum(1 for e in biblio["exercices"] if "supports" in e)
        print(f"  bibliothèque : {sum(len(v) for v in biblio.values())} entrées "
              f"({', '.join(f'{k} {len(v)}' for k, v in biblio.items())})")
        print(f"                 dont {avec_supports} avec `supports` — le cas que le stub ne sait pas jouer")

        comps = recompose_all(conn)
        n_part = sum(len(c["participants"]) for c in comps)
        n_essais = sum(len(m["attempts"]) for c in comps
                       for p in c["participants"] for m in p["movements"])
        _valider(CompetitionLue, comps, "compétition", refus)
        print(f"\n  compétitions : {len(comps)} · participants {n_part} · essais {n_essais}")
        sans_lieu = sum(1 for c in comps if "location" not in c)
        sans_uid = sum(1 for c in comps for p in c["participants"] if "uid" not in p)
        print(f"                 {sans_lieu} sans lieu, {sans_uid} participants sans compte lié")

        n_cases = 0
        for comp in conn.execute(text(
                "SELECT id, start_date, end_date FROM competitions ORDER BY id")).all():
            n_cases += _valider(LigneDeMatrice, matrice(conn, comp), "matrice", refus)
        print(f"\n  matrices     : {n_cases} cases coach × jour")

        coachs = [r[0] for r in conn.execute(text("SELECT uid FROM coaches ORDER BY 1")).all()]
        n_dispos = 0
        for uid in coachs:
            lignes = [{"competitionId": r.competition_id, "day": iso(r.day), "status": r.status}
                      for r in conn.execute(COACH_AVAIL_SQL, {"uid": uid}).all()]
            n_dispos += _valider(DispoDeCoach, lignes, f"dispos {uid}", refus)
        print(f"  dispos coach : {n_dispos} lignes déclarées sur {len(coachs)} coachs")

    for ligne in refus:
        print(ligne)
    print(f"\n  refusés par les modèles : {len(refus)}")
    print("\n→", "LES CONTRATS TIENNENT sur toute la production" if not refus
          else "⛔ un modèle refuse des données RÉELLES — ne pas déployer")
    return 1 if refus else 0


if __name__ == "__main__":
    raise SystemExit(main())
