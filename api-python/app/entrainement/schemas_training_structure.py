"""Contrats d'écriture de la STRUCTURE de l'arbre (FRE-12).

Macros, blocs, semaines, séances, et la BASE d'un bloc. Les lignes d'exercice ont
leur propre contrat (`schemas_training_line.py`).

Même principe qu'au grain de la ligne : `extra="forbid"` et des vocabulaires
stricts. Un champ inconnu est une faute du client, pas une donnée à transporter.
"""

from uuid import UUID
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.socle.schemas_common import vide_en_none

_STR_MAX = 2000
_DATE = r"^\d{4}-\d{2}-\d{2}$"


# Toute date des contrats de structure passe par là. ⚠️ Ne PAS écrire
# `str | None = Field(pattern=...)` à la main : la lecture rend `''` pour une date
# absente, et le `pattern` le refuserait.
DateISO = Annotated[str | None, BeforeValidator(vide_en_none)]


class _Patch(BaseModel):
    """Socle des patchs partiels : rien d'inconnu, et jamais vide."""

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _refuse_le_vide(self):
        if not self.model_fields_set:
            raise ValueError("patch vide : au moins un champ doit être fourni")
        return self


class MacroPatch(_Patch):
    """Modification partielle d'un macro.

    ⚠️ PAS de dates : `training_macros` n'a pas de colonnes `start_date` /
    `end_date`, la période d'un macro se DÉDUIT de ses blocs. Les déclarer ici
    donnerait un 500 `UndefinedColumn` au client qui les envoie.
    """

    name: str | None = Field(default=None, max_length=_STR_MAX)
    trainingFrequency: int | None = Field(default=None, ge=0, le=14)
    coachNotes: str | None = Field(default=None, max_length=_STR_MAX)


class BlockPatch(_Patch):
    """⚠️ PAS de dates, comme le macro : la période d'un bloc se DÉDUIT de ses
    semaines (`blocs_lus`). `training_blocks` n'a plus de colonnes de dates."""

    name: str | None = Field(default=None, max_length=_STR_MAX)


class WeekPatch(_Patch):
    name: str | None = Field(default=None, max_length=_STR_MAX)
    hidden: bool | None = None
    startDate: DateISO = Field(default=None, pattern=_DATE)
    endDate: DateISO = Field(default=None, pattern=_DATE)
    athleteWeightKg: float | None = Field(default=None, ge=0, le=500)
    athleteHeightCm: float | None = Field(default=None, ge=0, le=300)


class SessionPatch(_Patch):
    # Le nom peut être VIDE, pour la même raison qu'une ligne se crée sans nom :
    # le coach efface avant de retaper, et chaque frappe part en PATCH. Un
    # `min_length=1` ferait de ce geste ordinaire un 422, donc un toast.
    name: str | None = Field(default=None, max_length=_STR_MAX)
    sessionDate: DateISO = Field(default=None, pattern=_DATE)
    # La FORME DU JOUR est une note de 1 à 5. `None` = pas renseignée — et la
    # LECTURE la rend `''`, donc l'écriture l'accepte, comme les dates et les
    # autres vocabulaires clos.
    formOfTheDay: Annotated[Literal[1, 2, 3, 4, 5] | None,
                            BeforeValidator(vide_en_none)] = None


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # L'identité choisie par le CLIENT — voir `IdentiteChoisie`.
    id: UUID | None = None
    name: str = Field(min_length=1, max_length=_STR_MAX)
    sessionDate: DateISO = Field(default=None, pattern=_DATE)
    formOfTheDay: Annotated[Literal[1, 2, 3, 4, 5] | None,
                            BeforeValidator(vide_en_none)] = None


class Order(BaseModel):
    """Réordonnancement : la liste COMPLÈTE, dans le nouvel ordre.

    Complète et non un déplacement unitaire, pour la même raison que sur les
    lignes : le serveur peut alors vérifier qu'il ne manque ni n'entre personne.
    """

    model_config = ConfigDict(extra="forbid")

    ids: list[str] = Field(min_length=1, max_length=50)


class WeekCreate(BaseModel):
    """Création d'une semaine, éventuellement AVEC son contenu.

    Le contenu est celui que l'appelant fournit : le serveur pose la structure et
    numérote, il ne calcule rien. La génération depuis la BASE a ses propres
    routes (`generate-week`, `next-week`).
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=_STR_MAX)
    startDate: DateISO = Field(default=None, pattern=_DATE)
    endDate: DateISO = Field(default=None, pattern=_DATE)
    hidden: bool = False
    # SYMÉTRIE AVEC LA LECTURE : `GET /training` rend un objet `athlete`, et
    # l'appelant reconstruit une semaine à partir de ce qu'il a lu. Seules la
    # taille et le poids sont retenus : le nom vient de la fiche athlète.
    athlete: dict[str, Any] | None = None
    # Chaque séance porte ses exercices, dans la forme du contrat de ligne. Les
    # bornes sont des garde-fous anti-dégénérescence, pas des règles métier.
    sessions: list[dict[str, Any]] = Field(default_factory=list, max_length=20)


class WeekContentReplace(BaseModel):
    """Contenu INTÉGRAL d'une semaine : ses séances et leurs lignes.

    La méta (nom, dates, `hidden`) ne bouge pas — elle a son propre PATCH.

    ⚠️ La route ne remplit qu'une semaine VIDE (FRE-84) : les séances sont
    insérées SANS réalisé, donc une semaine qui a déjà des séances est refusée
    (409 `semaine_deja_remplie`). Pour la régénérer, on la supprime d'abord.
    """

    model_config = ConfigDict(extra="forbid")

    # Même forme qu'en création (symétrie avec la lecture).
    athlete: dict[str, Any] | None = None
    sessions: list[dict[str, Any]] = Field(default_factory=list, max_length=20)


class BlockCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID | None = None
    name: str | None = Field(default=None, max_length=_STR_MAX)
    # Pas de dates : cf. `BlockPatch`.
    week: WeekCreate | None = None
    base: dict[str, Any] | None = None


class MacroCreate(BaseModel):
    """⚠️ L'IDENTITÉ PEUT VENIR DU CLIENT, et c'est ce qui rend une création
    REJOUABLE. Sans réseau, le front garde le geste et le renvoie au retour :
    un `POST` rejoué sans identité fabriquerait un second objet, et personne ne
    saurait dire lequel garder. Avec l'identité, le second envoi retrouve le
    premier objet et rend son id (`inserer_ou_retrouver`).

    Un macro rejoué DOIT porter l'identité de son bloc aussi, sinon le bloc
    seul serait créé deux fois ; la route l'impose.
    """

    model_config = ConfigDict(extra="forbid")

    id: UUID | None = None
    name: str | None = Field(default=None, max_length=_STR_MAX)
    trainingFrequency: int | None = Field(default=None, ge=0, le=14)
    coachNotes: str | None = Field(default=None, max_length=_STR_MAX)
    block: BlockCreate | None = None


class BaseContent(BaseModel):
    """La trame elle-même."""

    model_config = ConfigDict(extra="forbid")

    daySplit: list[dict[str, Any]] | None = Field(default=None, max_length=14)
    selectedPrincipaux: list[str] | None = Field(default=None, max_length=50)
    granularity: dict[str, str] | None = None
    s1StartDate: DateISO = Field(default=None, pattern=_DATE)
    s1EndDate: DateISO = Field(default=None, pattern=_DATE)
    principles: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    accessories: list[dict[str, Any]] = Field(default_factory=list, max_length=100)


class WeekDate(BaseModel):
    """Nouvelles dates d'une semaine du bloc."""

    model_config = ConfigDict(extra="forbid")

    weekId: str
    startDate: DateISO = Field(default=None, pattern=_DATE)
    endDate: DateISO = Field(default=None, pattern=_DATE)


class BasePreview(BaseModel):
    """Le brouillon de BASE dont on veut voir la semaine — sans l'enregistrer.

    ⚠️ Même forme que `BaseReplace.base`, et le même modèle : un aperçu plus
    permissif montrerait une semaine que l'enregistrement refuserait ensuite.
    """

    model_config = ConfigDict(extra="forbid")

    base: BaseContent


class BaseReplace(BaseModel):
    """Remplacement INTÉGRAL de la BASE, ET re-datation des semaines du bloc.

    Remplacement et non patch : l'éditeur tient un brouillon complet et
    l'enregistre d'un bloc. Un patch partiel obligerait à distinguer « champ
    absent » de « champ vidé » sur une structure imbriquée.

    ⚠️ `weekDates` n'est pas décoratif : régler la date de début de S1 décale
    TOUTES les semaines du bloc, et l'éditeur envoie les deux dans la même requête
    pour que la trame et le calendrier ne puissent pas diverger.
    """

    model_config = ConfigDict(extra="forbid")

    base: BaseContent
    weekDates: list[WeekDate] | None = Field(default=None, max_length=60)
