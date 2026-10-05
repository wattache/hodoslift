"""Les contrats des OBJECTIFS TECHNIQUES par mouvement (FRE-122).

Un journal de corrections que le coach adresse à UN athlète sur UN mouvement :
« garde les coudes hauts ». L'athlète les lit, il ne les écrit pas.

⚠️ Ce n'est pas `training_exercises.coach_note`, note ponctuelle sur UNE ligne
d'une séance, qui ne suit pas le mouvement : l'une dit « aujourd'hui, attention
à ça », l'autre « sur ce mouvement, voilà ce qu'on travaille en ce moment ».
"""

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_MAX = 2000
_MAX_MOUVEMENT = 200


def _non_vide(value: str) -> str:
    """Le texte sans ses blancs de bord, refusé s'il n'en reste rien.

    ⚠️ `min_length` ne suffit pas : «    » a une longueur de quatre et ne dit
    rien. La colonne porte le même `CHECK (btrim(…) <> '')` : sans cette
    validation, le client prendrait un 500 au lieu d'un 422 lisible.
    """
    coupe = value.strip()
    if not coupe:
        raise ValueError("le texte ne peut pas être vide")
    return coupe


class ObjectifTechniqueLu(BaseModel):
    """Un objectif, tel que l'écran le reçoit.

    ⚠️ Le nom porte « TECHNIQUE » parce qu'`ObjectifLu` existe DÉJÀ
    (`schemas_goals.py`). Avec deux classes du même nom, FastAPI préfixe les
    schémas par leur module dans l'OpenAPI — un identifiant qui traverse
    jusqu'aux types du front.

    ⚠️ `closLe` est une DATE, pas un booléen, et `null` tant que l'objectif est
    en travail : c'est la chronologie qui fait la valeur d'un journal.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    mouvement: str
    texte: str
    creePar: str
    creeLe: str
    closLe: str | None


class ObjectifTechniqueEcrit(BaseModel):
    """Ce qu'on envoie pour poser un objectif.

    ⚠️ `mouvement` est vérifié par la BASE, pas ici : la colonne porte une clé
    étrangère vers `library_entries`, là où la garantie tient — un `Literal`
    recopié dériverait au premier ajout de la bibliothèque. La route traduit la
    violation en 422, code `mouvement_inconnu`.
    """

    model_config = ConfigDict(extra="forbid")

    mouvement: str = Field(min_length=1, max_length=_MAX_MOUVEMENT)
    texte: str = Field(min_length=1, max_length=_MAX)

    _v_texte = field_validator("texte")(_non_vide)
    _v_mouvement = field_validator("mouvement")(_non_vide)


class ObjectifTechniqueCorrige(BaseModel):
    """La correction d'un objectif : son texte, ou son état.

    ⚠️ Le MOUVEMENT ne se change pas : déplacer un objectif, c'est en poser un
    autre — et `creeLe` mentirait sur depuis quand on le travaille.

    `clos` est un BOOLÉEN ici alors que la lecture rend une DATE : le client dit
    l'intention, le serveur pose l'horodatage. Une date fournie par le client
    lui permettrait d'antidater.
    """

    model_config = ConfigDict(extra="forbid")

    texte: str | None = Field(default=None, min_length=1, max_length=_MAX)
    clos: bool | None = None

    _v_texte = field_validator("texte")(lambda v: v if v is None else _non_vide(v))

    @model_validator(mode="after")
    def _refuse_le_vide(self) -> "ObjectifTechniqueCorrige":
        """⚠️ NI LA CORRECTION VIDE, NI UN CHAMP FOURNI À `null` (FRE-186).

        Les deux disent « je n'ai rien à dire », et le contrat les refuse tous
        les deux — mais pour deux raisons qui ne sont pas la même :

        · `texte: null` ne produisait aucun fragment `SET`, et la requête
          partait en `UPDATE … SET  WHERE …` : un 500 sur une faute de client ;
        · `clos: null` était bien pire. Le routeur lisait `clock_timestamp() if
          payload.clos else NULL`, et `None` est FAUX : un objectif atteint se
          ROUVRAIT en silence, sans 500 ni trace.

        Aucun des deux champs n'a de sens à `null` : `texte` est `NOT NULL` en
        base — un objectif sans texte ne dit rien, il se SUPPRIME —, et `clos`
        porte une intention, qui est vraie ou fausse.
        """
        if not self.model_fields_set:
            raise ValueError("correction vide : au moins un champ doit être fourni")
        nuls = sorted(c for c in self.model_fields_set if getattr(self, c) is None)
        if nuls:
            raise ValueError(f"champ fourni à null : {', '.join(nuls)} — "
                             "un champ qu'on ne veut pas changer s'OMET")
        return self
