"""Helpers de validation partagés entre les schémas."""

import re
from datetime import date as date_cls
from typing import Literal

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_iso_date(value: str) -> str:
    """Vérifie le format YYYY-MM-DD ET que la date calendaire est valide."""
    if not _ISO_DATE.match(value):
        raise ValueError("date attendue au format YYYY-MM-DD")
    try:
        date_cls.fromisoformat(value)
    except ValueError:
        raise ValueError("date invalide")
    return value

def vide_en_none(v):
    """`''` → None, AVANT que le vocabulaire ou le motif ne s'applique.

    ⚠️ La lecture sert `''` pour « pas de valeur » : le contrat front type ces
    champs `string`, et un champ contrôlé de React qui reçoit `null` casse la
    saisie. Les contrats d'écriture portent des `Literal` et des motifs qui
    refusent `''`. Sans cette conversion, l'écriture refuse ce que sa propre
    lecture vient de rendre (`scripts/verifier_contrats.py` le relève).

    Tout champ dont l'ABSENCE se lit `''` passe par là."""
    return None if isinstance(v, str) and not v.strip() else v


#: La NATURE d'un groupe de lignes liées (FRE-36, FRE-116). Un seul `Literal` pour
#: les trois contrats qui la portent — lecture d'une séance, lecture d'une BASE,
#: écriture d'une ligne — et le CHECK SQL en face : une copie par contrat finirait
#: par oublier une nature.
NatureDeGroupe = Literal["biset", "dropset", "circuit", "emom", "amrap"]
