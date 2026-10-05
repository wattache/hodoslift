"""Le modèle de sortie de l'ARBRE tient-il face aux VRAIES données ? (FRE-70)

⚠️ POURQUOI, alors que les tests couvrent déjà six niveaux de clés. Parce qu'ils
les couvrent sur UNE fixture, construite à la main. La production porte 54
programmes écrits par de vrais coachs depuis deux ans : des semaines sans séance,
des blocs sans BASE, des `selectedPrincipaux` à NULL, des formes du jour absentes,
des variantes vides. Un `response_model` VALIDE à l'exécution — une seule de ces
formes qui ne rentre pas, et l'écran d'entraînement rend 500.

Ce script lit l'arbre de CHAQUE programme et le passe dans `ArbreLu`. C'est la
donnée qui sera réellement servie, pas une fixture.

LECTURE SEULE. Se lance avant de déployer un changement du contrat d'arbre :

    set -a; . ./.env; set +a && .venv/bin/python scripts/verifier_arbre_contrat.py
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
from app.entrainement.schemas_training_lecture import ArbreLu  # noqa: E402
from app.entrainement.training_tree import read_tree  # noqa: E402


def main() -> int:
    engine = create_engine(_normalize_url(os.environ["DATABASE_URL"]))
    with engine.connect() as conn:
        programmes = [r[0] for r in conn.execute(
            text("SELECT id FROM programs ORDER BY id")).all()]
        print(f"{len(programmes)} programmes à traverser\n")

        refuses = macros = blocs = semaines = seances = lignes = 0
        for pid in programmes:
            arbre = read_tree(conn, pid)
            for m in arbre["macros"]:
                macros += 1
                for b in m["blocks"]:
                    blocs += 1
                    for w in b["weeks"]:
                        semaines += 1
                        seances += len(w["sessions"])
                        lignes += sum(len(s["exercises"]) for s in w["sessions"])
            try:
                ArbreLu.model_validate(arbre)
            except ValidationError as e:
                refuses += 1
                for err in e.errors()[:3]:
                    print(f"⛔ {pid} : {'.'.join(str(x) for x in err['loc'])} — {err['msg']}")

    print(f"\n  macros {macros} · blocs {blocs} · semaines {semaines} "
          f"· séances {seances} · lignes {lignes}")
    print(f"  programmes refusés par le modèle : {refuses}")
    print("\n→", "LE CONTRAT TIENT sur toute la production" if not refuses
          else "⛔ le modèle refuse des données RÉELLES — ne pas déployer")
    return 1 if refuses else 0


if __name__ == "__main__":
    raise SystemExit(main())
