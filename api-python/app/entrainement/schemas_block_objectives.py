"""Contrat d'écriture des OBJECTIFS d'un bloc (`block_objectives`).

Écriture = REMPLACEMENT COMPLET de la liste d'un bloc (comme `PUT athlete_goals`) :
le coach édite une liste, pas des lignes indépendantes. Un seul appel règle ajout,
suppression ET réordonnancement, et `position` se dérive de l'index du tableau —
elle n'est donc PAS acceptée en entrée (`extra="forbid"` ⇒ 422 si envoyée).

Validation légère, comme les contrats voisins : chaînes libres bornées, liste
bornée (garde-fous anti-dégénérescence).
"""

from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from app.socle.schemas_common import vide_en_none

_STR_MAX = 2000  # anti-dégénérescence, aligné sur les contrats d'entraînement


class ObjectiveIn(BaseModel):
    """Un objectif de bloc. `position` est DÉRIVÉE de l'index → interdite ici."""

    model_config = ConfigDict(extra="forbid")

    # ⚠️ `''` → `None` (FRE-123) : `block_objectives.exercise` référence la
    # bibliothèque, et un objectif dont le mouvement n'est pas encore choisi doit
    # rester possible — c'est une absence, pas une chaîne vide.
    exercise: Annotated[str | None, BeforeValidator(vide_en_none)] = Field(
        default=None, max_length=_STR_MAX)
    variant: str | None = Field(default=None, max_length=_STR_MAX)
    format: str | None = Field(default=None, max_length=_STR_MAX)
    sets: str | None = Field(default=None, max_length=_STR_MAX)
    reps: str | None = Field(default=None, max_length=_STR_MAX)
    weightMin: str | None = Field(default=None, max_length=_STR_MAX)
    weightMax: str | None = Field(default=None, max_length=_STR_MAX)
    assistance: str | None = Field(default=None, max_length=_STR_MAX)
    # La date de clôture, au format 'YYYY-MM-DD' comme `athlete_goals`. NULL =
    # pas atteint. Elle traverse le REMPLACEMENT COMPLET comme les autres champs :
    # cocher une case renvoie la liste entière, il n'y a pas de route à part.
    # ⚠️ `''` devient NULL : la colonne est une `date`, décocher envoie la chaîne
    # vide, et Postgres refuse `''` là où il attend un jour — un 500.
    atteintLe: Annotated[str | None, BeforeValidator(vide_en_none)] = Field(
        default=None, max_length=10)


class ObjectivesReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    objectives: list[ObjectiveIn] = Field(default_factory=list, max_length=50)

    # ⚠️ La version qu'on CROIT remplacer (FRE-163), lue sur la charpente
    # (`objectivesVersion`). Même mécanisme que `GoalsReplace` : ce PUT remplace
    # la liste ENTIÈRE, et sans elle un onglet resté ouvert efface en silence ce
    # qu'un autre appareil vient d'écrire. REQUISE, sans porte de sortie : le
    # client qui ne l'enverrait pas est précisément celui qui écrase.
    version: str = Field(min_length=1, max_length=64)
