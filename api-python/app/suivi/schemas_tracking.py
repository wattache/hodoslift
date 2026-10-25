"""Ce que rendent `GET /athletes/{id}/tracking`, `/records` et `/forme-du-jour` (FRE-70).

⚠️ AUCUNE CLÉ N'EST OMISE, contrairement aux journaux et aux objectifs : la route
construit ses dictionnaires d'un bloc, tous les champs y sont toujours, quitte à
valoir `null`. Pas d'`exclude_unset` — l'ajouter changerait le format.

⚠️ AUCUN CHAMP N'A DE DÉFAUT, pour la même raison : un défaut le rendrait
OPTIONNEL dans le contrat, donc `X | undefined` côté front. « Toujours présent,
parfois nul » et « parfois absent » sont deux promesses ; ici c'est la première.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MouvementTravaille(BaseModel):
    """Une entrée du sélecteur de mouvement, avec son volume.

    Le plus gros volume est le mouvement affiché par défaut.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    count: int


class SemaineDeSuivi(BaseModel):
    """Une semaine POUR LE MOUVEMENT choisi : charge max, tonnage, RPE, échecs."""

    model_config = ConfigDict(extra="forbid")

    week: str
    chargeMaxKg: float | None
    tonnageAtMaxKg: float | None
    topSetFormat: str | None
    tonnageTotalKg: float | None
    # Le tonnage si aucune série n'avait échoué (FRE-110). Égal au précédent
    # partout où rien n'a échoué — c'est l'ÉCART qui se dessine.
    tonnagePrevuTotalKg: float | None
    # Le pendant en RÉPÉTITIONS, pour l'autre unité du même graphe.
    repsPrevuTotal: float | None
    repsTotal: float | None
    feltRpe: float | None
    aimedRpe: float | None
    sessions: int
    fails: int
    failsAtMax: int
    macroNumber: int | None
    blockNumber: int | None
    # LA PROGRESSION (25/10) : les séries lourdes (RPE ≥ 8, zéro est un fait),
    # le meilleur 1RM ESTIMÉ de la semaine en LEST (table RTS, forme de
    # compétition seule) et l'intensité en % du meilleur de la période. `null`
    # quand rien ne s'estime — jamais 0 — et `e1Raison` dit pourquoi : la courbe
    # se coupe, et l'écran écrit la raison plutôt que « arrêtée ».
    lourdes: int
    e1Kg: float | None
    intensite: float | None
    e1Raison: Literal["variantes", "sans_rpe", "reps", "sans_pesee", "sans_charge"] | None


class PointDeRpe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: str
    rpe: float


class TravailRefait(BaseModel):
    """Un travail refait à l'identique où seul le RPE a changé (25/10).

    Même forme (`competition`, ou variantes + tempo + format), mêmes séries, reps
    et lest ; `points` dans l'ordre des dates, `delta` = dernier − premier :
    négatif, c'est du progrès que la charge max ne montre pas.
    """

    model_config = ConfigDict(extra="forbid")

    competition: bool
    variant: list[str]
    tempo: str | None
    format: str | None
    sets: float
    reps: float
    lestKg: float
    points: list[PointDeRpe]
    delta: float


class SemaineDeCourbe(BaseModel):
    """Une semaine d'UNE combinaison (variante, tempo, format) du mouvement (FRE-182)."""

    model_config = ConfigDict(extra="forbid")

    week: str
    chargeMaxKg: float | None
    topSetFormat: str | None
    tonnageTotalKg: float | None
    sessions: int
    fails: int


class CourbeDeCombinaison(BaseModel):
    """Le mouvement choisi, pour UNE combinaison (variante, tempo, format).

    ⚠️ `variant` est TRIÉE : deux ordres de saisie du même geste font une seule
    courbe. `[]`, `tempo: null`, `format: null` disent « sans » — une combinaison
    comme une autre, avec sa courbe. `series` compte les séries de la combinaison
    sur toute la période : c'est l'ordre de la liste, et ce qui décide des courbes
    allumées par défaut.
    """

    model_config = ConfigDict(extra="forbid")

    variant: list[str]
    tempo: str | None
    format: str | None
    series: int
    weeks: list[SemaineDeCourbe]


class SemaineAthlete(BaseModel):
    """Une semaine TOUS MOUVEMENTS CONFONDUS — le RPE global de l'athlète."""

    model_config = ConfigDict(extra="forbid")

    week: str
    feltRpe: float | None
    aimedRpe: float | None
    sessions: int
    macroNumber: int | None
    blockNumber: int | None


class SeriesDeMouvement(BaseModel):
    """Les séries d'UN mouvement de compétition sur UNE semaine (FRE-148).

    ⚠️ DEUX nombres, pas un. `setsDone` compte les séries TENUES (FRE-110) ; sans
    `setsPlanned` en face, une semaine où l'athlète n'est pas venu se lit comme
    une semaine où le mouvement n'était pas programmé. Le couple distingue « rien
    n'était prévu » (0/0), « prévu, pas fait » (0/7) et « une série est tombée »
    (6/7).

    Une ligne par (semaine, mouvement) : les semaines et les mouvements présents
    se déduisent de la liste. Un mouvement jamais fait ni programmé n'a aucune
    ligne.
    """

    model_config = ConfigDict(extra="forbid")

    week: str
    movement: str
    setsDone: int
    setsPlanned: int


class BlocRPE(BaseModel):
    """Le calibrage RPE d'un bloc : l'écart entre le visé et le ressenti.

    `rated` dit sur combien de séries l'écart est calculé — sans lui, un écart
    calculé sur deux séries se lirait comme un écart de bloc.
    """

    model_config = ConfigDict(extra="forbid")

    macroNumber: int
    blockNumber: int
    # `from` est un mot-clé Python : l'attribut s'appelle `from_`, et `alias`
    # rétablit le nom réel sur le fil. `populate_by_name` laisse le routeur
    # construire ses dictionnaires avec la clé « from ».
    from_: str | None = Field(alias="from")
    to: str | None
    weeks: int
    feltRpe: float | None
    aimedRpe: float | None
    gap: float | None
    rated: int


class SuiviLu(BaseModel):
    """La réponse entière du suivi.

    Les séries ne se déduisent pas l'une de l'autre : `weeks` porte le mouvement
    choisi ENTIER, `courbes` le même mouvement découpé par combinaison (FRE-182),
    `athleteWeeks` le RPE global, `rpeBlocks` le calibrage par bloc, et
    `setsByMovement` les séries de TOUS les lifts de compétition.

    ⚠️ Seules `weeks` et `courbes` dépendent de `exercise`. `setsByMovement` pose
    la question inverse de `weeks` : comparer tous les lifts sur une seule
    métrique, plutôt que creuser un mouvement sur toutes.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    exercise: str | None
    exercises: list[MouvementTravaille]
    lastSessionDate: str | None
    oneRmKg: float | None
    rpeBlocks: list[BlocRPE]
    athleteWeeks: list[SemaineAthlete]
    weeks: list[SemaineDeSuivi]
    courbes: list[CourbeDeCombinaison]
    setsByMovement: list[SeriesDeMouvement]
    # Les travaux refaits du mouvement choisi, du plus grand progrès au plus
    # grand recul (25/10). Dépend de `exercise`, comme `weeks`.
    refaits: list[TravailRefait]


class PointDeForme(BaseModel):
    """Une forme du jour, datée (FRE-119).

    ⚠️ Elle n'est PAS dans `daily_logs` : elle est portée par la SÉANCE
    (`form_of_the_day`, 1 à 5, saisie au lancement).
    """

    model_config = ConfigDict(extra="forbid")

    date: str
    form: int


class RecordLu(BaseModel):
    """Une case du tableau des records, AVEC son contexte.

    La meilleure charge d'un mouvement pour un nombre de répétitions donné.

    ⚠️ Le contexte n'est pas décoratif : la cellule affiche « 3x3 [DS] @ 9 » et
    l'endroit où le record a été fait. Sans lui, un chiffre seul ne se vérifie
    pas, et le coach ne peut pas remonter à la séance.
    """

    model_config = ConfigDict(extra="forbid")

    movement: str
    reps: int
    weight: float
    sets: str
    # Le LIBELLÉ des variantes (« DS + PAUSE »), pas la liste : un record est une
    # ligne d'histoire figée, pas une prescription qu'on rééditera.
    variant: str
    format: str
    clusterMode: str
    # Le ressenti s'il existe, la cible sinon — `''` si ni l'un ni l'autre.
    rpe: str
    # `''` quand la séance n'a jamais été datée, comme une part de l'historique.
    date: str
    location: str


class SingleLu(BaseModel):
    """Le meilleur single d'un mouvement, et d'où il vient."""

    model_config = ConfigDict(extra="forbid")

    mouvement: str
    charge: float
    date: str | None
    source: Literal["competition", "entrainement", "manuel"]
    # La compétition, ou « macro · bloc · semaine » pour une séance ; rien pour un record saisi.
    contexte: str | None


class CompetitionDuPalmares(BaseModel):
    """Une compétition de l'athlète. `place` parmi les `classes` qui ont un RIS."""

    model_config = ConfigDict(extra="forbid")

    id: str
    nom: str
    date: str
    total: float
    ris: float | None
    place: int | None
    classes: int


class PalmaresLu(BaseModel):
    """`GET /athletes/{id}/palmares` — le haut du tableau de bord.

    `unRm` est le 1RM de la table : par clé de `current_one_rm`, le plus lourd
    de la saisie et du meilleur single (`app/suivi/metier_palmares.py`).
    """

    model_config = ConfigDict(extra="forbid")

    genre: Literal["M", "F"] | None
    # La catégorie où son poids actuel le range ; `None` sans poids ou sans genre.
    categorie: str | None
    # Les quatre places du barème (MU, PU ou CU, DIPS, SQUAT) au meilleur single ;
    # `None` s'il en manque une.
    total: float | None
    ris: float | None
    records: list[SingleLu]
    competitions: list[CompetitionDuPalmares]
    unRm: dict[str, float]
