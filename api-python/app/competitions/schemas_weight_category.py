"""Ce que `GET /weight-categories` rend : les catégories de poids, par genre."""

from pydantic import BaseModel, ConfigDict


class CategoriesDePoids(BaseModel):
    """Les codes de catégorie par genre, dans l'ordre logique.

    ⚠️ Les DEUX clés sont toujours là, éventuellement vides : la route les force,
    pour qu'un front qui indexe `categories.F` ne plante pas sur une base sans
    catégorie féminine.

    ⚠️ Donc AUCUN défaut ici. La règle des modèles de lecture a trois branches :

    * clé TOUJOURS envoyée → pas de défaut. Un `default_factory` la rendrait
      optionnelle dans le contrat généré, donc `X | undefined` côté front ;
    * clé parfois OMISE (route servie avec `exclude_unset`) → `default_factory` ;
    * clé toujours envoyée mais parfois NULLE → `X | None`, sans défaut.
    """

    model_config = ConfigDict(extra="forbid")

    M: list[str]
    F: list[str]
