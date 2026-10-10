"""Ce que les écritures de compétition acceptent.

`extra="forbid"` à TOUS les niveaux (essai, mouvement, participant, compétition),
pas seulement au sommet.

⚠️ `createdBy`, `participantUids` et `score` sont ABSENTS de ces schémas : le
serveur les pose ou les dérive (`metier_competitions`, `scoring`). Les envoyer
donne un 422 — pas d'usurpation possible par le body.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.socle.schemas_common import validate_iso_date

AttemptTier = Literal["pessimistic", "realistic", "optimistic"]


class AttemptWeights(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pessimistic: float = Field(ge=0)
    realistic: float = Field(ge=0)
    optimistic: float = Field(ge=0)


class Attempt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weight: float = Field(ge=0)
    result: Literal["rep", "norep", ""]
    weights: AttemptWeights | None = None
    selectedTier: AttemptTier | None = None
    norepReason: str | None = Field(default=None, max_length=100)
    varUsed: bool | None = None


class Movement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    attempts: list[Attempt] = Field(default_factory=list, max_length=10)


class Participant(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    uid: str | None = Field(default=None, max_length=128)
    movements: list[Movement] = Field(default_factory=list, max_length=20)
    bodyweight: float | None = Field(default=None, ge=0, le=500)
    gender: Literal["M", "F"] | None = None
    weightCategory: str | None = Field(default=None, max_length=40)
    # Le jour où CET athlète passe. `validate_competes_on` vérifie qu'il tombe dans
    # [startDate, endDate].
    competesOn: str | None = None

    @field_validator("competesOn")
    @classmethod
    def _validate_competes_on(cls, value: str | None) -> str | None:
        return None if value is None else validate_iso_date(value)


class CategorieDeFlight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gender: Literal["M", "F"]
    weightCategory: str = Field(min_length=1, max_length=40)


class Flight(BaseModel):
    """Un flight : un nom, et les catégories qui y passent.

    Son rang dans la liste est son ordre de passage.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    categories: list[CategorieDeFlight] = Field(default_factory=list, max_length=20)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return _clean_name(value)


def _clean_name(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError("name ne peut pas être vide")
    return stripped


def _clean_movement_names(value: list[str]) -> list[str]:
    cleaned = []
    for item in value:
        stripped = item.strip()
        if not stripped:
            raise ValueError("movementNames : chaîne non vide attendue")
        cleaned.append(stripped)
    return cleaned


class CompetitionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    # Couple de dates. `date` reste accepté en COMPAT comme alias de `startDate` ;
    # `endDate` vaut `startDate` par défaut.
    date: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    location: str | None = Field(default=None, max_length=200)
    maxAttempts: int = Field(default=3, ge=1, le=10)
    # Le règlement choisit les motifs de « no rep » proposés (table `norep_reasons`).
    reglement: Literal["fnsl", "finalrep"] = "fnsl"
    movementNames: list[str] = Field(default_factory=list, max_length=20)
    participants: list[Participant] = Field(default_factory=list, max_length=200)
    flights: list[Flight] = Field(default_factory=list, max_length=30)
    editorEmails: list[str] | None = Field(default=None, max_length=50)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("date", "startDate", "endDate")
    @classmethod
    def _validate_dates(cls, value: str | None) -> str | None:
        return None if value is None else validate_iso_date(value)

    @field_validator("movementNames")
    @classmethod
    def _validate_movement_names(cls, value: list[str]) -> list[str]:
        return _clean_movement_names(value)

    @model_validator(mode="after")
    def _resolve_dates(self) -> "CompetitionCreate":
        start = self.startDate or self.date
        if not start:
            raise ValueError("startDate requis")
        self.startDate = start
        self.endDate = self.endDate or start
        if self.endDate < self.startDate:  # ISO 'YYYY-MM-DD' → comparaison lexicale = dates
            raise ValueError("endDate ne peut pas précéder startDate")
        return self


class CompetitionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    date: str | None = None       # compat : alias de startDate
    startDate: str | None = None
    endDate: str | None = None
    location: str | None = Field(default=None, max_length=200)
    maxAttempts: int | None = Field(default=None, ge=1, le=10)
    reglement: Literal["fnsl", "finalrep"] | None = None
    movementNames: list[str] | None = Field(default=None, max_length=20)
    participants: list[Participant] | None = Field(default=None, max_length=200)
    flights: list[Flight] | None = Field(default=None, max_length=30)
    editorEmails: list[str] | None = Field(default=None, max_length=50)

    # ⚠️ La version qu'on croit modifier (FRE-162), lue sur `GET /competitions`.
    # Le PATCH remplace les participants et leurs essais EN BLOC : sans elle, le
    # second coach à enregistrer efface le premier en silence. REQUISE, comme pour
    # les objectifs (FRE-134, FRE-163) : le client qui ne l'enverrait pas est
    # précisément celui qui écrase.
    version: str = Field(min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str | None) -> str | None:
        return None if value is None else _clean_name(value)

    @field_validator("date", "startDate", "endDate")
    @classmethod
    def _validate_dates(cls, value: str | None) -> str | None:
        return None if value is None else validate_iso_date(value)

    @field_validator("movementNames")
    @classmethod
    def _validate_movement_names(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _clean_movement_names(value)

    @model_validator(mode="after")
    def _resolve_dates_and_reject_empty(self) -> "CompetitionPatch":
        # Compat : `date` (ancien front) → startDate (+ endDate si non fourni à part).
        if self.date is not None and self.startDate is None:
            self.startDate = self.date
            if self.endDate is None:
                self.endDate = self.date
        self.date = None  # champ compat, jamais persisté ni relu tel quel
        if self.startDate is not None and self.endDate is not None and self.endDate < self.startDate:
            raise ValueError("endDate ne peut pas précéder startDate")
        if not self.model_dump(exclude_none=True):
            raise ValueError("patch vide : au moins un champ doit être fourni")
        return self

class CoachAvailabilityPut(BaseModel):
    """La disponibilité d'un coach sur UN jour d'une compétition.

    `pending` est une VALEUR, pas une absence : « pas encore répondu » dit qui
    relancer. Porté par l'absence de ligne, « jamais vu » et « ligne perdue »
    seraient indistinguables.
    """

    model_config = ConfigDict(extra="forbid")

    coachUid: str = Field(min_length=1, max_length=128)
    day: str
    status: Literal["pending", "available", "unavailable"]

    @field_validator("day")
    @classmethod
    def _validate_day(cls, value: str) -> str:
        return validate_iso_date(value)
