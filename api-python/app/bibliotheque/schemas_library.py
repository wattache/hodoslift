"""Les contrats de la bibliothèque d'exercices (`library_entries`).

Une seule table pour les cinq catégories, une bibliothèque par structure, unique
par (structure, category, name). `competition` marque les lifts suivis en 1RM et
n'a de sens que pour `exercices` (CHECK côté SQL, validé ici pour un 422 propre).
`supports` est un vocabulaire CLOS : un groupe inconnu est refusé, pas écarté.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

LibraryCategory = Literal["exercices", "variantes", "assistances", "tempos", "formats"]

# Groupes principaux qu'un renforcement peut soutenir (cf. PARENT_GROUPS front).
_PRINCIPAL_GROUPS = {"MU", "PU", "DIP", "SQ"}


def _clean_supports(value: list[str] | None) -> list[str] | None:
    """Normalise les groupes soutenus, et REFUSE ce qui n'en est pas (FRE-140).

    ⚠️ Un groupe INCONNU lève, il n'est pas écarté : tronquer `["MU", "EPAULE"]`
    en `["MU"]` serait une écriture différente de celle demandée, présentée comme
    un succès. Comme les autres vocabulaires clos (`kind`, `repsUnit`,
    `groupKind`…), celui-ci refuse en 422.

    La NORMALISATION reste — espaces, casse, doublons : elle ne perd rien,
    `" mu "` et `"MU"` désignent le même groupe. Et un tableau VIDE rend `None` :
    le vide n'existe pas en base, l'absence si.

    Raises:
        ValueError: un groupe hors de `_PRINCIPAL_GROUPS`.
    """
    if value is None:
        return None
    out: list[str] = []
    inconnus: list[str] = []
    for item in value:
        g = item.strip().upper()
        if g not in _PRINCIPAL_GROUPS:
            inconnus.append(item)
        elif g not in out:
            out.append(g)
    if inconnus:
        raise ValueError(
            f"groupe(s) inconnu(s) : {', '.join(inconnus)} — "
            f"attendu parmi {', '.join(sorted(_PRINCIPAL_GROUPS))}")
    # ⚠️ LE TABLEAU VIDE N'EXISTE PAS, ET C'EST LA BASE QUI L'A DÉCIDÉ (FRE-157) :
    # `library_entries_supports` le refuse, et les cinq entrées qui en portaient
    # un ont été reprises en NULL. Le laisser passer jusqu'au SQL rendait un 500
    # sur une demande parfaitement légitime — « cette entrée ne soutient rien ».
    # Ici le vide devient l'ABSENCE, une seule façon de dire « rien ».
    return out or None


class LibraryEntryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: LibraryCategory
    name: str = Field(min_length=1, max_length=200)
    competition: bool = False
    # Groupes principaux soutenus (renforcements). Facultatif.
    supports: list[str] | None = Field(default=None, max_length=8)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name ne peut pas être vide")
        return stripped

    @field_validator("supports")
    @classmethod
    def _validate_supports(cls, value: list[str] | None) -> list[str] | None:
        return _clean_supports(value)

    @model_validator(mode="after")
    def _competition_only_for_exercices(self) -> "LibraryEntryCreate":
        if self.competition and self.category != "exercices":
            raise ValueError("competition réservé à la catégorie 'exercices'")
        return self


class LibraryEntryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    competition: bool | None = None
    supports: list[str] | None = Field(default=None, max_length=8)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("name ne peut pas être vide")
        return stripped

    @field_validator("supports")
    @classmethod
    def _validate_supports(cls, value: list[str] | None) -> list[str] | None:
        return _clean_supports(value)

    @model_validator(mode="after")
    def _reject_empty(self) -> "LibraryEntryPatch":
        """Refuse un patch qui ne demande rien.

        ⚠️ SUR LES CLÉS FOURNIES, PAS SUR LES VALEURS (FRE-185). Tester
        `self.supports is None` confondait « non fourni » avec « fourni vide » —
        et comme le contrat normalise désormais `[]` en `None` (le vide n'existe
        pas en base, FRE-157), `PATCH {"supports": []}` était refusé en 422 :
        vider une entrée devenait impossible.

        La cohérence competition⇒'exercices' dépend de la catégorie EXISTANTE
        (non patchable) : elle est vérifiée dans le routeur (RMW), pas ici.
        """
        if not self.model_fields_set:
            raise ValueError("patch vide : au moins un champ (name, competition ou supports)")
        # ⚠️ `null` N'EST UNE VALEUR QUE POUR `supports`, et l'asymétrie est le
        # sujet : `name` et `competition` sont NOT NULL en base — les vider
        # n'existe pas —, tandis que « cette entrée ne soutient rien » est un
        # état légitime, que `[]` et `null` disent tous les deux.
        # Sans ce refus, `{"name": null}` gardait l'ancien nom et répondait 200 :
        # le client demandait, le serveur ne faisait rien, et se taisait.
        nuls = sorted(c for c in self.model_fields_set
                      if c != "supports" and getattr(self, c) is None)
        if nuls:
            raise ValueError(f"champ fourni à null : {', '.join(nuls)} — "
                             "un champ qu'on ne veut pas changer s'OMET")
        return self


# --------------------------------------------------------------------------- #
# LECTURE — ce que `GET /library` rend (FRE-70)
#
# ⚠️ Des clés OMISES, pas nulles, d'où `response_model_exclude_unset=True` sur la
# route. Le routeur ne pose `competition` que sur un exercice et `supports` que
# s'il y en a ; sans ce réglage, le modèle comblerait les trous — un tempo
# porterait `competition: false`. Le contrat DÉCRIT ce qui peut être là, la route
# décide ce qui y est.
# --------------------------------------------------------------------------- #


class EntreeDeBibliotheque(BaseModel):
    """Une entrée, toutes catégories confondues.

    ⚠️ Une seule table pour les cinq catégories : un exercice, une variante et
    un tempo ont la même forme, et les deux champs conditionnels (`competition`,
    `supports`) portent toute la différence. Ils sont OMIS quand ils ne
    s'appliquent pas.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    # ⚠️ Ne concerne QUE les exercices, et la base le garantit :
    # `CHECK (NOT competition OR category = 'exercices')`. Sur une variante ou un
    # tempo, la clé est ABSENTE — pas `false`, qui laisserait croire à un
    # mouvement déclaré non compétitif.
    # ⚠️ `default_factory` et non `default=False` : un `default=` s'inscrit dans
    # le schéma OpenAPI, et `openapi-typescript` en déduit que la clé est TOUJOURS
    # là. C'est faux ici — `exclude_unset` l'omet hors exercices.
    # `default_factory` n'écrit rien dans le schéma.
    competition: bool = Field(default_factory=lambda: False)
    # Les mouvements principaux qu'une entrée de renforcement soutient. Absent
    # quand il n'y en a pas.
    supports: list[str] = Field(default_factory=list)


class BibliothequeLue(BaseModel):
    """Les cinq catégories, TOUJOURS présentes, même vides.

    ⚠️ NOMMÉES plutôt qu'un `dict[str, …]` : la colonne est un ENUM, le
    vocabulaire est clos, et le front type `Record<LibraryCategory, …>`. Un
    contrat de lecture ne promet pas moins que ce qui est garanti.

    ⚠️ En contrepartie, une sixième catégorie ajoutée à l'enum serait JETÉE ici
    en silence. `test_le_modele_couvre_TOUTES_les_categories_du_routeur` compare
    cet ensemble à `_CATEGORIES` : l'ajout fait échouer les tests au lieu de
    vider un écran.

    Aucun champ n'a de défaut : le routeur les initialise tous les cinq. Un
    défaut les rendrait `X | undefined` côté front, pour une absence impossible.
    """

    model_config = ConfigDict(extra="forbid")

    exercices: list[EntreeDeBibliotheque]
    variantes: list[EntreeDeBibliotheque]
    assistances: list[EntreeDeBibliotheque]
    tempos: list[EntreeDeBibliotheque]
    formats: list[EntreeDeBibliotheque]
