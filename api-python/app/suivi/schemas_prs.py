"""Les contrats des records manuels (`athlete_prs`).

Un PR porte son CONTEXTE — sets/format/variant/performedOn — car « 4 reps à 60 »
et « 4×4 à 60 » sont deux performances distinctes. Le POST prend UN objet (ajout
ou mise à jour par identité) ; l'id est généré en base et renvoyé. reps/weight
sont validés ici ; que le mouvement soit un lift de compétition se valide dans la
route, qui a accès à la base.
"""

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.socle.schemas_common import validate_iso_date


class PrCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    movement: str = Field(min_length=1, max_length=100)
    reps: int = Field(gt=0, le=100)
    weight: float = Field(gt=0, le=1000)  # kg
    sets: str | None = Field(default=None, max_length=40)
    format: str | None = Field(default=None, max_length=40)
    variant: str | None = Field(default=None, max_length=40)
    performedOn: str | None = None

    @field_validator("movement")
    @classmethod
    def _strip_movement(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("movement ne peut pas être vide")
        return stripped

    @field_validator("performedOn")
    @classmethod
    def _validate_performed_on(cls, value: str | None) -> str | None:
        return None if value is None else validate_iso_date(value)


class PrLu(BaseModel):
    """`GET /athletes/{id}/prs` — un record, avec son contexte (FRE-70).

    ⚠️ `performedOn` est TOUJOURS présent, éventuellement `null` : la route l'écrit
    par un ternaire, pas par un ajout conditionnel. Omettre une clé et la rendre
    nulle sont deux messages différents pour le client.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    movement: str
    reps: int
    weight: float
    # ⚠️ UNE CHAÎNE, PAS UN NOMBRE — `athlete_prs.sets` est une colonne `text`, et
    # c'est délibéré : le contexte d'un record peut être « 4 » comme « 4x4 ». Le
    # type du front (`ManualPr`) est généré depuis ce modèle.
    sets: str | None = None
    format: str | None = None
    variant: str | None = None
    performedOn: str | None = None
