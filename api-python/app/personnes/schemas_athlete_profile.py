"""Les contrats d'ÉCRITURE d'une fiche athlète.

⚠️ `extra="forbid"` est le garde-fou de sécurité : coachId/linkedUserId/programId
ne sont pas dans le schéma, donc un corps qui les porte est refusé (422). La liste
blanche Pydantic EST la protection au niveau du champ.
"""

from datetime import date
from typing import Annotated, Literal

from pydantic import (
    BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator,
)

from app.socle.schemas_common import vide_en_none


class OneRMPatch(BaseModel):
    """Les 1RM par mouvement, en kg — une liste blanche fermée.

    Un zéro EFFACE le mouvement : sa clé est retirée de la fiche, pas mise à zéro.

    ⚠️ `benchPress` et `deadlift` ne font pas du SBD une discipline (FRE-147) : ce
    sont deux mouvements de plus dans la Table RM. La COMPOSITION des totaux
    (street, SBD) vit côté front, seul à les afficher.
    """

    model_config = ConfigDict(extra="forbid")

    muscleUp: float | None = Field(default=None, ge=0)
    pullUp: float | None = Field(default=None, ge=0)
    chinUp: float | None = Field(default=None, ge=0)
    dip: float | None = Field(default=None, ge=0)
    squat: float | None = Field(default=None, ge=0)
    benchPress: float | None = Field(default=None, ge=0)
    deadlift: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _reject_empty(self) -> "OneRMPatch":
        if not self.model_dump(exclude_none=True):
            raise ValueError("currentOneRM vide : au moins un champ doit être fourni")
        return self


class AthleteProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    firstName: str | None = Field(default=None, max_length=100)
    lastName: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=200)
    gender: Literal["M", "F", ""] | None = None
    height: float | None = Field(default=None, ge=0, le=300)  # cm
    weight: float | None = Field(default=None, ge=0, le=500)  # kg
    # ⚠️ UNE DATE, ET `""` POUR L'EFFACER (FRE-168) — comme `gender`, parce que
    # le patch écarte les `None` (`exclude_none`) : sans valeur sentinelle, une
    # date posée par erreur ne s'enlèverait plus. Le futur est refusé ici, pas
    # par un CHECK : « pas dans le futur » dépend du jour.
    birthDate: date | Literal[""] | None = None
    # ⚠️ ACCEPTÉ ET IGNORÉ, JAMAIS REFUSÉ. L'âge se calcule à la LECTURE depuis
    # `birthDate` ; mais la file hors-ligne (FRE-118) rejoue des patchs de versions
    # antérieures, et `extra="forbid"` ferait tomber en 422 le patch ENTIER — le
    # poids ou le prénom qui l'accompagnent seraient perdus.
    age: float | None = Field(default=None, deprecated=True)
    currentOneRM: OneRMPatch | None = None

    @field_validator("firstName", "lastName")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("champ ne peut pas être vide")
        return stripped

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip().lower()
        if not stripped:
            raise ValueError("email ne peut pas être vide")
        return stripped

    @field_validator("birthDate")
    @classmethod
    def _pas_dans_le_futur(cls, value):
        if isinstance(value, date) and value > date.today():
            raise ValueError("date de naissance dans le futur")
        return value

    @model_validator(mode="after")
    def _reject_empty(self) -> "AthleteProfilePatch":
        if not self.model_dump(exclude_none=True):
            raise ValueError("patch vide : au moins un champ doit être fourni")
        return self


class AthleteCreate(BaseModel):
    """La création d'un athlète (`POST /athletes`) : le prénom et l'email de contact.

    Le reste du profil (mensurations, 1RM…) se renseigne ensuite par PATCH.
    """

    model_config = ConfigDict(extra="forbid")

    firstName: str = Field(min_length=1, max_length=100)
    email: str = Field(max_length=200)

    @field_validator("firstName")
    @classmethod
    def _strip_first_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("firstName ne peut pas être vide")
        return stripped

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        stripped = value.strip().lower()
        if not stripped:
            raise ValueError("email ne peut pas être vide")
        return stripped


class AthleteCoachReassign(BaseModel):
    """La réassignation du coach d'un athlète (admin-only).

    Déplace `athletes.coach_uid` ET `programs.coach_uid` — les deux, l'autorisation
    d'un programme se lisant sur le programme.
    """

    model_config = ConfigDict(extra="forbid")

    coachUid: str = Field(min_length=1, max_length=200)


class AthleteArchive(BaseModel):
    """Archiver ou réactiver un athlète (FRE-127) — écrit par SON coach.

    ⚠️ UN BOOLÉEN ICI, UNE DATE EN BASE : le client dit l'INTENTION (« il
    suspend »), le serveur pose l'horodatage. Une date fournie par le client
    l'autoriserait à antidater, et ferait mentir « il a repris en mars ».

    ⚠️ CE N'EST PAS UN DÉTACHEMENT. Le lien coach reste intact : c'est ce qui
    garde l'accès du coach, donc le pouvoir de réactiver. Vider `coach_uid` ferait
    disparaître l'athlète pour tout le monde (FRE-128).
    """

    model_config = ConfigDict(extra="forbid")

    archive: bool


class AthleteKineSet(BaseModel):
    """Affectation du kiné qui suit un athlète (FRE-52) — écrite par SON coach.

    ⚠️ `kineUid` est NULLABLE, et le null a un sens métier : il DÉTACHE. C'est ce
    qui distingue ce contrat de `AthleteCoachReassign` (`athletes.coach_uid` est
    NOT NULL) : un athlète a toujours un coach, pas toujours un kiné.

    ⚠️ `''` détache aussi (`vide_en_none`), et s'écrit `NULL` : un champ contrôlé
    du front peut rendre `''` pour une absence, et l'écriture ne doit pas refuser
    ce que sa propre lecture rend.
    """

    model_config = ConfigDict(extra="forbid")

    kineUid: Annotated[str | None, BeforeValidator(vide_en_none)] = Field(
        default=None, max_length=200)


class AccesSupportDemande(BaseModel):
    """`POST /athletes/{id}/support` — combien de temps (FRE-202).

    24 h par défaut, une semaine au plus : un accès support est un dépannage, pas
    un rôle. Rouvert pendant qu'il court, il se prolonge.
    """
    model_config = ConfigDict(extra="forbid")
    heures: int = Field(default=24, ge=1, le=168)
