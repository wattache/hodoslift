"""Ce que les ÉCRITURES rendent (FRE-70).

⚠️ CE FICHIER DÉCRIT, IL N'HARMONISE PAS : les modèles rendent FIDÈLEMENT ce qui
circule, irrégularités comprises. Les deux plus visibles : `AthleteCree` et
`EntreeCreee` ne portent pas de `ok` ; `ObjectifEcrit` est nullable là où la
lecture des mêmes objectifs rend `''`. Uniformiser est une décision produit.

⚠️ CES RÉPONSES SONT LUES : les identités que les créations renvoient rendent une
ligne éditable avant le prochain rechargement. Une clé perdue ici ne casse pas
un écran : elle fait taire une écriture.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Confirmation(BaseModel):
    """Le socle : « c'est fait ».

    ⚠️ `Literal[True]` et non `bool` : la route ne rend JAMAIS `ok: false`, un
    échec passe par une erreur HTTP. Tester `if (res.ok)` serait une branche morte.
    """

    model_config = ConfigDict(extra="forbid")

    ok: Literal[True]


class ChampsEcrits(Confirmation):
    """Les PATCH partiels : ce qui a réellement été écrit.

    Le client envoie un patch, le serveur dit ce qu'il en a retenu. La liste est
    triée, donc stable d'un appel à l'autre.
    """

    written: list[str]


class CompetitionEcrite(ChampsEcrits):
    """Le PATCH d'une compétition rend sa NOUVELLE version (FRE-162).

    C'est celle que la prochaine écriture doit présenter : sans elle, un plateau
    qui enregistre deux fois de suite se refuse lui-même la seconde
    (`competition_perimee`).
    """

    version: str


class ObjetCree(Confirmation):
    """Une création qui rend l'identité frappée par le serveur."""

    id: str


class ObjetSupprime(Confirmation):
    deleted: str


class ContenuRealise(BaseModel):
    """Ce qu'une suppression détruirait de RÉALISÉ (FRE-130).

    ⚠️ Deux nombres, et c'est `seances` qui parle à l'écran : un coach compte en
    séances ce qu'il s'apprête à effacer. `lignes` sert le journal d'audit.

    ⚠️ Ce n'est PAS un verrou : la suppression reste permise. Cette lecture remplit
    la phrase du dialogue de confirmation.
    """

    model_config = ConfigDict(extra="forbid")

    lignes: int
    seances: int


class Denombrement(Confirmation):
    """Un remplacement en bloc : combien d'éléments composent le nouvel état.

    ⚠️ Pas « combien ont changé » : la route remplace tout, `count` décrit ce qui
    existe APRÈS, pas un delta.
    """

    count: int


# --------------------------------------------------------------------------- #
# L'ARBRE DES IDENTITÉS — la réponse la plus délicate du projet
# --------------------------------------------------------------------------- #


class IdsDeSeance(BaseModel):
    """Les identités d'une séance créée et de ses lignes.

    ⚠️ `exercises` A LA MÊME LONGUEUR QUE LA LISTE REÇUE, avec `null` là où le
    serveur a ÉCARTÉ une ligne sans nom (un résidu d'édition n'entre pas en base).
    Une liste raccourcie ferait glisser l'identité de la ligne suivante sur la
    précédente, et chaque frappe du coach écrirait sur le mauvais exercice.

    Le `null` porte du sens : ne jamais le filtrer.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    exercises: list[str | None]


class IdsCrees(BaseModel):
    """L'arbre des identités que vient de frapper une création.

    ⚠️ TOUTES LES CLÉS SONT CONDITIONNELLES, d'où `response_model_exclude_unset`
    sur les routes qui rendent ceci. Ce qui remonte dépend de ce qui a été créé :

    * `POST /macros` avec un bloc et une semaine nichés → les quatre ;
    * `POST /macros/{id}/blocks` → `block`, plus `week` et `sessions` si le
      payload nichait une semaine ;
    * `POST /blocks/{id}/weeks` → `week` et `sessions`.

    L'imbrication rend la création ATOMIQUE : trois appels laisseraient un arbre
    à moitié construit si le deuxième échouait.
    """

    model_config = ConfigDict(extra="forbid")

    # ⚠️ `default_factory`, ni `default=None` ni `| None`. Ces clés sont ABSENTES
    # quand l'objet n'a pas été créé — jamais nulles. `str | None` mettrait un
    # `| null` dans le contrat généré ; un `default=` s'inscrit dans l'OpenAPI, et
    # `openapi-typescript` en déduit que la clé est TOUJOURS là. `default_factory`
    # garde le type exact et la clé optionnelle.
    macro: str = Field(default_factory=str)
    block: str = Field(default_factory=str)
    week: str = Field(default_factory=str)
    sessions: list[IdsDeSeance] = Field(default_factory=list)


class ArbreCree(Confirmation):
    ids: IdsCrees


# --------------------------------------------------------------------------- #
# LES FORMES PARTICULIÈRES — une par route, et c'est le sujet
# --------------------------------------------------------------------------- #


class AthleteCree(BaseModel):
    """`POST /athletes` — la fiche créée, et le programme créé avec elle.

    ⚠️ PAS DE `ok` ICI, contrairement aux autres écritures : l'irrégularité est
    décrite, pas corrigée — l'ajouter changerait la réponse de la route.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    programId: str


class LiaisonAthlete(BaseModel):
    """`POST /athletes/link` — rattacher un compte à une fiche athlète.

    ⚠️ `linked: false` EST UN SUCCÈS, pas une erreur — d'où l'absence de
    `Confirmation` : ce booléen porte un résultat, `ok` un accusé de réception.

    ⚠️ `motif` distingue les DEUX `linked: false` (FRE-76), qui n'appellent pas
    la même phrase à l'écran :

    * `aucune_fiche` — personne ne porte cette adresse : l'utilisateur n'est pas
      athlète, ou son coach ne l'a pas encore enregistré ;
    * `fiche_deja_liee` — une fiche la porte, mais rattachée à un AUTRE uid
      (compte Google recréé, second compte). Le coach a fait son travail, et
      aucun geste de la personne n'y change rien.

    `motif` vaut `null` quand le rattachement a eu lieu.
    """

    model_config = ConfigDict(extra="forbid")

    linked: bool
    athleteId: str | None
    motif: Literal["aucune_fiche", "fiche_deja_liee"] | None = None


# ⚠️ Pas de forme pour ROMPRE une liaison, et ce n'est pas un oubli (FRE-131) :
# détacher un compte d'une fiche est l'étape 0 d'une prise de contrôle par le
# coach. La route n'existe pas ; ne pas la recréer.


class CoachAffecte(Confirmation):
    """Les programmes touchés par le changement de coach.

    Un athlète peut en avoir plusieurs, et l'affectation les suit tous.
    """

    programIds: list[str]


class AthleteArchive(Confirmation):
    """`null` quand l'athlète est RÉACTIVÉ : c'est le nouvel état, pas une absence."""

    archiveLe: str | None


class KineAffecte(Confirmation):
    """`null` quand le kiné est RETIRÉ : c'est le nouvel état, pas une absence."""

    kineUid: str | None


class ProfilCoachEcrit(Confirmation):
    """Le slug est rendu parce que le serveur peut le DÉRIVER du nom.

    Le client ne le connaît pas forcément avant d'écrire.
    """

    slug: str


class PhotoCoachEcrite(Confirmation):
    photoUrl: str


class EntreeCreee(BaseModel):
    """⚠️ PAS DE `ok`, comme `AthleteCree`. Voir là-bas."""

    model_config = ConfigDict(extra="forbid")

    id: str


class LigneSupprimee(Confirmation):
    """La suppression d'une ligne, et l'effet de bord que dit `groupesNettoyes`.

    Supprimer un membre d'un groupe peut laisser son partenaire SEUL — un lien
    qui ne relie plus rien (FRE-31). Le serveur délie ces orphelins dans la même
    transaction et dit COMBIEN, pour que le client n'ait pas à relire l'arbre.

    ⚠️ UN NOMBRE, malgré son nom au pluriel : le nombre de lignes déliées, pas la
    liste des groupes concernés.
    """

    groupesNettoyes: int


class ObjectifEcrit(BaseModel):
    """Un objectif tel qu'il ressort de son écriture.

    ⚠️ NULLABLE ICI, ALORS QUE LA LECTURE REND `''`. Ces valeurs sont celles que le
    CLIENT vient d'envoyer, réémises telles quelles ; la lecture (`ObjectifDeBloc`)
    remplace NULL par `''`. Deux formes pour la même donnée, selon qu'on vient de
    l'écrire ou qu'on la relit : une irrégularité décrite, pas masquée.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    exercise: str | None
    variant: str | None
    format: str | None
    sets: str | None
    reps: str | None
    weightMin: str | None
    weightMax: str | None
    assistance: str | None
    # ⚠️ Le seul champ dont les deux formes COÏNCIDENT : `atteintLe` est nullable à
    # la lecture aussi — « pas atteint » est une absence de date, pas une date vide.
    atteintLe: str | None = None


class ObjectifsRemplaces(Denombrement):
    objectives: list[ObjectifEcrit]
    # La version de la liste APRÈS l'écriture : la prochaine écriture du même
    # client l'exige, sans attendre une relecture (FRE-163).
    version: str


class RoleCoachEcrit(Confirmation):
    isCoach: bool


class RoleKineEcrit(Confirmation):
    isKine: bool


class AccesSupportEcrit(Confirmation):
    """La fin de l'accès support en cours (FRE-202) ; `None` quand il vient d'être fermé."""
    supportJusquAu: str | None
