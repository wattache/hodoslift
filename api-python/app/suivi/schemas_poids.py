"""Le suivi de poids par semaine : le point de départ, la cible, les semaines."""
from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class PoidsDepartEcrit(BaseModel):
    """`PUT /athletes/{id}/poids/depart` — la paire, toujours ensemble."""

    model_config = ConfigDict(extra="forbid")

    kg: float = Field(gt=0, le=400)
    date: date


class PoidsDepart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kg: float
    date: date


class CibleDePoids(BaseModel):
    """La pesée visée : la catégorie de la prochaine compétition où l'athlète
    est inscrit, à sa date. Pas une saisie — elle se déduit."""

    model_config = ConfigDict(extra="forbid")

    kg: float
    date: date
    competition: str
    categorie: str


class SemainePoids(BaseModel):
    """Une semaine de sept jours depuis le départ. `moyenne` est `None` sans
    pesée ; les écarts avec. `theorique` : la droite du départ à la cible,
    lue au dernier jour de la semaine (aujourd'hui pour celle en cours)."""

    model_config = ConfigDict(extra="forbid")

    numero: int
    du: date
    au: date
    jours: int
    moyenne: float | None
    ecartKg: float | None
    ecartPct: float | None
    theorique: float | None
    ecartTheorique: float | None
    #: Ce qui RESTE jusqu'à la pesée (moyenne − cible) : c'est le chiffre qu'on
    #: veut voir baisser (William, 29/09 — l'écart au départ décourage). Et le
    #: chemin fait, en % du départ à la cible.
    resteKg: float | None
    cheminPct: float | None


class PoidsSemainesLu(BaseModel):
    """`GET /athletes/{id}/poids/semaines`. `reference` : le poids depuis lequel
    les écarts se comptent — le départ s'il est posé, sinon la première semaine
    pesée (et `depart` est `None` : l'écran propose de le poser)."""

    model_config = ConfigDict(extra="forbid")

    depart: PoidsDepart | None
    cible: CibleDePoids | None
    reference: float | None
    semaines: list[SemainePoids]
