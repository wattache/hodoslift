"""Le contrat des douleurs suivies (FRE-195).

Une douleur est un objet qui DURE : l'athlète la nomme une fois, puis la note
jour après jour. Ce qui manquait avant n'était pas la mesure — `kine.intensite`
existe depuis août — mais l'identité à laquelle la rattacher.
"""

from datetime import date as date_cls
from typing import Literal
from uuid import UUID

from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

#: ⚠️ UN CODE, PAS UN LIBELLÉ : `deltoids:gauche`. Le front le fabrique en
#: touchant la figure (`lib/anatomie/zones.ts`), et le côté est celui DE
#: L'ATHLÈTE — jamais celui de l'écran.
Zone = Annotated[str, Field(min_length=1, max_length=60)]


def _sans_doublon(zones: list[str]) -> list[str]:
    if len(set(zones)) != len(zones):
        raise ValueError("une zone en double")
    return zones


#: ⚠️ AU MOINS UNE (FRE-196) : une douleur sans zone disparaît de la figure sans
#: être close.
Zones = Annotated[list[Zone], Field(min_length=1, max_length=20), AfterValidator(_sans_doublon)]


class DouleurCreee(BaseModel):
    """Ce que l'athlète déclare la première fois."""

    model_config = ConfigDict(extra="forbid")

    #: Son mot à lui — « mon épaule », « la tendinite ». C'est par lui qu'il la
    #: reconnaît dans une liste, pas par le code anatomique.
    nom: str = Field(min_length=1, max_length=80)

    #: « Épaule + biceps » est UNE douleur (FRE-196). Une zone déjà prise par une
    #: autre douleur vivante reste permise : un claquage du biceps n'est pas la
    #: vieille épaule.
    zones: Zones

    #: `None` quand il ne sait pas dire : « 4 ans », « souvent en début de bloc »
    #: sont des réponses vraies qu'aucune date ne rend.
    debut: date_cls | None = None


class DouleurModifiee(BaseModel):
    """Renommer, ou clore. Seuls les champs FOURNIS sont écrits."""

    model_config = ConfigDict(extra="forbid")

    nom: str | None = Field(default=None, min_length=1, max_length=80)
    #: REMPLACE l'ensemble des zones. `null` est refusé : retirer la dernière
    #: zone ferait disparaître la douleur de la figure sans la clore.
    zones: Zones | None = None
    debut: date_cls | None = None
    #: La date où ça ne fait plus mal. La reposer à `null` rouvre la douleur —
    #: ce qui arrive : une épaule se calme, puis revient.
    fin: date_cls | None = None


class ExerciceSignale(BaseModel):
    """La ligne de séance depuis laquelle l'athlète signale — son identifiant seul.

    ⚠️ LE CLICHÉ SE PREND CÔTÉ SERVEUR, jamais depuis le client : nom, variantes,
    format, séries, reps et charge sont relus dans `training_exercises`, et la
    ligne doit appartenir au programme de CET athlète (404 sinon).
    """

    model_config = ConfigDict(extra="forbid")

    #: En `UUID` : un identifiant mal formé est un 422, pas un `CAST` qui lève.
    exerciseId: UUID


class LogDouleur(BaseModel):
    """Ce que l'athlète en dit un jour donné."""

    model_config = ConfigDict(extra="forbid")

    #: ⚠️ `0` EST UNE RÉPONSE — « plus mal aujourd'hui ». La borne basse n'est pas
    #: 1 : sans le zéro, une douleur qui passe ne peut se dire que par le silence,
    #: et le silence veut déjà dire « pas saisi ».
    intensite: int = Field(ge=0, le=10)

    #: Ce que la figure ne capturera jamais : « fissure au ménisque », « aux dips ».
    commentaire: str | None = Field(default=None, max_length=500)

    #: ⚠️ TROIS ÉTATS, ET LE `None` EST LE PLUS IMPORTANT : `True` = jour
    #: entraîné, `False` = jour sans, `None` = l'athlète ne l'a pas dit. Un
    #: booléen non nullable rangerait « pas répondu » avec « repos », et les
    #: onze relevés déjà en base deviendraient onze journées de repos que
    #: personne n'a déclarées.
    #:
    #: ⚠️ DÉCLARÉ, PAS DÉRIVÉ. La base connaît les séries réalisées, mais
    #: « aucune trace ce jour-là » ne veut pas dire « repos » : une séance peut
    #: être saisie plus tard, ou pas du tout. Mesuré le 23/09 — 9 relevés sur 11
    #: tombaient un jour sans trace, dont un où l'athlète s'était entraîné la
    #: VEILLE.
    entrainement: bool | None = None

    #: La ligne de séance où ça a fait mal, quand on signale depuis elle.
    #:
    #: ⚠️ ELLE S'AJOUTE, ELLE NE REMPLACE PAS : la même épaule peut gêner au
    #: muscle up puis aux dips dans la même séance. Et signaler depuis une ligne
    #: DIT qu'on s'est entraîné : `entrainement: false` avec un exercice est une
    #: contradiction (422), `None` vaut `True`.
    exercice: ExerciceSignale | None = None


class ExerciceDeDouleur(BaseModel):
    """Le cliché d'une ligne de séance, tel qu'il a été signalé.

    ⚠️ `exerciseId` S'ÉTEINT AVEC LA LIGNE (semaine régénérée), le cliché reste :
    `ligneVivante` dit si le lien tient encore. `weight` et `reps` sont le réalisé
    s'il était saisi, sinon le prescrit — la règle du guichet.
    """

    model_config = ConfigDict(extra="forbid")

    exerciseId: str | None
    name: str
    variant: list[str]
    tempo: str | None
    format: str | None
    sets: str | None
    reps: str | None
    weight: str | None
    ligneVivante: bool


class LogLu(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: str
    intensite: int
    commentaire: str | None
    #: `None` quand la question n'a pas été posée — voir `LogDouleur`.
    entrainement: bool | None = None
    #: Les lignes de séance depuis lesquelles cette note a été signalée ; `[]`
    #: — jamais absent, jamais `null` — quand elle vient de l'onglet Douleurs.
    exercices: list[ExerciceDeDouleur]


class DouleurLue(BaseModel):
    """Une douleur et son histoire récente.

    ⚠️ `recurrente` SE DÉDUIT, ELLE NE SE STOCKE PAS. Une douleur notée plusieurs
    fois EST récurrente ; un booléen à côté du compte finirait par le contredire.
    C'est la même règle que « repos » dans la grille du cycle, qui se lit de
    l'absence de tier au lieu de se cocher.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    nom: str
    zones: list[str]
    debut: str | None
    fin: str | None
    #: Combien de fois elle a été notée, tout l'historique compris.
    logs: int
    recurrente: bool
    #: La dernière note connue, pour dire d'un coup d'œil où elle en est.
    derniere: LogLu | None


class DouleurCreeeReponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: Literal[True] = True
    id: str
