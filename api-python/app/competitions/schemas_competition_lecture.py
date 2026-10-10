"""Ce que les lectures de compétition rendent : la liste, la matrice, les dispos d'un coach.

⚠️ Des clés OMISES, pas nulles, sur les compétitions (`response_model_exclude_unset`) :
`recompose_all` ne pose `location`, `uid`, `bodyweight`, `gender` et `weightCategory`
que s'ils sont renseignés. `competesOn` et `score`, eux, sont TOUJOURS rendus.

⚠️ Poids de corps et genre sont servis ENTRE PARTICIPANTS d'une même compétition
(FRE-141), comme sur une feuille de match. Ce périmètre ne s'élargit pas :
`list_competitions` le tient.

La forme est celle du document imbriqué d'origine : `date` doublonne `startDate`,
`editorEmails` vaut toujours `[]`. Les retirer changerait le format sur le fil.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TroisCharges(BaseModel):
    """Les trois hypothèses de charge d'un essai : le plan du coach avant la tentative.

    Présentes ensemble ou pas du tout.
    """

    model_config = ConfigDict(extra="forbid")

    pessimistic: float
    realistic: float
    optimistic: float


class EssaiLu(BaseModel):
    """Un essai. Deux clés seulement quand il n'a pas encore été tenté."""

    model_config = ConfigDict(extra="forbid")

    weight: float
    # ⚠️ `''` fait partie du VOCABULAIRE : la colonne est un enum (`rep`, `norep`)
    # NULLABLE, et `_recompose_attempt` rend `''` pour « pas encore tenté » — un
    # cas courant, pas une anomalie. Le front le type ainsi (`AttemptResult`).
    result: Literal["rep", "norep", ""]
    weights: TroisCharges | None = Field(default=None)
    selectedTier: Literal["pessimistic", "realistic", "optimistic"] | None = Field(default=None)
    # Seule une tentative manquée en porte une — la base l'impose :
    # `CHECK (norep_reason IS NULL OR result = 'norep')`.
    norepReason: str | None = Field(default=None)
    varUsed: bool | None = Field(default=None)


class MouvementLu(BaseModel):
    """Les essais d'un participant sur un mouvement, dans l'ordre de la compét."""

    model_config = ConfigDict(extra="forbid")

    name: str
    attempts: list[EssaiLu]


class ParticipantLu(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    # Absents quand non renseignés — voir l'en-tête du module.
    uid: str | None = Field(default=None)
    bodyweight: float | None = Field(default=None)
    gender: Literal["M", "F"] | None = Field(default=None)
    weightCategory: str | None = Field(default=None)
    # ⚠️ DÉDUIT, pas saisi (FRE-204) : le flight de sa catégorie. Absent quand
    # aucun flight ne porte sa catégorie.
    flight: str | None = Field(default=None)
    # …et ces deux-ci TOUJOURS présents, d'où l'absence de défaut.
    competesOn: str | None
    movements: list[MouvementLu]
    score: float
    # ⚠️ SERVIE, comme le score (FRE-203) : les totaux vers lesquels l'athlète se
    # dirige selon les trois hypothèses du plan, recalculés à chaque essai. À la
    # fin de la compétition, les trois égalent `score`.
    projection: TroisCharges

    # ⚠️ SERVI, pas calculé par le navigateur (FRE-92) : une seule définition.
    #
    # `risTotal` n'est PAS `score` : quatre places, dont une disputée entre le
    # pull up et le chin up (cf. la vue `competition_scores`).
    risTotal: float
    # `None` = on ne sait pas classer ce participant (poids ou genre absent,
    # aucun essai réussi). Ce n'est PAS zéro, qui serait un dernier de classement.
    ris: float | None


class CategorieDeFlightLue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gender: Literal["M", "F"]
    weightCategory: str


class FlightLu(BaseModel):
    """Un flight, dans l'ordre de passage de la compétition."""

    model_config = ConfigDict(extra="forbid")

    name: str
    categories: list[CategorieDeFlightLue]


class CompetitionLue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    startDate: str
    endDate: str
    # Doublon de `startDate`, gardé par compatibilité : le front l'utilise encore.
    date: str
    location: str | None = Field(default=None)
    maxAttempts: int
    reglement: Literal["fnsl", "finalrep"]
    movementNames: list[str]
    participants: list[ParticipantLu]
    # TOUJOURS présent, `[]` quand aucun flight n'est défini.
    flights: list[FlightLu]
    # Vaut toujours `[]` : la co-édition n'existe pas côté produit. Le retirer du
    # contrat serait un changement de format.
    editorEmails: list[str]
    createdBy: str
    participantUids: list[str]
    # L'empreinte du contenu, à renvoyer au `PATCH` (FRE-162).
    version: str


class LigneDeMatrice(BaseModel):
    """Une case de la matrice coach × jour d'UNE compétition.

    ⚠️ La matrice est COMPLÈTE, comblée à `pending` : elle répond à « qui reste-t-il
    à relancer ? », question qui a besoin des trous. C'est ce qui la distingue de
    `DispoDeCoach`.
    """

    model_config = ConfigDict(extra="forbid")

    coachUid: str
    # Jamais nul : `COALESCE(display_name, email, uid)` côté SQL.
    coachName: str
    day: str
    status: Literal["pending", "available", "unavailable"]


class DispoDeCoach(BaseModel):
    """Une disponibilité déclarée par UN coach, toutes compétitions confondues.

    Seules les lignes réellement déclarées sortent, sans matrice comblée : « il n'a
    rien dit sur cette compétition » se lit comme une absence.

    `competitionId` et non `coachUid` : le coach est le paramètre de la requête,
    ce qu'on apprend, c'est OÙ il va.
    """

    model_config = ConfigDict(extra="forbid")

    competitionId: str
    day: str
    status: Literal["pending", "available", "unavailable"]


class AthleteInscriptible(BaseModel):
    """Un athlète qu'un coach peut inscrire à la compétition (FRE-190).

    Tous ceux de la structure de la compétition, et pas seulement les siens : sur
    un plateau, tous les coachs gèrent tous les inscrits. Les seuls champs que
    l'inscription demande — l'identité, le compte qui rattache le participant à
    sa fiche, le poids et le sexe qui placent dans une catégorie.
    """

    id: str
    firstName: str
    lastName: str
    linkedUserId: str | None = None
    weight: float | None = None
    # Le même vocabulaire que la fiche (`AthletePublic.gender`) : la catégorie RIS en dépend.
    gender: Literal["M", "F"] | None = None
