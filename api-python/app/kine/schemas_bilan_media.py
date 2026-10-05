from pydantic import BaseModel, ConfigDict


class MediaDemoLu(BaseModel):
    """Un média de démonstration, tel que l'écran le reçoit.

    ⚠️ `url` et non `chemin` : le seau est privé, ce qui sert à afficher est une
    URL SIGNÉE, à durée limitée. Le chemin de l'objet ne quitte jamais le
    serveur — le publier figerait l'hébergeur dans le contrat (FRE-99).

    ⚠️ `url` PEUT ÊTRE `null` : sans stockage configuré (local, tests) ou avec une
    clé expirée (FRE-104), le catalogue est rendu sans ses images plutôt que pas
    du tout. Le front gère l'absence — c'est un cas réel.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    url: str | None
    type: str
    legende: str | None
    creePar: str | None
    creeLe: str


class MediaDuTest(BaseModel):
    """Une image telle qu'un TEST la porte — la forme courte.

    ⚠️ Pas `MediaDemoLu` : `creePar`, `creeLe` et `type` regardent le CATALOGUE,
    pas l'affichage d'un protocole. Un test porte plusieurs images, un bilan
    beaucoup de tests : seuls les trois champs qui servent sont rendus.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    # Signée et à durée limitée ; `null` si le stockage ne répond pas (FRE-104).
    url: str | None
    legende: str | None
