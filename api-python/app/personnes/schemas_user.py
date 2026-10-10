"""Les contrats de l'identité et des rôles d'un utilisateur."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class UserCoachSet(BaseModel):
    """Corps de `PUT /users/{uid}/coach` — promeut ou rétrograde un coach."""

    model_config = ConfigDict(extra="forbid")

    isCoach: bool
    # La structure où il COACHE (FRE-13), choisie par l'admin. Absente = celle
    # qu'il a déjà, ou French Forge pour une promotion : un serveur neuf comprend
    # le contrat d'un écran d'admin sans structures.
    structure: str | None = Field(default=None, max_length=64)


class UserKineSet(BaseModel):
    """Corps de `PUT /users/{uid}/kine` — promeut ou rétrograde un kiné.

    Jumeau volontaire de `UserCoachSet` (FRE-52) : les deux rôles sont la même
    chose, une ligne dans une table d'extension de `users`.

    Un BOOLÉEN et non un `role: str` : « cet utilisateur est-il kiné » est une
    question fermée. Un champ libre inviterait à écrire des rôles que la base ne
    connaît pas, et le refus viendrait du SQL, pas du contrat.
    """

    model_config = ConfigDict(extra="forbid")

    isKine: bool
    # Jumeau de `UserCoachSet.structure` (FRE-13) : la structure où il EXERCE.
    structure: str | None = Field(default=None, max_length=64)


# --------------------------------------------------------------------------- #
# LECTURES (FRE-70) — ce que les routes rendent
#
# ⚠️ Un `response_model` FILTRE la sortie : un champ absent d'ici disparaît de la
# réponse sans erreur. `tests/test_users.py` fige l'ensemble des clés.
# --------------------------------------------------------------------------- #


class StructureDeMoi(BaseModel):
    """Une structure du compte, et ce qu'il y EST (FRE-13).

    Calculé par brokkr (`app/socle/structures.py`) : le front choisit une entrée,
    il ne recompose rien. ⚠️ Une structure est un FILTRE de vue, pas une
    autorisation : ce que chacun ouvre se décide dans `app/socle/authz.py`.
    """

    model_config = ConfigDict(extra="forbid")

    slug: str
    nom: str
    isCoach: bool
    isKine: bool
    # La fiche athlète du compte DANS cette structure, s'il en a une là.
    athleteId: str | None = None


#: Les rendus de la carte « Progression sur le bloc » (brief du 27/09). Le
#: vocabulaire est CLOS ici : le front en engendre le sien, et un rendu retiré
#: fait rougir la compilation au lieu de laisser une préférence orpheline.
RenduProgression = Literal["courbe", "chiffres"]
#: Les langues de l'interface (`web/src/i18n`). La seule chose que brokkr en
#: fait : parler à l'athlète dans la sienne quand c'est lui qui écrit (le push).
Langue = Literal["fr", "en", "pl"]


class Preferences(BaseModel):
    """Les réglages d'affichage de la personne, tels que `users.preferences` les
    porte. UN rendu de la progression, vu partout (William, 28/09) — pas un par
    mode. `None` = le défaut de l'app."""

    model_config = ConfigDict(extra="forbid")

    progression: RenduProgression | None = None
    langue: Langue | None = None


class PreferencesPatch(BaseModel):
    """`PATCH /users/me/preferences` — ce qu'on fournit se pose, le reste tient."""

    model_config = ConfigDict(extra="forbid")

    progression: RenduProgression | None = None
    langue: Langue | None = None


class MoiLu(BaseModel):
    """`GET /users/me` — qui suis-je, et à quels titres. Ouverte à tout compte authentifié.

    Les trois booléens sont ce sur quoi le front branche sa navigation : le rôle
    y est un FAIT, pas une permission. Ce que chacun ouvre se décide côté serveur,
    programme par programme (`app/socle/authz.py`).
    """

    model_config = ConfigDict(extra="forbid")

    uid: str
    email: str
    displayName: str
    isCoach: bool
    isKine: bool
    isAdmin: bool
    # PAS de `programId` : la route ne le rend pas.
    athleteId: str | None = None
    # Les réglages d'affichage de la personne (brief progression, 27/09).
    preferences: Preferences = Field(default_factory=Preferences)
    # ⚠️ PAR STRUCTURE (FRE-13). Les trois booléens et `athleteId` au-dessus sont
    # ceux du compte TOUTES structures confondues. Un même compte peut y être
    # `isCoach` ET porter un `athleteId` ; ici on apprend qu'il est coach dans une
    # structure et athlète dans une autre.
    structures: list[StructureDeMoi]


class UtilisateurLu(BaseModel):
    """`GET /users` — l'annuaire des comptes, réservé à l'admin."""

    model_config = ConfigDict(extra="forbid")

    uid: str
    email: str
    displayName: str
    isCoach: bool
    isKine: bool
    isAdmin: bool
    # OÙ il coache, où il exerce (FRE-13) — le slug, `None` sans le rôle. Une
    # route qui POSE une structure doit pouvoir la relire (cf. `list_users`).
    coachStructure: str | None = None
    kineStructure: str | None = None
    # OÙ il a une fiche athlète (FRE-13) — plusieurs possibles, un compte pouvant
    # s'entraîner dans deux structures. L'écran Admin d'une structure range
    # « sans rôle » ceux qui n'en ont NULLE PART : l'athlète d'une AUTRE
    # structure n'est pas quelqu'un à qui il reste un rôle à donner.
    athleteStructures: list[str] = []
