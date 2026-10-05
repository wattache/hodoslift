"""Schémas du profil coach public (FRE-30).

Le PATCH ne porte que ce que le coach écrit : `one_rm` est une PROJECTION et
`photo_url` est posée par l'endpoint d'upload — aucun des deux n'est patchable.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CoachProfilePatch(BaseModel):
    """Les champs éditables par le coach.

    `extra="forbid"` : un champ inconnu, ou un `one_rm`/`photo_url` glissé ici,
    fait tomber TOUT le payload en 422 — le coach n'écrit pas un champ projeté.
    """

    model_config = ConfigDict(extra="forbid")

    # Clé publique de l'URL. Requise à la CRÉATION, IMMUABLE ensuite (le routeur
    # l'impose) : la changer casserait les liens du site. Slug strict : minuscules,
    # chiffres, tirets — pas d'espace ni d'accent (le front les translittère).
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    accroche: str | None = Field(default=None, max_length=200)
    bio: str | None = Field(default=None, max_length=2000)
    instagram: str | None = Field(default=None, max_length=300)

    # Codes ISO 639-1 ('fr', 'en', 'pl'…). PAS de Literal : ce champ ne pilote QUE
    # de l'affichage, et un Literal obligerait à redéployer brokkr pour ajouter une
    # langue. À l'inverse de `repsUnit`, dont une valeur inattendue fausse un calcul.
    # `max_length` borne le NOMBRE de langues.
    langues: list[str] | None = Field(default=None, max_length=20)

    @field_validator("langues")
    @classmethod
    def _normalise_langues(cls, v: list[str] | None) -> list[str] | None:
        """Minuscules, doublons et entrées vides écartés, ORDRE de saisie préservé.

        Le coach range ses langues par aisance, pas par alphabet :
        ['FR','fr','EN'] → ['fr','en'].

        ⚠️ Une liste vide (ou vidée par ce nettoyage) devient None, donc NULL en
        base : sinon la vitrine afficherait une section « Langues » sans langue.
        """
        if v is None:
            return None
        vus: dict[str, None] = {}
        for code in v:
            propre = code.strip().lower()
            if propre:
                vus.setdefault(propre, None)
        return list(vus) or None


class ProfilCoachLu(BaseModel):
    """La forme COMMUNE aux deux GET (`/me` et `/{slug}`), miroir de `_payload`.

    Un seul modèle, comme il n'y a qu'une fonction de mappage : une divergence de
    nom ou de casse se paierait au front en `undefined` silencieux.

    ⚠️ `langues` est NULLABLE et distinct d'une liste vide : le front n'affiche
    aucune section « Langues » quand c'est `null`.
    """

    model_config = ConfigDict(extra="forbid")

    slug: str
    accroche: str | None = None
    bio: str | None = None
    instagram: str | None = None
    photoUrl: str | None = None
    oneRm: dict[str, Any] | None = None
    langues: list[str] | None = None
