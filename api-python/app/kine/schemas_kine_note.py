from pydantic import BaseModel, ConfigDict, Field, field_validator

_MAX = 4000


class NoteLue(BaseModel):
    """Une note de suivi, telle que l'écran la reçoit.

    ⚠️ `kineUid` EST SERVI, et ce n'est pas décoratif : le club aura deux kinés
    un jour, et une note sans auteur ne veut plus rien dire à ce moment-là. Le
    servir dès maintenant évite d'avoir à le rétro-remplir."""

    model_config = ConfigDict(extra="forbid")

    id: str
    contenu: str
    kineUid: str
    creeLe: str
    modifieLe: str


class NoteEcrite(BaseModel):
    """Ce qu'on envoie pour créer ou corriger une note.

    ⚠️ LE CONTENU EST OBLIGATOIRE ET NON VIDE — la colonne porte le même CHECK.
    Une note sans texte est un clic de trop, pas une information, et elle
    encombrerait le journal qu'elle est censée éclairer."""

    model_config = ConfigDict(extra="forbid")

    contenu: str = Field(min_length=1, max_length=_MAX)

    @field_validator("contenu")
    @classmethod
    def _non_vide(cls, value: str) -> str:
        # ⚠️ `min_length` NE SUFFIT PAS : «&nbsp;&nbsp;&nbsp; » a une longueur de
        # trois et ne dit rien. C'est le même piège que `''` contre NULL, une
        # frontière plus loin — la validation passe, la base refuse, et le client
        # reçoit un 500 au lieu d'un 422 lisible.
        stripped = value.strip()
        if not stripped:
            raise ValueError("le contenu ne peut pas être vide")
        return stripped
