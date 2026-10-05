"""Chaque objet LU satisfait-il le contrat qui permet de le RÉÉCRIRE ?

Posée sur les 55 programmes RÉELS, et sans écrire une seule ligne.

POURQUOI CE SCRIPT EXISTE. Tous les défauts de FRE-12 appartiennent à une même
famille : **l'écriture refuse ce que sa propre lecture vient de rendre**. Deux
filets ont été posés, et aucun ne couvre ce que celui-ci couvre :

  * `tests/test_contrat_front.py` rejoue les payloads littéraux du front — mais
    avec des valeurs CHOISIES. Il a laissé passer le défaut des dates vides ;
  * `tests/test_aller_retour.py` teste l'invariant sur un arbre DÉPOUILLÉ — il
    attrape l'absence de valeur, mais pas la variété.

Ce qui manquait : la **vraie donnée, dans toute sa variété**. 62 macros, 125
blocs, 417 semaines, 1 815 séances, 9 961 lignes, écrites à la main pendant deux
ans par des coachs qui ont saisi « 8-10 », « PDC », « Sub5 », « FAIL », des
tempos exotiques et des noms avec des accents. Aucune fixture ne reproduit ça.

CE QU'IL NE FAIT PAS : écrire. On valide les contrats Pydantic en mémoire, on
n'appelle ni route ni base en écriture. Le lancer est donc sans risque, y compris
— en théorie — contre la production. Par prudence il vise le bac à sable.

Usage :
    uv run python -m scripts.verifier_contrats --env .env.local-pg
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter

from pydantic import ValidationError
from sqlalchemy import create_engine, text

from app.entrainement.schemas_training_line import ExerciseLinePatch
from app.entrainement.schemas_training_structure import (
    BaseContent, BlockPatch, MacroPatch, SessionPatch, WeekCreate, WeekPatch,
)
from app.entrainement.training_tree import read_tree
# ⚠️ `database_url` VIVAIT DANS L'ETL SUPPRIMÉ (22/08). Six lignes recopiées ici
# plutôt qu'un module de plus : ce script est le seul à en avoir besoin, et une
# indirection pour six lignes coûte plus cher à lire qu'elle ne fait gagner.
def database_url(env_path: str = ".env") -> str:
    """L'URL de la base, lue depuis `.env`, avec le driver psycopg forcé."""
    for line in open(env_path):
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip()
            return url.replace("postgresql://", "postgresql+psycopg://").replace(
                "postgres://", "postgresql+psycopg://")
    sys.exit(f"DATABASE_URL introuvable dans {env_path}")


def _garder(objet: dict, cles: tuple[str, ...]) -> dict:
    """Les seuls champs que le contrat d'écriture déclare."""
    return {k: objet[k] for k in cles if k in objet}


def _verifier(modele, charge: dict, ou: str, echecs: Counter, exemples: dict) -> None:
    try:
        modele.model_validate(charge)
    except ValidationError as e:
        for erreur in e.errors():
            champ = ".".join(str(p) for p in erreur["loc"])
            cle = f"{modele.__name__}.{champ} — {erreur['type']}"
            echecs[cle] += 1
            exemples.setdefault(cle, (ou, repr(charge.get(erreur["loc"][0]))[:60]))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--env", default=".env.local-pg")
    args = ap.parse_args(argv)

    moteur = create_engine(database_url(args.env))
    echecs: Counter = Counter()
    exemples: dict = {}
    vus = Counter()

    with moteur.connect() as conn:
        programmes = [r[0] for r in conn.execute(
            text("SELECT id FROM programs ORDER BY id")).all()]
        print(f"Relecture de {len(programmes)} programmes…\n")

        for pid in programmes:
            for macro in read_tree(conn, pid)["macros"]:
                vus["macros"] += 1
                ou = f"{pid}/{macro['id']}"
                _verifier(MacroPatch, _garder(macro, ("name", "trainingFrequency", "coachNotes")),
                          ou, echecs, exemples)

                for bloc in macro["blocks"]:
                    vus["blocs"] += 1
                    _verifier(BlockPatch, _garder(bloc, ("name", "startDate", "endDate")),
                              ou, echecs, exemples)
                    # La BASE part telle que l'éditeur l'a lue — c'est CE
                    # payload-là qui échouait sur les 54 blocs sans date de S1.
                    _verifier(BaseContent, bloc["base"], ou, echecs, exemples)

                    for semaine in bloc["weeks"]:
                        vus["semaines"] += 1
                        _verifier(WeekPatch,
                                  _garder(semaine, ("name", "hidden", "startDate", "endDate")),
                                  ou, echecs, exemples)
                        # …et le geste « ajouter une semaine », qui copie celle-ci.
                        _verifier(WeekCreate, {
                            "name": semaine["name"], "startDate": semaine["startDate"],
                            "endDate": semaine["endDate"], "hidden": semaine["hidden"],
                            "athlete": semaine["athlete"], "sessions": semaine["sessions"],
                        }, ou, echecs, exemples)

                        for seance in semaine["sessions"]:
                            vus["seances"] += 1
                            # `formOfTheDay` compris : l'écarter le rendait
                            # invisible à ce vérificateur ET au test d'aller-retour.
                            _verifier(SessionPatch,
                                      _garder(seance, ("name", "sessionDate", "formOfTheDay")),
                                      ou, echecs, exemples)
                            for ligne in seance["exercises"]:
                                vus["lignes"] += 1
                                _verifier(ExerciseLinePatch,
                                          {k: v for k, v in ligne.items() if k != "id"},
                                          ou, echecs, exemples)

    for cle, n in vus.items():
        print(f"  {n:6}  {cle}")

    if not echecs:
        print("\n✅ Chaque objet lu satisfait le contrat qui permet de le réécrire.")
        return 0

    print(f"\n❌ {sum(echecs.values())} refus — l'écriture n'accepte pas sa propre lecture :\n")
    for cle, n in echecs.most_common():
        ou, valeur = exemples[cle]
        print(f"  {n:6}  {cle}\n          ex. {ou} → {valeur}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
