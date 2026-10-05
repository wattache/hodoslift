"""Le vocabulaire d'une ligne d'entraînement : la prescription, et ce qui n'en est pas.

Une ligne porte deux natures de champs :

  · la PRESCRIPTION — ce que le coach demande. Elle se copie d'une semaine à l'autre ;
  · le RÉALISÉ — ce que l'athlète a fait. Il ne se copie JAMAIS (FRE-75).

⚠️ Cette liste n'existe qu'ICI. La création et la génération de semaine en
DÉRIVENT : deux listes tenues à la main finissent par différer d'un champ.
"""

from __future__ import annotations

from typing import Any

#: Les champs de prescription, communs aux trois tables de lignes (séance, BASE
#: principes, BASE accessoires).
#:
#: ⚠️ `kind` n'en fait pas partie : c'est un vocabulaire clos protégé par un CHECK,
#: où `''` violerait la contrainte. `valeur_ligne` le traite à part.
CHAMPS_PRESCRIPTION: frozenset[str] = frozenset({
    "name", "variant", "format", "clusterMode", "clusterRest", "tempo", "sets",
    "reps", "repsUnit", "weight", "weightLocked", "assistance", "aimedRPE",
    "rest", "coachNote", "increment", "incrementUnit",
})

#: Ce qu'une génération recopie d'une ligne de BASE vers la ligne produite.
#: DÉRIVÉ de `CHAMPS_PRESCRIPTION` : un champ ajouté là-haut suit ici.
#:
#: ⚠️ `incrementRef` n'y est pas : c'est un champ de calcul du front, sans colonne
#: ni contrat de lecture.
CHAMPS_COPIES: tuple[str, ...] = (*sorted(CHAMPS_PRESCRIPTION), "kind")

#: Les champs qui ne sont pas du texte.
#:
#: ⚠️ Le front envoie `''` pour tout ce qui est vide, booléen et tier compris.
#: Vers une colonne typée, c'est un 500. Le PATCH d'une ligne est protégé par son
#: modèle Pydantic ; les chemins de CRÉATION reçoivent un dictionnaire libre et
#: passent par `valeur_ligne`.
BOOLEENS: frozenset[str] = frozenset({"weightLocked", "unbroken"})
ENTIERS: frozenset[str] = frozenset({"tier"})
VOCABULAIRES: frozenset[str] = frozenset({"repsUnit", "incrementUnit", "kind", "groupKind"})

#: La nature d'un groupe de lignes liées (FRE-36). `None` se LIT « bi-set ».
#:
#: ⚠️ Ce défaut de lecture est un filet, pas une garantie : un groupe sans nature
#: en base est une faute d'écriture. L'invariant `groupe_sans_nature`
#: (`make invariants`) la signale.
#:
#: ⚠️ TOUS LES CHEMINS D'ÉCRITURE LA POSENT, et il en faut DEUX pour couvrir le
#: sujet : `normaliser_groupes` ci-dessous pour les écritures en masse,
#: `propager_la_nature` (`metier_training_lines.py`) pour le grain de la ligne.
#: Tous deux retombent sur cette constante. Tenue d'un seul côté, la règle laisse
#: un groupe nu entrer par l'autre — et le filet de lecture rend alors l'écart
#: invisible au lieu de le signaler.
#:
#: ⚠️ La nature appartient au GROUPE, mais la colonne est par LIGNE : `group_id`
#: se répète d'une semaine à l'autre (la génération le recopie), donc une table de
#: groupes indexée dessus mélangerait les semaines. Contrepartie : deux lignes
#: d'un groupe peuvent se contredire, et c'est le serveur qui tranche
#: (`normaliser_groupes`).
#:
#: Le vocabulaire (`biset`, `dropset`…) vit dans le CHECK SQL et dans
#: `NatureDeGroupe` (`app/socle/schemas_common.py`), pas ici.
NATURE_PAR_DEFAUT: str = "biset"


#: Les clés dont la colonne est `NOT NULL` : `''` y est le seul « rien » que la
#: base accepte, et `NULL` y ferait un 500.
#:
#: ⚠️ Se relève dans le schéma, ne se devine pas : une colonne qui perd son
#: `NOT NULL` sort d'ici, une qui le gagne y entre.
CLES_NON_NULLABLES: frozenset[str] = frozenset({"day"})

#: Les anciennes écritures de « repos libre », traduites en NULL à l'entrée
#: (FRE-169). Le CHECK `rest_sans_sentinelle` interdit de les réécrire.
SENTINELLES_DE_REPOS: frozenset[str] = frozenset({"-1", "Free"})


def vide_vaut_absence(cle: str, v: Any) -> Any:
    """`''` et `NULL` disent la même absence : on n'écrit que `NULL` (FRE-137).

    ⚠️ La lecture (`training_tree._sortie`) retraduit `NULL` en `''` parce que le
    contrat front type ces champs `string`, et le front renvoie l'objet tel qu'il
    l'a reçu. Sans cette fonction à l'écriture, toute ligne touchée perd son
    `NULL`.
    """
    if cle in CLES_NON_NULLABLES:
        return v
    if not isinstance(v, str):
        return v
    # ⚠️ `-1` et `Free` aussi : `ff_num` prendrait `-1` pour un nombre, et la
    # moyenne des repos serait fausse.
    if cle == "rest" and v.strip() in SENTINELLES_DE_REPOS:
        return None
    return None if v.strip() == "" else v


def valeur_ligne(cle: str, v: Any) -> Any:
    """La valeur telle que la colonne l'accepte."""
    if cle in BOOLEENS:
        return v is True or (isinstance(v, str) and v.strip().lower() == "true")
    if cle in ENTIERS:
        return v if isinstance(v, int) and not isinstance(v, bool) else None
    if cle in VOCABULAIRES:
        return v or None          # `''` violerait le CHECK de la colonne
    return vide_vaut_absence(cle, v)


#: Ce que chaque table accepte EN PLUS de la prescription. Un accessoire porte
#: le JOUR où il tombe et pas de tier ; un principe l'inverse (le `daySplit` du
#: bloc le place). Un champ envoyé à la mauvaise table donne un `UndefinedColumn`,
#: donc un 500.
#:
#: ⚠️ AUCUNE de ces tables n'accepte du RÉALISÉ (FRE-75) : une charge réelle vit
#: là où elle a été saisie, et ne s'écrit que par `PATCH /exercises/{id}`. La
#: règle est ici, et pas seulement au front, pour valoir pour tous les appelants.
COLONNES_PAR_TABLE: dict[str, frozenset[str]] = {
    "training_exercises": CHAMPS_PRESCRIPTION | {"tier", "kind", "groupId", "groupKind", "unbroken", "link"},
    # `kind` est commun aux trois : le coach marque un échauffement ou une ligne
    # de kiné dans la trame, et la génération le propage.
    "training_base_principles": CHAMPS_PRESCRIPTION | {"tier", "kind"},
    "training_base_accessories": CHAMPS_PRESCRIPTION | {"day", "groupId", "groupKind", "unbroken", "kind"},
}


def champs_de_groupe(nature: str | None) -> tuple[str, ...]:
    """Les champs qui appartiennent au GROUPE et non à la ligne, selon sa nature.

    Bi-set : A puis B, repos, N fois — séries et repos décrivent le tour.
    Dropset : le même mouvement en descente — son NOM décrit aussi le groupe.

    ⚠️ La liste dépend de la nature : propager le nom sur un bi-set écraserait
    son second mouvement.

    ⚠️ `variant` n'en fait jamais partie, même sur un dropset : la descente d'un
    principal à tempo se fait souvent sans tempo, et c'est le but.

    Le front tient la même liste (`champsDeGroupe`, `lib/groupe.ts`) pour
    l'affichage immédiat ; c'est ici qu'elle vaut pour tous les appelants.
    """
    if nature == "dropset":
        return ("sets", "rest", "name")
    # ⚠️ Un groupe chronométré porte son TEMPS dans `clusterMode` (FRE-116), et
    # seulement ces deux natures : dans un bi-set, deux lignes en AMRAP ont
    # chacune leur durée.
    # EMOM : les séries sont les tours, pas de repos. AMRAP : ni séries ni repos,
    # le nombre de tours est le RÉSULTAT, écrit par l'athlète.
    if nature == "emom":
        return ("sets", "clusterMode")
    if nature == "amrap":
        return ("clusterMode", "toursRealises")
    return ("sets", "rest")


#: Les natures dont le TEMPS appartient au groupe (FRE-116). Leurs lignes ne
#: portent pas de format : il dirait deux temps pour un seul effort.
NATURES_CHRONOMETREES: frozenset[str] = frozenset({"emom", "amrap"})

#: Ce qu'un groupe chronométré retire à ses lignes : le format, et le repos de
#: cluster qui n'existe qu'avec lui. `clusterMode` N'EN EST PAS : il devient le
#: temps du groupe.
FORMAT_DE_LIGNE: tuple[str, ...] = ("format", "clusterRest")


def normaliser_groupes(lignes: list[dict[str, Any]]) -> None:
    """Un groupe, UNE valeur par champ de groupe — tranché par le serveur (FRE-36).

    Modifie `lignes` en place. La première valeur non vide gagne, les autres
    l'adoptent. Un groupe entièrement vide sur un champ le reste.

    ⚠️ Le front tient déjà cette règle à l'écran ; elle est ici pour les lignes
    qui viennent d'ailleurs. Une valeur divergente n'est affichée nulle part
    (l'écran montre le premier membre, « ↑ » sur les suivants) : aucun écran ne la
    corrigerait.

    ⚠️ SAUF LA NATURE (FRE-145) : un groupe sans repos n'a rien à dire, un groupe
    sans nature en a forcément une. Il reçoit `NATURE_PAR_DEFAUT` — l'écrire vaut
    mieux que la deviner à chaque lecture.
    """
    natures: dict[str, str] = {}
    for ligne in lignes:
        gid = (ligne.get("groupId") or "").strip()
        nature = (ligne.get("groupKind") or "").strip()
        if gid and nature and gid not in natures:
            natures[gid] = nature
    # Un groupe dont AUCUN membre ne porte de nature en reçoit celle par défaut.
    for ligne in lignes:
        gid = (ligne.get("groupId") or "").strip()
        if gid and gid not in natures:
            natures[gid] = NATURE_PAR_DEFAUT
    for ligne in lignes:
        gid = (ligne.get("groupId") or "").strip()
        # `None` hors d'un groupe : une ligne seule n'a pas de nature (FRE-137).
        ligne["groupKind"] = natures.get(gid) if gid else None

    # ⚠️ APRÈS la nature : c'est elle qui dit quels champs sont ceux du groupe.
    valeurs: dict[tuple[str, str], Any] = {}
    for ligne in lignes:
        gid = (ligne.get("groupId") or "").strip()
        if not gid:
            continue
        for champ in champs_de_groupe(natures.get(gid)):
            valeur = ligne.get(champ)
            if valeur not in (None, "") and (gid, champ) not in valeurs:
                valeurs[(gid, champ)] = valeur
    for ligne in lignes:
        gid = (ligne.get("groupId") or "").strip()
        if not gid:
            continue
        for champ in champs_de_groupe(natures.get(gid)):
            if (gid, champ) in valeurs:
                ligne[champ] = valeurs[(gid, champ)]
        if natures.get(gid) in NATURES_CHRONOMETREES:
            for champ in FORMAT_DE_LIGNE:
                ligne[champ] = None

    # ⚠️ Un lien UNBROKEN vaut « sans lâcher jusqu'à la SUIVANTE du groupe »
    # (FRE-116) : sur la dernière ligne, ou hors groupe, il s'efface. Sinon un
    # liage futur le ressusciterait.
    derniers: dict[str, int] = {}
    for i, ligne in enumerate(lignes):
        gid = (ligne.get("groupId") or "").strip()
        if gid:
            derniers[gid] = i
    for i, ligne in enumerate(lignes):
        if "unbroken" not in ligne:
            continue
        gid = (ligne.get("groupId") or "").strip()
        ligne["unbroken"] = bool(ligne["unbroken"]) and bool(gid) and derniers.get(gid) != i


#: camelCase du contrat → colonne. EXPLICITE plutôt que calculée : un champ neuf
#: n'entre que si quelqu'un l'a décidé.
COLONNES_LIGNE = {
    "name": "name", "variant": "variant", "kind": "kind", "tier": "tier",
    "format": "format", "clusterMode": "cluster_mode", "clusterRest": "cluster_rest",
    "tempo": "tempo", "sets": "sets", "reps": "reps", "repsUnit": "reps_unit",
    "weight": "weight", "weightLocked": "weight_locked", "assistance": "assistance",
    "aimedRPE": "aimed_rpe", "rest": "rest", "repsDone": "reps_done",
    "weightDone": "weight_done", "restActual": "rest_actual", "feltRPE": "felt_rpe",
    "feltRPEBySet": "felt_rpe_by_set", "repsDoneBySet": "reps_done_by_set",
    "weightDoneBySet": "weight_done_by_set", "toursRealises": "tours_realises",
    "athleteFeedback": "athlete_feedback",
    "coachNote": "coach_note", "link": "link", "groupId": "group_id",
    "groupKind": "group_kind", "unbroken": "unbroken",
    "increment": "increment", "incrementUnit": "increment_unit",
}
