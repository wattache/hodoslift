"""Ce que la PRODUCTION reçoit comme bornes de session — par le vrai chemin (FRE-154).

⚠️ POURQUOI UN SCRIPT DE PLUS, alors que `verifier_invariants.py` a déjà un
invariant `bornes_de_session`. Parce que celui-là lit la connexion qu'ON LUI
DONNE — celle du `.env` du poste, qui vise l'hôte direct — et qu'il est donc
vert par construction depuis un poste de dev, quoi que Cloud Run résolve. Il
prétendait garder le choix d'endpoint de `nidavellir/brokkr.tf` ; il ne le
pouvait pas.

Le 08/09, la production a tourné SANS `statement_timeout` en croyant en avoir
un : le pooler de Neon ne propage pas les défauts de rôle, et rien ne lisait ce
que brokkr recevait vraiment. Ici on interroge `/health/db`, qui rend
`current_setting` tel que le PROCESSUS DÉPLOYÉ le voit, par le chemin qu'il
emprunte. C'est la seule lecture qui ne peut pas mentir sur l'endpoint.

Joué par `make verifier`, donc par `make deploy`, après la vérification du SHA.

    uv run python scripts/verifier_bornes_servies.py https://brokkr-….run.app
"""

import json
import pathlib
import sys
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.socle.db import BORNES_DU_ROLE  # noqa: E402


def ecarts(bornes_servies: dict | None) -> list[str]:
    """Les bornes que le serveur ne reçoit pas comme `BORNES_DU_ROLE` l'attend.

    `None` ou absent vaut « pas reçu » : une réponse sans le champ `bornes` est
    un brokkr d'avant cette sonde, et ça se DIT plutôt que de passer pour bon."""
    servies = bornes_servies or {}
    return [
        f"{reglage} : attendu {attendu!r}, reçu {servies.get(reglage)!r}"
        for reglage, attendu in BORNES_DU_ROLE.items()
        if servies.get(reglage) != attendu
    ]


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage : verifier_bornes_servies.py <URL de brokkr>")
        return 2
    url = argv[0].rstrip("/")
    try:
        with urllib.request.urlopen(f"{url}/health/db", timeout=20) as reponse:
            corps = json.load(reponse)
    except Exception as e:  # noqa: BLE001 — on veut le message, pas la trace
        print(f"[bornes] ÉCHEC — /health/db injoignable : {e}")
        return 1

    manquantes = ecarts(corps.get("bornes"))
    if manquantes:
        print("[bornes] ÉCHEC — la production ne reçoit PAS ses bornes de session :")
        for m in manquantes:
            print(f"   · {m}")
        print("\n  Soit le rôle ne les porte pas (migration `…_les_bornes_de_session…`),")
        print("  soit brokkr passe par le POOLER, qui ne propage pas les défauts de rôle.")
        print("  `DB_HOST` doit viser `database_host`, pas `database_host_pooler`.")
        return 1

    print("[bornes] OK — la production reçoit "
          + ", ".join(f"{r}={v}" for r, v in BORNES_DU_ROLE.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
