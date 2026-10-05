"""Écrit le schéma OpenAPI dans `docs/openapi.json`.

⚠️ POURQUOI UN FICHIER VERSIONNÉ plutôt qu'un `curl` sur le serveur : c'est le
CONTRAT, et un contrat doit se relire en revue. Committé ici, tout changement de
forme de réponse apparaît en diff — y compris ceux qu'on n'a pas voulus. Et le
front peut régénérer ses types sans faire tourner brokkr.

Le pendant : ce fichier PÉRIME s'il n'est pas régénéré. `make openapi` avant de
livrer un changement de contrat, et la diff dit le reste.
"""

import json
import pathlib
import sys
import warnings

warnings.filterwarnings("ignore")
# Le script est lancé depuis `scripts/` par `make` : la racine du dépôt n'est pas
# sur le chemin d'import, contrairement à pytest qui l'y met.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.main import app  # noqa: E402

cible = pathlib.Path(__file__).resolve().parent.parent / "docs" / "openapi.json"
contenu = json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"

# ⚠️ `--check` NE RÉÉCRIT RIEN : IL DIT SI LE FICHIER A DÉRIVÉ (FRE-154). La
# seule garde était la CI, que ce projet ne lit pas — et le contrat a dérivé sur
# huit chemins sans que personne ne le voie : un code d'erreur de plus au
# serveur (`base_sans_dates`), absent du fichier, donc absent des types du front,
# donc INTRADUISIBLE par construction. `make deploy` joue ceci avant de partir.
if "--check" in sys.argv[1:]:
    if cible.exists() and cible.read_text(encoding="utf-8") == contenu:
        print(f"[contrat] OK — {cible.relative_to(cible.parent.parent)} est à jour")
        sys.exit(0)
    print(f"[contrat] ÉCHEC — {cible.relative_to(cible.parent.parent)} a DÉRIVÉ du code.")
    print("  Le front engendre ses types depuis ce fichier : un code ou un champ que")
    print("  le serveur connaît et que le fichier ignore est invisible au front.")
    print("  → `make openapi`, puis `npm run types:brokkr` côté eitri, et committer les deux.")
    sys.exit(1)

cible.write_text(contenu, encoding="utf-8")
print(f"{cible.relative_to(cible.parent.parent)} — {len(app.openapi()['paths'])} chemins")
