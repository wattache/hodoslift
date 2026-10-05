"""L'empreinte d'une liste, pour les écritures qui la remplacent en entier.

Les objectifs d'athlète (`PUT /athletes/{id}/goals`, FRE-134) et les objectifs de
bloc (`PUT …/blocks/{id}/objectives`, FRE-163) se remplacent en bloc, donc
« dernier écrivain gagne » : la lecture distribue une empreinte, l'écriture
l'exige, la relit DANS sa transaction, et refuse en 409 si elle a bougé.

⚠️ UNE SEULE fonction pour toutes les listes : deux définitions d'un même jeton
divergeraient (un séparateur, une troncature) et feraient refuser des écritures
légitimes d'un côté seulement.
"""

import hashlib
from collections.abc import Iterable, Sequence


def empreinte(lignes: Iterable[Sequence]) -> str:
    """L'empreinte d'une liste telle qu'elle est en base.

    ⚠️ CALCULÉE, non stockée : une colonne `modifie_le` dépendrait de la
    discipline de chaque écrivain. L'empreinte ne peut pas mentir : elle EST le
    contenu.

    ⚠️ L'ORDRE doit être TOTAL, côté appelant. Un `ORDER BY` qui laisse Postgres
    départager deux lignes ferait changer l'empreinte sans que la donnée bouge,
    et le PUT refuserait une écriture légitime.

    ⚠️ Le CONTENU, pas les identifiants, quand l'écriture les régénère : les
    objectifs de bloc sont réinsérés à chaque PUT, et un id dans l'empreinte la
    ferait changer pour une liste identique.

    Tronquée à 32 caractères : c'est un jeton d'égalité, pas une signature."""
    h = hashlib.sha256()
    for ligne in lignes:
        # `\x1f` (séparateur d'unité) : aucun champ ne peut le contenir, donc
        # deux découpages différents ne peuvent pas donner la même chaîne.
        h.update("\x1f".join("" if v is None else str(v) for v in ligne).encode())
        h.update(b"\x1e")
    return h.hexdigest()[:32]
