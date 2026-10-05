"""Les contrats des objectifs d'athlète (`athlete_goals`).

Domaine ISOLÉ : ni le profil, ni les 1RM, ni les PR. Le front écrit le tableau
COMPLET (remplacement), d'où `GoalsReplace`, sous garde de version (FRE-134).
On n'invente jamais une date : `createdAt` est requise et valide, et `achievedAt`
ne peut la précéder (le CHECK SQL le tient aussi).
"""

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.socle.schemas_common import validate_iso_date


class GoalItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # id du goal = legacy_id en SQL. Anti-injection (segment sûr).
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    exercise: str = Field(min_length=1, max_length=200)
    sets: str = Field(default="", max_length=100)
    reps: str = Field(default="", max_length=100)
    weight: str = Field(default="", max_length=100)
    motivation: str = Field(default="", max_length=2000)
    createdAt: str  # date 'YYYY-MM-DD' requise (created_on NOT NULL)
    achievedAt: str | None = None

    @field_validator("exercise")
    @classmethod
    def _strip_exercise(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("exercise ne peut pas être vide")
        return stripped

    @field_validator("createdAt")
    @classmethod
    def _valid_created(cls, value: str) -> str:
        return validate_iso_date(value)

    @field_validator("achievedAt")
    @classmethod
    def _valid_achieved(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        return validate_iso_date(value)

    @model_validator(mode="after")
    def _achieved_not_before_created(self) -> "GoalItem":
        # Comparaison lexicale d'ISO 'YYYY-MM-DD' = comparaison de dates.
        if self.achievedAt is not None and self.achievedAt < self.createdAt:
            raise ValueError("achievedAt ne peut pas précéder createdAt")
        return self


class GoalsReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Plafond anti-emballement : au-delà, 422 (le front n'en crée jamais autant).
    goals: list[GoalItem] = Field(max_length=200)

    # ⚠️ La version qu'on CROIT remplacer (FRE-134). Ce PUT remplace la liste
    # ENTIÈRE : sans elle, l'athlète et son coach (tous deux `owner_or_staff`)
    # s'effacent l'un l'autre en silence. Le client renvoie ce que la lecture lui
    # a donné ; si la base a bougé, l'écriture est REFUSÉE au lieu d'écraser.
    #
    # ⚠️ REQUISE : une version facultative ménagerait le client qui ne l'envoie
    # pas — précisément celui qui écrase.
    version: str = Field(min_length=1, max_length=64)


class ObjectifLu(BaseModel):
    """`GET /athletes/{id}/goals` — un objectif (FRE-70).

    ⚠️ `achievedAt` est OMIS tant que l'objectif n'est pas atteint, il ne sort pas
    à `null` : la route l'ajoute sous condition, avec
    `response_model_exclude_unset=True`. `exclude_none` retirerait aussi
    `motivation` ou `weight`, qui sont TOUJOURS présents. Omettre une clé et la
    rendre nulle sont deux messages différents pour le client.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    exercise: str
    # ⚠️ Des CHAÎNES, pas des nombres : `athlete_goals.sets/reps/weight` sont des
    # colonnes `text`, et la lecture rend même des chaînes VIDES (`''`) — un
    # `int`/`float` ici rendrait 500. Un objectif se formule « 3x5 » ou
    # « bodyweight ».
    #
    # ⚠️ NON NULLABLES, comme le contrat d'ÉCRITURE (`GoalItem` leur donne
    # `default=""`) : la lecture est au moins aussi précise que l'écriture, sinon
    # le front se protège d'un `null` qui ne peut pas arriver.
    sets: str = ""
    reps: str = ""
    weight: str = ""
    motivation: str = ""
    createdAt: str
    achievedAt: str | None = None


class ObjectifsLus(BaseModel):
    """`GET /athletes/{id}/goals` — la liste ET la version qui la date (FRE-134).

    ⚠️ Un OBJET, pas un tableau nu : la version voyage avec ce qu'elle date. Dans
    un en-tête `ETag`, elle échapperait à l'OpenAPI — donc au type TypeScript,
    donc à `tsc`. Ici, un front qui oublie de la renvoyer ne compile plus.
    """

    model_config = ConfigDict(extra="forbid")

    goals: list[ObjectifLu]
    version: str
