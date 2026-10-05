"""La CIBLE d'un script qui écrit — et le refus d'écrire en production par mégarde.

⚠️ POURQUOI CE MODULE EXISTE (FRE-89). `brokkr/.env` pointe sur Neon, c'est-à-dire
la PRODUCTION : c'est voulu, l'API locale travaille sur les vraies données. Mais
les scripts héritent du même réglage, et un `--commit` tapé dans le bon dossier
écrivait donc en prod sans autre sommation que le dry-run qu'on est censé avoir
lu avant. Le garde-fou existait — dans un seul script, supprimé depuis.

La règle est simple, et c'est ce qui la rend tenable :

  * un DRY-RUN peut viser n'importe quelle base — il ne fait que lire ;
  * une ÉCRITURE vise le bac à sable (hôte local) sans rien dire ;
  * une ÉCRITURE vers un hôte distant exige `--production`, sinon refus.

`--production` n'est pas une confirmation de plus à cliquer : c'est le mot qu'il
faut avoir ÉCRIT pour que la commande touche Neon. On ne le tape pas par réflexe.

⚠️ `etl_training_sets` NE PASSE PAS PAR ICI, volontairement : c'est le job
nocturne de Cloud Run (`nidavellir/analytics.tf`), qui écrit en production par
construction, avec `--apply` et sans `--production`. Lui imposer ce garde-fou
casserait le job à la prochaine exécution.
"""

from __future__ import annotations

import argparse
import sys
from urllib.parse import urlsplit

_HOTES_LOCAUX = {"localhost", "127.0.0.1", "::1", ""}


def declarer_production(parser: argparse.ArgumentParser) -> None:
    """Ajoute `--production` à un parser. À appeler à côté de `--commit`/`--apply`."""
    parser.add_argument(
        "--production", action="store_true",
        help="autorise l'ÉCRITURE vers un hôte distant (Neon). Sans lui, seule une "
             "base locale accepte --commit/--apply ; le dry-run reste libre partout.",
    )


def hote_de(url: str) -> str:
    """L'hôte d'une URL de connexion — `''` si l'URL n'en porte pas (socket)."""
    return (urlsplit(url).hostname or "").lower()


def est_local(url: str) -> bool:
    return hote_de(url) in _HOTES_LOCAUX


def url_effective() -> str:
    """L'URL de l'engine que le script VA utiliser — pas une relecture du `.env`.

    ⚠️ `get_engine()` ET NON `_resolve_url()` : les tests remplacent `get_engine`
    par la connexion du Postgres jetable (fixture `pg`). Relire la configuration
    aurait donné Neon, et le garde-fou aurait refusé d'écrire… dans le conteneur
    de test. On regarde ce qui sera réellement écrit, pas ce qui est configuré."""
    from app.socle.db import get_engine

    moteur = get_engine()
    # Une `Connection` (fixture de test) porte `.engine` ; un `Engine`, non.
    return str(getattr(moteur, "engine", moteur).url)


def verifier_cible(ecriture: bool, production: bool, url: str | None = None) -> str:
    """Annonce la cible, et REFUSE une écriture distante sans `--production`.

    Rend l'hôte visé, pour que l'appelant puisse l'afficher. Lève `SystemExit`
    (code 2, comme une erreur d'arguments) plutôt que de retourner `False` : un
    script qui continuerait après un refus est exactement ce qu'on veut éviter."""
    url = url if url is not None else url_effective()
    hote = hote_de(url) or "(socket local)"
    if ecriture and not est_local(url) and not production:
        sys.exit(
            f"⛔ ÉCRITURE REFUSÉE vers « {hote} » — ce n'est pas une base locale.\n"
            "   Le dry-run reste possible sans rien ajouter. Pour écrire en\n"
            "   production, ajouter --production (et relire le dry-run d'abord)."
        )
    if ecriture:
        print(f"→ cible : {hote} — {'PRODUCTION' if not est_local(url) else 'bac à sable'}")
    return hote
