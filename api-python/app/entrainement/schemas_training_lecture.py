"""Les contrats de LECTURE de l'entraînement : l'arbre, la charpente, le contenu d'un bloc.

Six niveaux imbriqués — macro, bloc, BASE, semaine, séance, ligne (FRE-70).

⚠️ Un `response_model` FILTRE, à n'importe quelle profondeur : un champ absent d'ici
disparaît de la réponse sans erreur ni journal.
`test_l_arbre_porte_TOUS_ses_champs_a_TOUS_ses_niveaux` fige les clés de chaque étage.

⚠️ Rien n'est omis et rien n'a de défaut : `training_tree` pose toujours toutes les
clés. Un champ optionnel deviendrait `X | undefined` côté front, qui devrait se
défendre d'une absence impossible.

⚠️ ET PRESQUE RIEN N'EST NULLABLE, ce qui surprend au premier coup d'œil. C'est
`_txt` et `_sortie` qui le garantissent : ils remplacent NULL par `''` sur tout ce
que le contrat front type `string`. La raison est ancienne et coûteuse — un champ
React contrôlé qui reçoit `value={null}` bascule en non contrôlé et la saisie casse
(défaut du 2026-08-15). Les rares exceptions gardent leur NULL parce qu'il y a un
sens : `tier` absent veut dire « pas un principal », `kind` absent « entraînement ».
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.socle.schemas_common import NatureDeGroupe


class _LigneCommune(BaseModel):
    """Ce que TOUTE ligne de prescription porte — en séance comme dans la BASE.

    Les deux mappages (`_EXERCICE_SORTIE`, `_BASE_SORTIE`) partagent ce socle ;
    l'écrire une fois évite qu'ils divergent sur un champ commun.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str | None
    # LISTE TOUJOURS, jamais `null` : une ligne sans variante est la norme, et
    # l'écran d'édition tombe sur `null`.
    variant: list[str]
    # NULL a un SENS ici — « entraînement » — et `''` serait hors du vocabulaire.
    kind: Literal["training", "warmup", "rehab"] | None
    format: str | None
    clusterMode: str | None
    clusterRest: str | None
    tempo: str | None
    sets: str | None
    reps: str | None
    # ⚠️ LE VOCABULAIRE CLOS **PLUS** LA CHAÎNE VIDE, et les deux comptent.
    #
    # La colonne est contrainte (`CHECK reps_unit IN ('count','sec')`) mais
    # NULLABLE, et `_txt` transforme ce NULL en `''` — soit 3 157 lignes de
    # production sur 13 312. Le contrat écrit à la main côté front annonçait
    # pourtant `'count' | 'sec'` tout court : il MENTAIT sur un tiers des lignes,
    # et le type ne pouvait pas le dire puisque personne ne l'avait rapproché de
    # la donnée. C'est le défaut le plus récurrent du projet — `''` et NULL
    # confondus à une frontière — cette fois pris du côté du type.
    #
    # Laisser `str` aurait été honnête mais imprécis : le front y perdait le
    # vocabulaire qu'il connaissait déjà. Un contrat de LECTURE ne doit jamais
    # promettre moins que l'écriture ne garantit.
    repsUnit: Literal["count", "sec"] | None
    # Des CHAÎNES : un coach écrit « 47,5 » ou « PDC ». Le nombre se dérive à
    # l'affichage, il n'est pas la donnée.
    weight: str | None
    weightLocked: bool
    assistance: str | None
    aimedRPE: str | None
    rest: str | None
    coachNote: str | None
    increment: str | None
    # Même règle que `repsUnit` : CHECK en base, colonne nullable, `_txt` rend
    # `''` — 713 lignes. Le `%` figure au vocabulaire et n'a JAMAIS été employé
    # (0 sur 13 312), mais il reste ici parce que la colonne l'autorise : le
    # contrat décrit ce qui PEUT arriver, pas ce qui est arrivé.
    incrementUnit: Literal["kg", "reps", "rpe", "sets"] | None


class LigneDeSeance(_LigneCommune):
    """Une ligne d'exercice DANS une séance : la prescription et son réalisé."""

    tier: int | None
    groupId: str | None
    # ⚠️ RÉSOLUE PAR LE SERVEUR, jamais brute (FRE-36) : `''` hors groupe,
    # « biset » par défaut dans un groupe. Le front ne connaît donc pas la
    # convention « NULL vaut bi-set » — la connaître en ferait une seconde
    # définition de la nature, et deux définitions divergent toujours.
    groupKind: NatureDeGroupe | None
    #: Sans lâcher la barre jusqu'à la ligne SUIVANTE du groupe (FRE-116).
    unbroken: bool
    repsDone: str | None
    weightDone: str | None
    restActual: str | None
    feltRPE: str | None
    # Le RPE série par série. Même règle que `variant` : liste toujours présente.
    feltRPEBySet: list[str]
    # Les répétitions et la charge série par série. Même règle, et même ordre :
    # la position i de ces trois tableaux décrit la MÊME série.
    repsDoneBySet: list[str]
    weightDoneBySet: list[str]
    #: Les tours bouclés d'un AMRAP de groupe (FRE-116). `None` hors AMRAP comme
    #: tant que rien n'est noté.
    toursRealises: int | None
    athleteFeedback: str | None
    link: str | None
    # MÉCANOTRANSDUCTION (FRE-103) — le temps sous tension d'une série, en
    # secondes : somme des chiffres du tempo × répétitions effectives.
    #
    # ⚠️ DÉRIVÉ, jamais saisi : pas de colonne `mechano` sur `training_exercises`.
    # `ff_mechano` le recalcule à chaque lecture — la MÊME fonction qui remplit
    # `training_sets.mechano`.
    #
    # ⚠️ `None` dans trois cas, et aucun ne se replie sur `0` : la ligne n'est pas
    # « Kiné », le tempo n'est pas un rythme chiffré (« 1CT PAUSE »), ou les
    # répétitions sont des secondes. Un tempo tout explosif (« XXX ») vaut bien
    # `0` — un temps sous tension nul, qui doit s'afficher.
    mechano: float | None


class PrincipeDeBase(_LigneCommune):
    """Un PRINCIPE de la trame : un `tier`, et PAS de jour.

    Sa place dans la semaine vient de la grille du bloc (`daySplit`).

    ⚠️ `tier` est NON NULLABLE ici, contrairement à la ligne de séance : la colonne
    est `NOT NULL`. `int | None` obligerait le front à se défendre d'un cas
    impossible.
    """

    tier: Literal[1, 2, 3]


class AccessoireDeBase(_LigneCommune):
    """Un ACCESSOIRE de la trame : un `day` et un `groupId`, et PAS de tier.

    Il tombe un jour donné et peut entrer dans un groupe.

    ⚠️ Deux modèles, et pas un seul aux champs optionnels : sinon un principe
    accepterait un `day` sans que rien ne proteste.
    `test_principes_et_accessoires_n_ont_PAS_les_memes_champs` le fige.
    """

    day: str
    groupId: str | None
    #: Voir `LigneDeSeance.groupKind` — même règle, même résolution serveur.
    groupKind: NatureDeGroupe | None
    #: Voir `LigneDeSeance.unbroken`.
    unbroken: bool


class JourDeLaGrille(BaseModel):
    """Un jour du cycle : quels TIERS y tombent, et comment le coach l'appelle.

    ⚠️ `day` IDENTIFIE, `label` NOMME. `day` (`J1` … `Jn`) rattache les accessoires
    par égalité de chaîne, donne le rang du cycle et entre dans l'identifiant des
    groupes engendrés : il n'est pas modifiable par le coach. `label` est libre et
    n'a aucun rôle structurel — il nomme les séances engendrées, rien d'autre.

    `None` quand le coach n'a rien saisi ; la séance prend alors son `J<n>`.
    """

    model_config = ConfigDict(extra="forbid")

    day: str
    label: str | None = None
    tiers: dict[str, int]


class BaseDuBloc(BaseModel):
    """La TRAME d'un bloc : ce qui engendre les semaines."""

    model_config = ConfigDict(extra="forbid")

    # Objets LIBRES : la grille de jours et la granularité sont des formes que le
    # front compose et relit sans que le serveur ait à les connaître.
    daySplit: list[JourDeLaGrille]
    principles: list[PrincipeDeBase]
    accessories: list[AccessoireDeBase]
    # ⚠️ Le SEUL champ où `null` et `[]` ne disent pas la même chose
    # (cf. `training_tree._sortie_base`). `null` = le coach n'a jamais configuré
    # sa sélection, et le front retombe sur l'ordre canonique de la bibliothèque ;
    # `[]` = il a retiré les mouvements un par un, geste délibéré.
    selectedPrincipaux: list[str] | None
    granularity: dict[str, str]
    s1StartDate: str | None
    s1EndDate: str | None


class ObjectifDeBloc(BaseModel):
    """Un objectif chiffré, affiché sur le tableau de bord de l'athlète.

    Toutes ses colonnes sont nullables en base et sortent pourtant en `''` : c'est
    un TABLEAU ÉDITABLE, et un champ contrôlé qui reçoit `null` casse la saisie."""

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
    # ⚠️ NULLABLE, seul de ce modèle. Le commentaire ci-dessus explique pourquoi
    # tout le reste sort en `''` — un champ contrôlé qui reçoit `null` casse la
    # saisie. Celui-ci n'est pas saisi : c'est une coche, et « pas atteint » n'a
    # pas de date.
    atteintLe: str | None = None


class AthleteDeLaSemaine(BaseModel):
    """L'athlète TEL QU'IL ÉTAIT cette semaine-là.

    Le poids et la taille sont des mesures DATÉES — celles de cette semaine, pas
    celles d'aujourd'hui. Le nom, lui, vient de la fiche et suit les renommages."""

    model_config = ConfigDict(extra="forbid")

    firstName: str
    lastName: str
    weight: float | None
    height: float | None


class SeanceLue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    sessionDate: str | None
    # ⚠️ UN ENTIER OU UNE CHAÎNE VIDE, et pas `int | None`. Le front distingue
    # « pas de forme saisie » d'une note de 0, et son type l'écrit ainsi depuis
    # toujours. Servir `null` obligerait à le changer pour rien.
    formOfTheDay: int | None
    exercises: list[LigneDeSeance]
    lignesSansRessenti: int = Field(
        description="Lignes où du travail est NOTÉ (reps ou charge réelles) sans aucun "
                    "ressenti — invisibles au suivi et aux records (FRE-160). "
                    "Compté par le serveur, avec la règle de `records.py`.")


class SemaineLue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    weekNumber: int
    name: str | None
    hidden: bool
    startDate: str | None
    endDate: str | None
    athlete: AthleteDeLaSemaine
    sessions: list[SeanceLue]


class BlocLu(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    blockNumber: int
    name: str | None
    startDate: str | None
    endDate: str | None
    base: BaseDuBloc
    # Jamais absent, même vide : le front lit la clé sans la tester.
    objectives: list[ObjectifDeBloc]
    # La version que `PUT …/objectives` exige (FRE-163) : l'empreinte de la liste
    # ci-dessus. Sans elle, un onglet resté ouvert renvoie sa liste périmée et
    # efface la coche posée entre-temps ailleurs.
    objectivesVersion: str
    weeks: list[SemaineLue]


class MacroLu(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    macroNumber: int
    name: str | None
    # ⚠️ CES DEUX-LÀ RESTENT NULLABLES, à la différence de tous les autres champs
    # texte de l'arbre : le contrat front les type explicitement `| null`, et
    # `read_tree` ne leur applique pas `_txt`. Les aligner sur `''` par souci de
    # symétrie changerait le format sur le fil.
    trainingFrequency: int | None
    coachNotes: str | None
    blocks: list[BlocLu]


class SemaineDeStructure(BaseModel):
    """Une semaine SANS son contenu (FRE-119).

    ⚠️ `sessionCount` et non `sessions` : la barre du programme éteint la
    pastille d'une semaine vide, elle a besoin du COMPTE, pas des séances.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    weekNumber: int
    name: str | None
    hidden: bool
    startDate: str | None
    endDate: str | None
    athlete: AthleteDeLaSemaine
    sessionCount: int


class BlocDeStructure(BaseModel):
    """Un bloc sans sa BASE ni ses semaines détaillées.

    ⚠️ La BASE est absente : elle multiplierait le poids de la réponse pour une
    donnée que seul le coach lit. `hasBase` dit si elle existe ; son contenu est
    dans `ContenuDeBloc`.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    blockNumber: int
    name: str | None
    startDate: str | None
    endDate: str | None
    objectives: list[ObjectifDeBloc]
    # Voir `BlocLu.objectivesVersion`.
    objectivesVersion: str
    # ⚠️ Un BOOLÉEN, pas la trame : le menu « dupliquer la trame d'un autre bloc »
    # a besoin de savoir lesquels en portent une, pas de les recevoir. Le contenu
    # du bloc choisi se demande au moment du geste. C'est le serveur qui DÉFINIT
    # « avoir une trame » (`training_tree._BLOCS_AVEC_BASE`).
    hasBase: bool
    weeks: list[SemaineDeStructure]


class MacroDeStructure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    macroNumber: int
    name: str | None
    trainingFrequency: int | None
    coachNotes: str | None
    blocks: list[BlocDeStructure]


class StructureLue(BaseModel):
    """La charpente du programme : de quoi naviguer et dessiner la frise.

    ⚠️ Elle ne remplace pas `ArbreLu` : elle sert les écrans qui n'ont pas besoin
    du contenu (FRE-119). Le contenu se lit PAR BLOC (`ContenuDeBloc`) — pas par
    un champ de plus ici.
    """

    model_config = ConfigDict(extra="forbid")

    macros: list[MacroDeStructure] = Field(description="Ordonnés par numéro, comme tous les niveaux")


class SemaineDeContenu(BaseModel):
    """Les séances d'une semaine, et RIEN d'autre (FRE-119).

    ⚠️ Pas de numéro, pas de dates, pas d'athlète — volontairement. La charpente
    (`SemaineDeStructure`) les porte déjà ; une seconde source obligerait le
    front à choisir laquelle croire quand l'une est fraîche et l'autre en cache.
    L'identifiant suffit à recoller les deux lectures.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    sessions: list[SeanceLue]


class ContenuDeBloc(BaseModel):
    """Ce qu'il faut AJOUTER à la charpente pour éditer un bloc (FRE-119).

    L'écran d'entraînement lit la charpente une fois, puis le contenu du bloc
    regardé : un volume qui ne croît pas avec l'historique.

    ⚠️ La BASE est ICI, pas dans la charpente : seul le coach la lit, et seulement
    sur le bloc qu'il édite.
    """

    model_config = ConfigDict(extra="forbid")

    base: BaseDuBloc
    weeks: list[SemaineDeContenu]


class ArbreLu(BaseModel):
    """La réponse entière de l'arbre.

    Un seul champ, et c'est voulu : le jour où l'arbre porte autre chose (un
    curseur, une date de calcul), la place existe.
    """

    model_config = ConfigDict(extra="forbid")

    macros: list[MacroLu] = Field(description="Ordonnés par numéro, comme tous les niveaux")
