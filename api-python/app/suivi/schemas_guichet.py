"""Ce que le GUICHET DU COACH rend — la file de travail, en une réponse.

⚠️ TROIS TYPES DE DOSSIER, ET L'ORDRE EST CELUI DU SERVEUR. La liste arrive
triée — douleurs d'abord, puis séances de la plus ancienne à la plus récente,
puis semaines — et le front l'affiche telle quelle. Si l'écran l'improvisait,
deux coachs ne verraient pas la même chose et « suivant » n'aurait plus de sens.

⚠️ Le dossier douleur porte la LISTE de ce qui a été noté ce jour-là :
le questionnaire n'est pas arrêté, et le front le parcourt sans en connaître les
questions (`QUESTIONNAIRE_KINE`).

⚠️ RIEN N'EST DÉGUISÉ : une mesure qu'on ne sait pas calculer est `None`, pas
`0` — un tonnage sans charge saisie n'est pas un tonnage nul (FRE-137).
"""

from typing import Annotated, Literal

from app.personnes.schemas_signalement import DouleurSignalee
from pydantic import BaseModel, ConfigDict, Field


class AthleteDuGuichet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    athleteId: str = Field(description="`athletes.legacy_id` — l'id que le front manipule")
    firstName: str
    lastName: str
    programId: str | None = Field(default=None, description="Par où le front navigue")


class ExerciceDuDossier(BaseModel):
    """Une ligne de la séance, de quoi juger sans l'ouvrir."""

    model_config = ConfigDict(extra="forbid")

    name: str
    # Textes TELS QUELS — « 100 », « PDC », « 60/65 » : ce sont les formes que
    # la ligne porte, et l'écran sait déjà les lire.
    charge: str | None = Field(description="Le réalisé s'il est saisi, sinon le prescrit")
    rpe: str | None = Field(description="Le ressenti, tel que saisi")
    seriesTenues: int | None
    seriesTotal: int | None


class DossierSeance(BaseModel):
    """Une séance réalisée que le coach n'a pas encore relue."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["seance"]
    athlete: AthleteDuGuichet
    programId: str
    sessionId: str
    weekId: str
    name: str
    blockName: str = Field(description="Pour situer la séance d'un coup d'œil : « Volume 1 · S3 »")
    weekNumber: int
    date: str | None = Field(description="`coalesce(session_date, week.start_date)`, ISO")
    seriesTenues: int
    seriesTotal: int
    tonnageKg: float | None
    rpeRessenti: float | None = Field(description="Moyenne des lignes qui en portent un")
    rpeVise: float | None
    exercices: list[ExerciceDuDossier]
    retours: list[str] = Field(description="`athlete_feedback`, par ligne, dans l'ordre")


class SeanceDuJour(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sessionId: str
    weekId: str
    programId: str
    name: str


class DossierDouleur(BaseModel):
    """Un signalement que CE lecteur n'a pas encore coché."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["douleur"]
    athlete: AthleteDuGuichet
    date: str = Field(description="Jour rapporté, ISO")
    # ⚠️ TYPÉ DEPUIS FRE-195, là où le questionnaire était libre : les questions
    # ne sont plus à chercher. Une douleur a une zone, une intensité, un
    # commentaire — et le texte reste libre à l'intérieur, pas la structure.
    douleurs: list[DouleurSignalee]
    seanceDuJour: SeanceDuJour | None = Field(
        description="La séance dont la date de garde est ce jour — ce qui décide s'il faut intervenir tout de suite")


class DossierSemaine(BaseModel):
    """Une semaine à écrire : la dernière programmée est RÉALISÉE, rien ne la suit (FRE-179).

    RÉALISÉE : chaque séance porte au moins une ligne tracée. Pas de coche, pas de
    date : le dossier se ferme quand une semaine plus loin reçoit une séance — sa
    condition de sortie est un fait, pas une déclaration. La semaine à écrire
    n'existe pas encore : le dossier porte la RÉALISÉE, depuis laquelle le coach
    la prolonge.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["semaine"]
    athlete: AthleteDuGuichet
    programId: str
    blockId: str
    weekId: str = Field(description="La semaine RÉALISÉE, depuis laquelle on écrit la suivante")
    weekNumber: int = Field(description="Le numéro de la semaine À ÉCRIRE (la réalisée + 1)")
    blockName: str


Dossier = Annotated[DossierDouleur | DossierSeance | DossierSemaine, Field(discriminator="type")]


class ComptesDuGuichet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    douleur: int
    seance: int
    semaine: int
    athletes: int = Field(description="Les athlètes que l'appelant staffe, hors archivés — « N athlètes à jour » sur la file vide")


class Guichet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dossiers: list[Dossier]
    comptes: ComptesDuGuichet
