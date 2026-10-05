"""Les identifiants publics d'athlète et de programme (`legacy_id`, `programs.id`).

⚠️ Le format est FIGÉ — 20 caractères sur un alphabet de 62, celui des
identifiants hérités de Firestore. Ils sont la clé étrangère de tout l'arbre
d'entraînement et servent de segment d'URL : un second format laisserait deux
générations d'identifiants côte à côte.

`secrets` et non `random` : ces identifiants circulent dans des URL, et un
identifiant devinable inviterait à énumérer.
"""

import secrets

_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_LONGUEUR = 20


def nouvel_identifiant() -> str:
    """Un identifiant public neuf, au format des existants."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(_LONGUEUR))
