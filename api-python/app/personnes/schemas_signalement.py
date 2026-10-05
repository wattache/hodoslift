"""Ce que le staff LIT dans le tableau des signalements (FRE-70, FRE-195).

⚠️ Un `response_model` FILTRE la sortie : un champ absent d'ici disparaît de la
réponse sans erreur ni journal, le front reçoit `undefined` et l'écran se vide.
`test_le_signalement_porte_TOUS_ses_champs` fige l'ensemble exact des clés.
"""

from pydantic import BaseModel, ConfigDict, Field


class DouleurSignalee(BaseModel):
    """Une douleur notée ce jour-là.

    ⚠️ TYPÉE, LÀ OÙ LE QUESTIONNAIRE ÉTAIT LIBRE. Le bloc `kine` n'était pas
    décrit au contrat parce que les questions n'étaient pas arrêtées — c'était le
    bon compromis tant qu'on cherchait leur forme. Elles le sont : une douleur a
    une zone, une intensité et un commentaire. Ce qui reste libre est le TEXTE,
    pas la structure autour.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    nom: str = Field(description="Le nom que l'ATHLÈTE lui donne — « mon épaule »")
    zone: str = Field(description="Un CODE, jamais un libellé : `deltoids:droite`")
    intensite: int = Field(ge=0, le=10, description="`0` est une réponse : « plus mal »")
    commentaire: str | None
    logs: int = Field(description="Combien de fois elle a été notée, en tout")
    recurrente: bool = Field(
        description="Déduit du compte : notée plus d'une fois, elle revient")


class Signalement(BaseModel):
    """Une ligne du tableau : QUI, QUAND, et ce qui a été rapporté.

    ⚠️ UN ATHLÈTE ET UN JOUR, PAS UNE DOULEUR. La coche du lecteur porte cette
    clé-là (`signalement_vu`), et un athlète peut noter deux douleurs le même
    jour : les servir séparément ferait deux lignes qu'une seule coche ferait
    disparaître ensemble.
    """

    model_config = ConfigDict(extra="forbid")

    athleteId: str = Field(description="`athletes.legacy_id` — l'id que le front manipule")
    firstName: str
    lastName: str
    programId: str | None = Field(
        default=None, description="Par où le front navigue vers l'athlète")
    date: str = Field(description="Jour rapporté, ISO `YYYY-MM-DD`")
    douleurs: list[DouleurSignalee] = Field(
        description="Ce qui a été noté ce jour-là, la plus forte en tête")
