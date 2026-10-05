"""Contrat d'écriture d'une LIGNE d'exercice (FRE-12).

Une requête porte UNE ligne : un refus ne coûte que cette ligne, ce qui autorise
des vocabulaires stricts sans prendre la semaine en otage.

  * `extra="forbid"` : un champ inconnu est une faute du client ;
  * des `Literal` sur les vocabulaires clos, y compris `kind` et `repsUnit`.

Ce qui est du TEXTE reste du texte : `sets`, `reps`, `weight`, les RPE. Un coach
écrit « 8-10 », « PDC », « Sub5 » ; les typer refuserait des saisies légitimes.
"""

from uuid import UUID
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.socle.schemas_common import NatureDeGroupe, vide_en_none

_STR_MAX = 2000

# ⚠️ TOUT vocabulaire clos passe par `vide_en_none`. Son absence se LIT `''` :
# sans ce passage, le `Literal` rejette ce que la lecture vient de servir, et le
# contrat refuse sa propre lecture. Chaque champ réécrit l'`Annotated` en toutes
# lettres : un alias commun ne peut pas porter le `Literal`, qui diffère à chaque
# fois.
_MAX_VARIANTES = 10  # garde-fou anti-dégénérescence ; l'interface en propose 3


class ExerciseLinePatch(BaseModel):
    """Modification partielle d'une ligne.

    Tous les champs sont optionnels ; seuls ceux FOURNIS sont écrits. Un `None`
    explicite efface : c'est le geste « vider la case ». Un patch vide est refusé.
    """

    model_config = ConfigDict(extra="forbid")

    # ⚠️ `''` devient `None` (FRE-123) : `training_exercises.name` référence la
    # bibliothèque, et une clé étrangère REFUSE `''` là où elle accepte `NULL`.
    # « Pas encore choisi » est une absence. La lecture reconvertit `NULL → ''`.
    name: Annotated[str | None, BeforeValidator(vide_en_none)] = Field(
        default=None, max_length=_STR_MAX)
    variant: list[str] | None = Field(default=None, max_length=_MAX_VARIANTES)
    kind: Annotated[Literal["training", "warmup", "rehab"] | None,
                    BeforeValidator(vide_en_none)] = None
    tier: Literal[1, 2, 3] | None = None
    format: str | None = Field(default=None, max_length=_STR_MAX)
    clusterMode: str | None = Field(default=None, max_length=_STR_MAX)
    clusterRest: str | None = Field(default=None, max_length=_STR_MAX)
    tempo: str | None = Field(default=None, max_length=_STR_MAX)

    sets: str | None = Field(default=None, max_length=_STR_MAX)
    reps: str | None = Field(default=None, max_length=_STR_MAX)
    repsUnit: Annotated[Literal["count", "sec"] | None, BeforeValidator(vide_en_none)] = None
    weight: str | None = Field(default=None, max_length=_STR_MAX)
    weightLocked: bool | None = None
    # Sans lâcher la barre jusqu'à la ligne suivante du groupe (FRE-116). Rangé par
    # brokkr : hors groupe ou sur la dernière ligne, il retombe à `false`.
    unbroken: bool | None = None
    assistance: str | None = Field(default=None, max_length=_STR_MAX)
    aimedRPE: str | None = Field(default=None, max_length=_STR_MAX)
    rest: str | None = Field(default=None, max_length=_STR_MAX)

    repsDone: str | None = Field(default=None, max_length=_STR_MAX)
    weightDone: str | None = Field(default=None, max_length=_STR_MAX)
    restActual: str | None = Field(default=None, max_length=_STR_MAX)
    feltRPE: str | None = Field(default=None, max_length=_STR_MAX)
    feltRPEBySet: list[str] | None = Field(default=None, max_length=30)
    # ⚠️ Même borne et même type que le RPE par série : les trois tableaux
    # décrivent LES MÊMES séries, dans le même ordre. `str` et non `float` : une
    # série non notée reste `''` au milieu du tableau, sans inventer de zéro.
    repsDoneBySet: list[str] | None = Field(default=None, max_length=30)
    weightDoneBySet: list[str] | None = Field(default=None, max_length=30)
    athleteFeedback: str | None = Field(default=None, max_length=_STR_MAX)
    # Les tours bouclés d'un AMRAP de groupe (FRE-116). Du RÉALISÉ, donc ouvert à
    # l'athlète ; aligné par brokkr sur tout le groupe. Un entier : « 6 ou 7 » se
    # dit en commentaire, pas ici.
    toursRealises: int | None = Field(default=None, ge=0, le=1000)

    coachNote: str | None = Field(default=None, max_length=_STR_MAX)
    link: str | None = Field(default=None, max_length=_STR_MAX)
    groupId: str | None = Field(default=None, max_length=_STR_MAX)
    # ⚠️ `vide_en_none` comme les autres vocabulaires : un `Literal` refuse le
    # PAYLOAD entier, pas le seul champ fautif. Un `''` pour « pas de nature »
    # ferait échouer toute la ligne — la frappe du coach avec.
    #
    # ⚠️ La valeur n'est que PROPOSÉE : le serveur l'applique au GROUPE entier
    # (`metier_training_lines.propager_la_nature`). La nature d'une seule ligne
    # d'un groupe n'a pas de sens.
    groupKind: Annotated[NatureDeGroupe | None,
                         BeforeValidator(vide_en_none)] = None
    increment: str | None = Field(default=None, max_length=_STR_MAX)
    incrementUnit: Annotated[Literal["kg", "reps", "rpe", "sets"] | None,
                             BeforeValidator(vide_en_none)] = None

    # ⚠️ ACCEPTÉ, JAMAIS ÉCRIT (FRE-103). `mechano` est DÉRIVÉ (`ff_mechano`, aucune
    # colonne), et ce que la lecture rend doit pouvoir être renvoyé tel quel
    # (`test_ligne_d_exercice`) : sans cette déclaration, `extra="forbid"` rend un
    # 422 au client qui réécrit la ligne qu'il vient de lire. La route l'écarte
    # avant le SQL (`_LECTURE_SEULE`, `routes_training_lines.py`) : le score se
    # recalcule, il ne se saisit pas.
    mechano: float | None = None

    @model_validator(mode="after")
    def _refuse_le_vide(self) -> "ExerciseLinePatch":
        if not self.model_fields_set:
            raise ValueError("patch vide : au moins un champ doit être fourni")
        return self


class ExerciseLineCreate(ExerciseLinePatch):
    """Ajout d'une ligne.

    Le nom peut être ABSENT : c'est le geste de l'éditeur. Le coach clique
    « ajouter un exercice », obtient une ligne nue, puis la garnit. `''` est
    accepté et s'écrit `NULL`.

    ⚠️ À ne pas confondre avec le chargement en masse (création d'une semaine
    entière), qui ÉCARTE les lignes sans nom : là, une ligne vide est un résidu
    d'édition, pas une ligne qu'on vient de poser.
    """

    # Même règle qu'au-dessus : l'absence de nom se dit `NULL` (FRE-123).
    name: Annotated[str | None, BeforeValidator(vide_en_none)] = Field(
        default=None, max_length=_STR_MAX)
    # L'identité choisie par le client, qui rend l'ajout rejouable (cf.
    # `MacroCreate`). Pas une colonne de prescription : la route la sort du
    # corps avant d'écrire.
    id: UUID | None = None


class ExerciseOrder(BaseModel):
    """Réordonnancement d'une séance : la liste COMPLÈTE de ses lignes, dans le nouvel ordre.

    Complète, et pas un déplacement unitaire : le serveur peut alors VÉRIFIER
    qu'il ne manque ni n'entre personne. Un « déplace la ligne X en position 3 »
    se prêterait à des états partiels.
    """

    model_config = ConfigDict(extra="forbid")

    exerciseIds: list[str] = Field(min_length=1, max_length=50)


class ExerciseMove(BaseModel):
    """Déplacement d'une ligne vers une AUTRE séance de la même semaine (FRE-188).

    `position` est le rang visé dans la séance cible ; absente ou au-delà de la
    fin, la ligne se place en dernier. Un groupe (bi-set, dropset…) se déplace
    ENTIER, comme dans une séance (FRE-31) : ses membres restent consécutifs.
    """
    model_config = ConfigDict(extra="forbid")
    sessionId: str = Field(min_length=1, max_length=64)
    position: int | None = Field(default=None, ge=0)
