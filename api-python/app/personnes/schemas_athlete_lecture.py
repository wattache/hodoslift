"""Ce que les routes de LECTURE d'athlètes rendent (FRE-70).

Séparé de `schemas_athlete_profile.py`, qui porte les contrats d'ÉCRITURE : un
champ écrit n'est pas un champ lu (l'écriture refuse `programId`, la lecture le rend).

⚠️ UN `response_model` FILTRE LA SORTIE. Un champ absent d'ici disparaît de la
réponse SANS erreur ni journal : le front reçoit `undefined`. D'où
`test_AthletePublic_porte_TOUS_ses_champs`, qui fige l'ensemble exact des clés, et
`test_mine_partage_le_mapping_PUBLIC`, qui fige le delta entre les deux vues.

LA FRONTIÈRE PUBLIC / PII est portée par l'HÉRITAGE, pas par une liste répétée :
`AthleteMine` étend `AthletePublic`, et ses champs propres sont tout ce qui les
distingue — l'email, le compte lié, et des faits de santé ou de relation.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class UnRM(BaseModel):
    """Les 1RM par mouvement, en kg.

    Les MÊMES clés que le contrat d'écriture (`OneRMPatch`), et pas un objet
    libre : une lecture ne promet jamais moins qu'une écriture, sinon le front doit
    défendre son type contre des clés que le serveur n'accepte pas.

    ⚠️ Un mouvement non renseigné est une clé ABSENTE, pas un `null` ni un zéro.
    Les routes portent `response_model_exclude_unset=True` à cause de ce modèle :
    sans lui, un athlète qui n'a qu'un squat verrait sortir les autres à `null`.
    """

    model_config = ConfigDict(extra="forbid")

    muscleUp: float | None = None
    pullUp: float | None = None
    chinUp: float | None = None
    dip: float | None = None
    squat: float | None = None
    benchPress: float | None = None
    deadlift: float | None = None


class AthletePublic(BaseModel):
    """Un athlète SANS PII de compte : ni email, ni compte lié, ni kiné.

    Rendu par `GET /athletes/suivis` (les athlètes que suit le kiné appelant), et
    socle de `AthleteMine`. `height` et `weight` absents sont `null`, jamais zéro.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(description="`athletes.legacy_id` — l'id que le front manipule")
    firstName: str
    lastName: str
    # Les mêmes valeurs que la colonne (un enum Postgres) et que le contrat
    # d'écriture.
    gender: Literal["M", "F"] | None = None
    height: float | None = None
    weight: float | None = None
    # ⚠️ CALCULÉ À LA LECTURE depuis `birthDate` (FRE-168), jamais stocké : l'écran
    # affiche « 27 ans » sans rien savoir du calcul. Sort aussi pour le kiné.
    age: int | None = None

    # ⚠️ SERVI, pas calculé par le navigateur (FRE-92). Le meilleur RIS de
    # l'athlète, celui d'une COMPÉTITION — un RIS exige un total et un poids
    # obtenus ENSEMBLE, ce que seule une participation garantit.
    #
    # `default=None` et non « toujours envoyé » : sans compétition,
    # `response_model_exclude_unset` retire la clé — l'écran affiche « — », pas
    # un zéro.
    ris: float | None = None
    # ⚠️ PAS `score` : quatre places, dont une disputée entre pull up et chin up.
    risTotal: float | None = None
    # Le poids POUR LEQUEL ce RIS vaut. L'écart avec le poids actuel est une
    # information, pas une erreur à corriger en recalculant.
    risBodyweight: float | None = None
    risCompetition: str | None = None
    risDate: str | None = None
    coachId: str | None = None
    programId: str | None = Field(
        default=None, description="Par où le front navigue vers l'entraînement")
    # OBLIGATOIRE et sans défaut : le mappage la pose toujours (`_one_rm` rend `{}`
    # quand la colonne est nulle). Un défaut la rendrait optionnelle dans le
    # contrat, et le front devrait alors se défendre d'une absence impossible.
    currentOneRM: UnRM


class AthleteMine(AthletePublic):
    """`GET /athletes/mine` — mes athlètes, AVEC la PII de compte.

    ⚠️ `kineUid` sort ICI et PAS dans `AthletePublic`. « Cet athlète est suivi par
    un kiné » est une information de santé : elle appartient à l'athlète, à son
    coach et à un admin.
    """

    email: str | None = None
    linkedUserId: str | None = None
    kineUid: str | None = None
    # ⚠️ ARCHIVÉ (FRE-127) — la DATE, pas un booléen, et servie plutôt que
    # filtrée. C'est l'écran qui décide : la barre latérale masque, un « voir les
    # archivés » rappelle, et une compétition passée continue de nommer l'athlète.
    #
    # ⚠️ Elle sort ICI, pas dans `AthletePublic` : « cet athlète a suspendu son
    # coaching » est un fait de la relation coach-athlète, comme `kineUid`.
    archiveLe: str | None = None
    # ⚠️ LA DATE DE NAISSANCE SORT ICI, PAS DANS LES SUIVIS D'UN KINÉ (FRE-168).
    # Plus intime qu'un âge ; `AthletePublic` ne porte que l'âge qui s'en déduit.
    # `None` et non `''` : une absence n'est pas une chaîne.
    birthDate: str | None = None
    # ⚠️ L'ACCÈS SUPPORT EN COURS DE L'APPELANT (FRE-202), et sa FIN. Présent, il
    # dit au front que l'appelant a sur cette fiche les droits du coach et du
    # kiné : c'est le serveur qui décide, l'écran suit.
    supportJusquAu: str | None = None


class AthleteAnnuaire(BaseModel):
    """`GET /athletes/annuaire` — une fiche vue par l'admin (FRE-190).

    Les sept champs que l'écran Admin lit, et rien d'autre : ni programme ni
    mesure, qu'aucun droit ne lui ouvre sur une fiche qu'il ne coache pas.
    """

    id: str = Field(description="`athletes.legacy_id` — l'id que le front manipule")
    firstName: str
    lastName: str
    email: str | None = None
    linkedUserId: str | None = None
    coachId: str | None = None
    kineUid: str | None = None
    # Mon accès support en cours sur cette fiche, et sa fin (FRE-202).
    supportJusquAu: str | None = None
