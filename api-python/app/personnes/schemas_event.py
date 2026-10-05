"""Les contrats des événements du calendrier d'un athlète.

`extra="forbid"` est volontaire : un champ non prévu est rejeté plutôt qu'écrit
aveuglément en base.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.socle.schemas_common import validate_iso_date

# ⚠️ PAS DE `cycle` (FRE-173). La phase du cycle est un fait du jour : elle vit
# dans `daily_logs.cycle_phase`, écrite par l'athlète seule — un calendrier
# laisserait le staff la déclarer à sa place.
EventType = Literal["competition", "vacation", "travel", "rest", "other"]

# ⚠️ UNE COMPÉTITION NE SE SAISIT PAS DEPUIS LE CALENDRIER : elle se définit dans
# son onglet, où elle porte un lieu, des mouvements, des essais et des
# participants. Un événement homonyme serait une compétition FANTÔME : affichée
# comme telle, sans fiche derrière, donc sans rien à ouvrir.
#
# ⚠️ LA LECTURE GARDE LA VALEUR : des lignes existantes la portent, et les refuser
# à la LECTURE effacerait de vrais engagements des calendriers. Seul le chemin
# d'écriture est fermé.
EventTypeEcrit = Literal["vacation", "travel", "rest", "other"]


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: EventTypeEcrit
    name: str = Field(min_length=1, max_length=200)
    startDate: str
    endDate: str
    emoji: str | None = Field(default=None, max_length=8)
    canTrain: bool | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name ne peut pas être vide")
        return stripped

    @field_validator("startDate", "endDate")
    @classmethod
    def _validate_dates(cls, value: str) -> str:
        return validate_iso_date(value)

    @model_validator(mode="after")
    def _conditional_fields(self) -> "EventCreate":
        # On REJETTE `end < start` (422) : pas d'échange silencieux des deux dates.
        if self.endDate < self.startDate:
            raise ValueError("endDate ne peut pas précéder startDate")
        return self


class EventPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # ⚠️ LE PATCH AUSSI : sinon un événement se crée en « autre » puis se retourne
    # en compétition d'un second appel. Une porte fermée à moitié n'est pas fermée.
    type: EventTypeEcrit | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    startDate: str | None = None
    endDate: str | None = None
    emoji: str | None = Field(default=None, max_length=8)
    canTrain: bool | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("name ne peut pas être vide")
        return stripped

    @field_validator("startDate", "endDate")
    @classmethod
    def _validate_dates(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return validate_iso_date(value)

    @model_validator(mode="after")
    def _reject_empty(self) -> "EventPatch":
        if not self.model_dump(exclude_none=True):
            raise ValueError("patch vide : au moins un champ doit être fourni")
        return self


class EvenementLu(BaseModel):
    """`GET /athletes/{id}/events` — un événement du calendrier (FRE-70).

    ⚠️ DEUX CLÉS SONT OMISES quand elles sont nulles — `emoji`, `canTrain` — et
    ne sortent PAS à `null` : la route les ajoute conditionnellement, et le type
    du front les déclare optionnelles (`emoji?`). D'où
    `response_model_exclude_unset=True` sur la route, et pas `exclude_none`, qui
    retirerait aussi `name` ou `endDate`, TOUJOURS présents. Omettre une clé et la
    rendre nulle sont deux messages différents pour le client.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    # ⚠️ Un `Literal`, et plus LARGE que celui de l'écriture : `competition` s'y
    # lit et ne s'y écrit pas — ce qui existe reste lisible. En `str`, le front
    # perdrait ses unions.
    type: EventType
    name: str = ""
    startDate: str
    endDate: str = ""
    emoji: str | None = None
    canTrain: bool | None = None
