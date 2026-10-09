"""Les trois lectures de l'entraînement : l'arbre, la charpente, le contenu d'un bloc.

Une requête à plat par niveau, recomposées en mémoire : une seule jointure de la
racine aux exercices multiplierait chaque ligne parente par ses enfants.

Les trois lectures partagent leurs projections (`_sortie`, `_sortie_seance`,
`_sortie_base`, `_sortie_objectif`) et leur filtre de masquage (`_visibles`).

Une séance est identifiée par son `id` (uuid) ; `legacy_id` ne sert qu'à l'ordre
et ne sort pas de l'API. `athlete` recompose prénom et nom par jointure ; le
poids et la taille, mesures datées, vivent sur la semaine.
"""

from uuid import UUID

from sqlalchemy import text

from app.socle.empreinte import empreinte
from app.entrainement.prescription import NATURE_PAR_DEFAUT
from app.entrainement.records import travail_note_sans_ressenti


def _visibles(semaines, voit_les_masquees: bool):
    """Les semaines que ce lecteur-là a le droit de recevoir (FRE-158).

    ⚠️ Le masquage se fait ICI, pas au front : une semaine masquée servie est une
    semaine affichée. Une seule définition pour les trois lectures — l'arbre, la
    charpente et le contenu d'un bloc.

    ⚠️ La question est « programme-t-il ? », pas « est-ce l'athlète ? » (FRE-142) :
    un coach est souvent AUSSI athlète, et une garde sur le rôle lui cacherait ce
    qu'il vient lui-même de masquer — il ne pourrait plus le démasquer.
    """
    return semaines if voit_les_masquees else [w for w in semaines if not w["hidden"]]


def _blocs_visibles(blocs_du_macro, semaines, voit_les_masquees):
    """Les blocs qui ont encore quelque chose à montrer à ce lecteur (FRE-158).

    ⚠️ Un bloc dont TOUTES les semaines sont masquées ne sort pas — et ses
    objectifs partent avec lui : le tableau de bord de l'athlète lit
    `block.objectives` sur la charpente, et afficherait ceux d'un bloc caché.

    Un bloc réellement SANS semaine tombe par la même porte, et c'est voulu : un
    bloc neuf naît sans semaine, le coach le compose, l'athlète n'a rien à y voir.

    Qui programme garde tout : le bloc en construction vit chez lui, et c'est lui
    qui démasque.
    """
    if voit_les_masquees:
        return list(blocs_du_macro)
    return [b for b in blocs_du_macro if _visibles(semaines.get(str(b["id"]), []), False)]

def _bornes(semaines: list) -> dict:
    """Un bloc s'étend sur ses SEMAINES : de la première datée à la dernière.

    ⚠️ UNE SEULE DÉFINITION, CALCULÉE ICI. `training_blocks.start_date` et
    `end_date` existent encore en colonnes, mais rien ne les lit : elles ont
    porté une seconde définition de la même période, et elle a divergé — un bloc
    borné à sa seule S1 laissait un trou d'un mois dans la frise. Une semaine
    masquée compte : elle occupe le temps qu'elle occupe. Sans semaine datée, le
    bloc n'a pas de période, et le rend : `''` des deux côtés."""
    debuts = [w["start_date"] for w in semaines if w["start_date"]]
    fins = [w["end_date"] for w in semaines if w["end_date"]]
    return {"startDate": _iso(min(debuts)) if debuts else "",
            "endDate": _iso(max(fins)) if fins else ""}


_MACROS = text("""
    SELECT id, legacy_id, number, name, training_frequency, coach_notes
    FROM training_macros WHERE program_id = :pid ORDER BY number, legacy_id
""")

_BLOCS = text("""
    SELECT b.id, b.macro_id, b.number, b.name,
           b.day_split, b.selected_principals, b.granularity,
           b.s1_start_date, b.s1_end_date
    FROM training_blocks b
    JOIN training_macros m ON m.id = b.macro_id
    WHERE m.program_id = :pid ORDER BY b.number, b.legacy_id
""")

_SEMAINES = text("""
    SELECT w.id, w.block_id, w.number, w.name, w.hidden, w.start_date, w.end_date,
           w.athlete_weight_kg, w.athlete_height_cm
    FROM training_weeks w
    JOIN training_blocks b ON b.id = w.block_id
    JOIN training_macros m ON m.id = b.macro_id
    WHERE m.program_id = :pid ORDER BY w.number, w.legacy_id
""")

_SEANCES = text("""
    SELECT s.id, s.week_id, s.position, s.name, s.session_date, s.form_of_the_day
    FROM training_sessions s
    JOIN training_weeks w ON w.id = s.week_id
    JOIN training_blocks b ON b.id = w.block_id
    JOIN training_macros m ON m.id = b.macro_id
    WHERE m.program_id = :pid ORDER BY s.position
""")

# `e.*` volontairement : énumérer les colonnes ferait disparaître sans erreur un
# champ ajouté et oublié ici. C'est `_EXERCICE_SORTIE`, plus bas, qui dit ce qui
# sort : elle est le CONTRAT.
#
# Une seule requête, deux PORTÉES (le programme, un bloc — FRE-119) : deux copies
# du calcul de `mechano` divergeraient au premier ajustement de la formule
# (FRE-103). Seul le fragment de portée change.
def _exercices(portee: str):
    return text(f"""
    SELECT e.*,
           -- MÉCANOTRANSDUCTION (FRE-103) : dérivé, pas stocké sur la ligne.
           --
           -- ⚠️ C'EST CETTE LIGNE QUI REND L'OPÉRATION UTILE. Le score est aussi
           -- projeté dans `training_sets` pour l'analytique, mais le front rend
           -- l'ARBRE, pas la projection : sans ce calcul-ci, il aurait gardé sa
           -- propre implémentation et on se serait retrouvé avec DEUX formules —
           -- dont un « X » qui pourrait valoir 0 d'un côté et 1 de l'autre sans
           -- que personne ne le voie pendant six mois.
           --
           -- ⚠️ ET SURTOUT PAS UNE COLONNE SUR `training_exercises` : un tempo
           -- corrigé après coup y laisserait un score périmé. Ici la valeur est
           -- refabriquée à chaque lecture, donc jamais fausse.
           CASE WHEN e.kind = 'rehab'
                -- ⚠️ `coalesce` SANS `nullif` : `reps_done = 0` vaut ZÉRO,
                -- pas « retombe sur le prescrit ». Une série rapportée à zéro
                -- répétition n'a produit aucun temps sous tension, et créditer
                -- la prescription reviendrait à compter un travail qui n'a pas
                -- eu lieu. Même convention que le tonnage.
                THEN ff_mechano(e.tempo,
                                coalesce(ff_num(e.reps_done), ff_reps_low(e.reps)),
                                e.reps_unit)
           END AS mechano,
           -- LE TROU DE SAISIE QUI COMPTE (FRE-160) : du travail noté, aucun
           -- ressenti — donc invisible au suivi et aux records. La règle vit
           -- dans `records.py`, à côté de la trace ; ici on ne fait que la
           -- lire, et la séance en fait un compte.
           {travail_note_sans_ressenti("e")} AS sans_ressenti
    FROM training_exercises e
    JOIN training_sessions s ON s.id = e.session_id
    JOIN training_weeks w ON w.id = s.week_id
    {portee}
    ORDER BY e.position
""")


_EXERCICES = _exercices("""
    JOIN training_blocks b ON b.id = w.block_id
    JOIN training_macros m ON m.id = b.macro_id
    WHERE m.program_id = :pid""")

_BASE_LIGNES = """
    SELECT l.* FROM {table} l
    JOIN training_blocks b ON b.id = l.block_id
    JOIN training_macros m ON m.id = b.macro_id
    WHERE m.program_id = :pid ORDER BY l.position
"""

# ⚠️ Un COMPTE, pas les séances (FRE-119) : la barre du programme éteint la
# pastille d'une semaine vide, il lui faut savoir s'il y a des séances, pas les
# recevoir.
_COMPTE_SEANCES = text("""
    SELECT w.id AS week_id, count(s.id) AS n
    FROM training_weeks w
    JOIN training_blocks b ON b.id = w.block_id
    JOIN training_macros m ON m.id = b.macro_id
    LEFT JOIN training_sessions s ON s.week_id = w.id
    WHERE m.program_id = :pid
    GROUP BY w.id
""")

# Les mêmes lectures, bornées au BLOC (FRE-119). Elles ne remontent pas jusqu'au
# programme : `_BLOC` vérifie déjà l'appartenance du bloc.
#
# ⚠️ Seule `_SEMAINES_DU_BLOC` borne la RÉPONSE ; les deux autres bornent le
# TRAVAIL. Élargir `_SEANCES_DU_BLOC` au programme entier ne rougit AUCUN test —
# la sortie n'itère que les semaines de ce bloc — mais remonte tout l'historique
# à chaque clic.
_BLOC = text("""
    SELECT b.id, b.number, b.name,
           b.day_split, b.selected_principals, b.granularity,
           b.s1_start_date, b.s1_end_date
    FROM training_blocks b
    JOIN training_macros m ON m.id = b.macro_id
    WHERE b.id = CAST(:bid AS uuid) AND m.program_id = :pid
""")

_SEMAINES_DU_BLOC = text("""
    SELECT w.id, w.hidden FROM training_weeks w
    WHERE w.block_id = CAST(:bid AS uuid) ORDER BY w.number, w.legacy_id
""")

_SEANCES_DU_BLOC = text("""
    SELECT s.id, s.week_id, s.position, s.name, s.session_date, s.form_of_the_day
    FROM training_sessions s
    JOIN training_weeks w ON w.id = s.week_id
    WHERE w.block_id = CAST(:bid AS uuid) ORDER BY s.position
""")

_EXERCICES_DU_BLOC = _exercices("WHERE w.block_id = CAST(:bid AS uuid)")

_BASE_LIGNES_DU_BLOC = """
    SELECT l.* FROM {table} l
    WHERE l.block_id = CAST(:bid AS uuid) ORDER BY l.position
"""

# ⚠️ Un BOOLÉEN plutôt que la trame (FRE-119) : le menu « dupliquer la trame d'un
# autre bloc » doit savoir lesquels en portent une, sans les charger. C'est le
# serveur qui dit ce qu'« avoir une trame » veut dire, et nulle part ailleurs.
#
# Les quatre morceaux comptent : une grille de jours et une sélection de
# mouvements sans une seule ligne, c'est une trame commencée, qui se duplique.
_BLOCS_AVEC_BASE = text("""
    SELECT b.id,
           (b.day_split IS NOT NULL AND jsonb_array_length(b.day_split) > 0)
        OR (b.selected_principals IS NOT NULL AND cardinality(b.selected_principals) > 0)
        OR EXISTS (SELECT 1 FROM training_base_principles x WHERE x.block_id = b.id)
        OR EXISTS (SELECT 1 FROM training_base_accessories x WHERE x.block_id = b.id)
           AS a_une_base
    FROM training_blocks b
    JOIN training_macros m ON m.id = b.macro_id
    WHERE m.program_id = :pid
""")

_OBJECTIFS = text("""
    SELECT o.block_id AS bloc_uuid, o.id, o.exercise, o.variant, o.format, o.sets,
           o.reps, o.weight_min, o.weight_max, o.assistance, o.atteint_le
    FROM block_objectives o
    JOIN training_blocks b ON b.id = o.block_id
    JOIN training_macros m ON m.id = b.macro_id
    WHERE m.program_id = :pid
    ORDER BY o.position
""")

_ATHLETE = text("""
    SELECT a.first_name, a.last_name FROM programs p
    JOIN athletes a ON a.id = p.athlete_id WHERE p.id = :pid
""")

# Colonne → clé du contrat. Explicite, et non dérivée du nom : une conversion
# automatique ferait apparaître demain un champ que personne n'a décidé d'exposer.
_EXERCICE_SORTIE = {
    "id": "id", "name": "name", "variant": "variant", "kind": "kind", "tier": "tier",
    "format": "format", "cluster_mode": "clusterMode", "cluster_rest": "clusterRest",
    "tempo": "tempo", "sets": "sets", "reps": "reps", "reps_unit": "repsUnit",
    "weight": "weight", "weight_locked": "weightLocked", "assistance": "assistance",
    "aimed_rpe": "aimedRPE", "rest": "rest", "reps_done": "repsDone",
    "weight_done": "weightDone", "rest_actual": "restActual", "felt_rpe": "feltRPE",
    "felt_rpe_by_set": "feltRPEBySet", "reps_done_by_set": "repsDoneBySet",
    "weight_done_by_set": "weightDoneBySet", "tours_realises": "toursRealises",
    "athlete_feedback": "athleteFeedback",
    "coach_note": "coachNote", "link": "link", "group_id": "groupId",
    "group_kind": "groupKind", "unbroken": "unbroken",
    "increment": "increment", "increment_unit": "incrementUnit",
    # ⚠️ Absent de `_BASE_SORTIE`, volontairement : la BASE est une trame, pas une
    # série réalisée. L'y ajouter par symétrie promettrait un champ que rien ne
    # remplit.
    "mechano": "mechano",
}

_BASE_SORTIE = {
    "id": "id", "name": "name", "variant": "variant", "kind": "kind",
    "tier": "tier", "day": "day",
    "format": "format", "cluster_mode": "clusterMode", "cluster_rest": "clusterRest",
    "tempo": "tempo", "sets": "sets", "reps": "reps", "reps_unit": "repsUnit",
    "weight": "weight", "weight_locked": "weightLocked", "assistance": "assistance",
    "aimed_rpe": "aimedRPE", "rest": "rest", "coach_note": "coachNote",
    "increment": "increment", "increment_unit": "incrementUnit", "group_id": "groupId",
    "group_kind": "groupKind", "unbroken": "unbroken",
}


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


# Colonnes text[] : l'absence y vaut NULL en base, mais le contrat annonce une
# LISTE, et l'écran d'édition tombe sur `null`. Une clé de type liste est toujours
# présente et toujours une liste, comme `objectives` et `base.principles`.
# (`selectedPrincipaux` est l'exception : cf. `_sortie_base`.)
_LISTES = {"variant", "felt_rpe_by_set", "reps_done_by_set", "weight_done_by_set"}

def _sortie(ligne, correspondance: dict) -> dict:
    sortie = {}
    for col, cle in correspondance.items():
        if col not in ligne:
            continue
        valeur = ligne[col]
        if col == "id":
            sortie[cle] = str(valeur)
        elif col in _LISTES:
            sortie[cle] = valeur if valeur is not None else []
        else:
            # ⚠️ L'absence sort TELLE QU'ELLE EST : `NULL` reste `null`, jamais
            # `''` (FRE-137). Le contrat annonce `string | null`. Le `''` dont un
            # champ contrôlé de React a besoin se pose à l'AFFICHAGE
            # (`value={x ?? ''}`) : ici, on ne sait pas si la valeur part dans une
            # saisie ou dans une courbe.
            sortie[cle] = _iso(valeur)
    # ⚠️ La nature sort RÉSOLUE, jamais brute (FRE-36) : servir le NULL obligerait
    # le front à porter une seconde définition de « NULL vaut bi-set ». Ce défaut
    # est un FILET : l'invariant `groupe_sans_nature` (`make invariants`) garde
    # la base.
    #
    # Une ligne SANS groupe n'a pas de nature : `None`, ni « bi-set » (l'écran
    # croirait à un groupe d'un seul membre), ni `''` (FRE-137).
    if "group_kind" in correspondance and "group_id" in ligne:
        sortie[correspondance["group_kind"]] = (
            (ligne.get("group_kind") or NATURE_PAR_DEFAUT) if (ligne.get("group_id") or "").strip() else None
        )
    return sortie


#: Ce qui fait l'empreinte d'une liste d'objectifs de bloc — le CONTENU, dans
#: l'ordre de `position`. Pas l'`id` : le PUT réinsère la liste et en fabrique
#: de nouveaux, une liste identique changerait sinon d'empreinte.
COLONNES_EMPREINTE_OBJECTIFS = ("exercise", "variant", "format", "sets", "reps",
                                "weight_min", "weight_max", "assistance", "atteint_le")


def version_des_objectifs(lignes) -> str:
    """Rend la version d'une liste d'objectifs de bloc (FRE-163).

    Lue avec la charpente, exigée par `PUT …/objectives`.

    ⚠️ La lecture et l'écriture l'obtiennent ICI toutes les deux. `lignes` sont des
    lignes de `block_objectives` (mappings), triées par `position`.
    """
    return empreinte(tuple(o[c] for c in COLONNES_EMPREINTE_OBJECTIFS) for o in lignes)


def _sortie_objectif(o) -> dict:
    """Rend un objectif de bloc dans la forme du contrat.

    ⚠️ Une seule définition, partagée par `read_tree` et `read_structure`
    (FRE-119) : deux copies de la même correspondance divergent.
    """
    return {
        "id": str(o["id"]), "exercise": o["exercise"], "variant": o["variant"],
        "format": o["format"], "sets": o["sets"], "reps": o["reps"],
        "weightMin": o["weight_min"], "weightMax": o["weight_max"],
        "assistance": o["assistance"],
        # ⚠️ `None` ET NON `''` — « pas atteint » est une ABSENCE de date. Les
        # autres champs sortent en `''` parce qu'ils alimentent un tableau
        # ÉDITABLE, où un `null` casserait la saisie ; celui-ci n'est pas une
        # case de texte, c'est une coche.
        "atteintLe": o["atteint_le"].isoformat() if o["atteint_le"] else None,
    }


def _sortie_seance(s, exercices: dict) -> dict:
    """Rend une séance et ses lignes dans la forme du contrat.

    ⚠️ Une seule définition, partagée par `read_tree` et `read_block_content`
    (FRE-119) : un champ qui manquerait d'un seul côté ne se voit sur aucun écran
    avant la production.
    """
    return {
        "id": str(s["id"]),
        "name": s["name"],
        "sessionDate": _iso(s["session_date"]),
        # ⚠️ `None` quand aucune forme n'est saisie, jamais `''` (FRE-137) : la
        # forme du jour est un entier de 1 à 5, et l'absence se dit comme une
        # absence.
        "formOfTheDay": s["form_of_the_day"],
        "exercises": [_sortie(e, _EXERCICE_SORTIE) for e in exercices.get(str(s["id"]), [])],
        # Au grain de la SÉANCE, comme le n/N de l'écran (FRE-160). Un compte, pas
        # la liste : la plupart des séances disent zéro, et zéro, l'écran le tait.
        "lignesSansRessenti": sum(1 for e in exercices.get(str(s["id"]), []) if e["sans_ressenti"]),
    }


def _sortie_base(b, principes: list, accessoires: list) -> dict:
    """Rend la TRAME d'un bloc. Partagée, comme `_sortie_seance`.

    ⚠️ PAS de `or []` sur `selectedPrincipaux`, contrairement à ses voisins.
    `NULL` = le coach n'a jamais configuré sa sélection, et le front retombe sur
    l'ordre canonique de la bibliothèque ; `[]` = il a retiré les mouvements un
    par un, geste délibéré que le repli ne doit PAS annuler. Aplatis ensemble,
    l'éditeur de BASE se vide : `x ?? repli` ne se déclenche jamais sur `[]`.

    `daySplit` et `granularity` GARDENT leur repli : le front parcourt `daySplit`
    sans tester `null` ; et pour `granularity`, « aucune » et « vide » disent la
    même chose.
    """
    return {
        "daySplit": b["day_split"] or [],
        "principles": [_sortie(l, _BASE_SORTIE) for l in principes],
        "accessories": [_sortie(l, _BASE_SORTIE) for l in accessoires],
        "selectedPrincipaux": b["selected_principals"],
        "granularity": b["granularity"] or {},
        "s1StartDate": _iso(b["s1_start_date"]),
        "s1EndDate": _iso(b["s1_end_date"]),
    }


def _grouper(lignes, cle: str) -> dict:
    out: dict = {}
    for ligne in lignes:
        out.setdefault(str(ligne[cle]), []).append(ligne)
    return out


def read_structure(conn, program_id: str, voit_les_masquees: bool = True) -> dict:
    """Rend la CHARPENTE seule : macros → blocs → semaines, sans une séance (FRE-119).

    C'est ce que lisent le calendrier et la barre du programme : numéros, dates,
    objectifs — une fraction de l'arbre entier, qui grossit à chaque semaine.
    Mêmes filtres, même ordre, mêmes projections que `read_tree`.

    `voit_les_masquees` : cf. `_visibles`. Vrai par défaut, parce que les
    appelants INTERNES (les réponses d'écriture de structure) sont du staff par
    construction — seules les routes de lecture ont la question à poser.

    ⚠️ La BASE n'est pas ici : elle multiplierait le poids de la réponse pour une
    donnée que seul le coach lit. `hasBase` dit seulement si elle existe ; son
    contenu vient de `read_block_content`.

    ⚠️ `sessionCount` plutôt que `sessions` : la barre éteint la pastille d'une
    semaine vide, il lui faut le compte, pas le contenu.
    """
    p = {"pid": program_id}
    athlete = conn.execute(_ATHLETE, p).mappings().first()
    identite = ({"firstName": athlete["first_name"], "lastName": athlete["last_name"]}
                if athlete else {"firstName": "", "lastName": ""})

    macros = conn.execute(_MACROS, p).mappings().all()
    blocs = _grouper(conn.execute(_BLOCS, p).mappings().all(), "macro_id")
    semaines = _grouper(conn.execute(_SEMAINES, p).mappings().all(), "block_id")
    objectifs = _grouper(conn.execute(_OBJECTIFS, p).mappings().all(), "bloc_uuid")
    comptes = {str(r["week_id"]): r["n"]
               for r in conn.execute(_COMPTE_SEANCES, p).mappings().all()}
    trames = {str(r["id"]): r["a_une_base"]
              for r in conn.execute(_BLOCS_AVEC_BASE, p).mappings().all()}

    return {"macros": [{
        "id": str(m["id"]),
        "macroNumber": m["number"],
        "name": m["name"],
        "trainingFrequency": m["training_frequency"],
        "coachNotes": m["coach_notes"],
        "blocks": [{
            "id": str(b["id"]),
            "blockNumber": b["number"],
            "name": b["name"],
            **_bornes(semaines.get(str(b["id"]), [])),
            "objectives": [_sortie_objectif(o) for o in objectifs.get(str(b["id"]), [])],
            "objectivesVersion": version_des_objectifs(objectifs.get(str(b["id"]), [])),
            "hasBase": trames.get(str(b["id"]), False),
            "weeks": [{
                "id": str(w["id"]),
                "weekNumber": w["number"],
                "name": w["name"],
                "hidden": w["hidden"],
                "startDate": _iso(w["start_date"]),
                "endDate": _iso(w["end_date"]),
                "athlete": {
                    **identite,
                    # ⚠️ `None` et non `0` (FRE-137) : la plupart des semaines
                    # n'ont pas de pesée. Un athlète de zéro kilo n'existe pas ;
                    # « pas pesé cette semaine-là », si.
"weight": float(w["athlete_weight_kg"]) if w["athlete_weight_kg"] is not None else None,
                    "height": float(w["athlete_height_cm"]) if w["athlete_height_cm"] is not None else None,
                },
                "sessionCount": comptes.get(str(w["id"]), 0),
            } for w in _visibles(semaines.get(str(b["id"]), []), voit_les_masquees)],
        } for b in _blocs_visibles(blocs.get(str(m["id"]), []), semaines, voit_les_masquees)],
    } for m in macros]}


def read_block_content(conn, program_id: str, block_id: str,
                       voit_les_masquees: bool = True) -> dict | None:
    """Rend le CONTENU d'un seul bloc : sa trame, et les séances de ses semaines.

    Par bloc et pas par semaine : l'écran montre une semaine mais compare TOUTES
    celles de son bloc (progression, historique du mouvement). Et un bloc ne
    grossit pas, quand l'arbre prend une semaine par semaine.

    ⚠️ Le masquage s'applique ICI aussi (FRE-158) : la charpente filtrée ne suffit
    pas, une lecture directe rendrait encore la semaine masquée.

    ⚠️ Aucune métadonnée de semaine — ni numéro, ni dates, ni athlète (FRE-119) :
    la charpente les porte déjà, et deux sources d'une même valeur se
    contredisent dès que l'une est en cache. La semaine n'est ici qu'un
    identifiant qui porte des séances.

    Rend `None` si le bloc n'appartient pas à ce programme : c'est un 404, pas
    un 403. On ne confirme pas l'existence de ce qu'on n'a pas le droit de voir.
    """
    try:
        UUID(block_id)
    except (ValueError, AttributeError, TypeError):
        # ⚠️ Un id qui n'est pas un uuid est INTROUVABLE, pas une erreur serveur :
        # sans ce filtre, `CAST(:bid AS uuid)` lève et le client reçoit un 500 là
        # où un 404 lui dit la vérité.
        # Même règle que `verifier` (`metier_training_structure.py`).
        return None
    p_ = {"pid": program_id, "bid": block_id}
    bloc = conn.execute(_BLOC, p_).mappings().first()
    if bloc is None:
        return None

    semaines = conn.execute(_SEMAINES_DU_BLOC, p_).mappings().all()
    seances = _grouper(conn.execute(_SEANCES_DU_BLOC, p_).mappings().all(), "week_id")
    exercices = _grouper(conn.execute(_EXERCICES_DU_BLOC, p_).mappings().all(), "session_id")
    principes = conn.execute(
        text(_BASE_LIGNES_DU_BLOC.format(table="training_base_principles")), p_).mappings().all()
    accessoires = conn.execute(
        text(_BASE_LIGNES_DU_BLOC.format(table="training_base_accessories")), p_).mappings().all()

    return {
        "base": _sortie_base(bloc, list(principes), list(accessoires)),
        "weeks": [{
            "id": str(w["id"]),
            "sessions": [_sortie_seance(s, exercices)
                         for s in seances.get(str(w["id"]), [])],
        } for w in _visibles(semaines, voit_les_masquees)],
    }


def read_tree(conn, program_id: str, voit_les_masquees: bool = True) -> dict:
    """Rend l'arbre entier d'un programme, dans la forme attendue par le front.

    `voit_les_masquees` : cf. `_visibles` (FRE-158).
    """
    p = {"pid": program_id}
    athlete = conn.execute(_ATHLETE, p).mappings().first()
    identite = ({"firstName": athlete["first_name"], "lastName": athlete["last_name"]}
                if athlete else {"firstName": "", "lastName": ""})

    macros = conn.execute(_MACROS, p).mappings().all()
    blocs = _grouper(conn.execute(_BLOCS, p).mappings().all(), "macro_id")
    semaines = _grouper(conn.execute(_SEMAINES, p).mappings().all(), "block_id")
    seances = _grouper(conn.execute(_SEANCES, p).mappings().all(), "week_id")
    exercices = _grouper(conn.execute(_EXERCICES, p).mappings().all(), "session_id")
    principes = _grouper(
        conn.execute(text(_BASE_LIGNES.format(table="training_base_principles")), p)
        .mappings().all(), "block_id")
    accessoires = _grouper(
        conn.execute(text(_BASE_LIGNES.format(table="training_base_accessories")), p)
        .mappings().all(), "block_id")
    objectifs = _grouper(conn.execute(_OBJECTIFS, p).mappings().all(), "bloc_uuid")

    sortie_macros = []
    for m in macros:
        sortie_blocs = []
        for b in _blocs_visibles(blocs.get(str(m["id"]), []), semaines, voit_les_masquees):
            bid = str(b["id"])
            sortie_semaines = []
            for w in _visibles(semaines.get(bid, []), voit_les_masquees):
                sortie_seances = [_sortie_seance(s, exercices)
                                  for s in seances.get(str(w["id"]), [])]
                sortie_semaines.append({
                    "id": str(w["id"]),
                    "weekNumber": w["number"],
                    "name": w["name"],
                    "hidden": w["hidden"],
                    "startDate": _iso(w["start_date"]),
                    "endDate": _iso(w["end_date"]),
                    # Le poids et la taille sont des mesures DATÉES (celles de
                    # cette semaine) ; le nom vient de la fiche athlète.
                    "athlete": {
                        **identite,
                        # ⚠️ `None` et non `0` (FRE-137) : cf. `read_structure`.
"weight": float(w["athlete_weight_kg"]) if w["athlete_weight_kg"] is not None else None,
                        "height": float(w["athlete_height_cm"]) if w["athlete_height_cm"] is not None else None,
                    },
                    "sessions": sortie_seances,
                })
            sortie_blocs.append({
                "id": bid,
                "blockNumber": b["number"],
                "name": b["name"],
                **_bornes(semaines.get(bid, [])),
                "base": _sortie_base(b, principes.get(bid, []), accessoires.get(bid, [])),
                # Jamais absent, même vide : le front lit la clé sans la tester.
                "objectives": [_sortie_objectif(o) for o in objectifs.get(bid, [])],
                "objectivesVersion": version_des_objectifs(objectifs.get(bid, [])),
                "weeks": sortie_semaines,
            })
        sortie_macros.append({
            "id": str(m["id"]),
            "macroNumber": m["number"],
            "name": m["name"],
            # `trainingFrequency` et `coachNotes` sont NULLABLES au contrat.
            "trainingFrequency": m["training_frequency"],
            "coachNotes": m["coach_notes"],
            "blocks": sortie_blocs,
        })
    return {"macros": sortie_macros}


def lire_base(conn, block_uuid: str) -> dict:
    """Rend la BASE d'un bloc, dans la forme que le front connaît.

    ⚠️ Réutilise le mappage de la lecture d'arbre (`_BASE_SORTIE`) : avec deux
    mappages, un champ ajouté n'arriverait que d'un côté, et la génération lirait
    une BASE amputée sans que rien ne le dise.
    """
    bloc = conn.execute(text(
        "SELECT day_split, selected_principals, s1_start_date, s1_end_date "
        "FROM training_blocks WHERE id = CAST(:b AS uuid)"), {"b": block_uuid}).mappings().first()
    lignes = {
        table: conn.execute(
            text(f"SELECT l.* FROM {table} l WHERE l.block_id = CAST(:b AS uuid) "
                 "ORDER BY l.position"),
            {"b": block_uuid},
        ).mappings().all()
        for table in ("training_base_principles", "training_base_accessories")
    }
    return {
        "daySplit": bloc["day_split"] or [],
        "principles": [_sortie(l, _BASE_SORTIE) for l in lignes["training_base_principles"]],
        "accessories": [_sortie(l, _BASE_SORTIE) for l in lignes["training_base_accessories"]],
        # ⚠️ PAS de `or []` : NULL (jamais configuré → repli canonique) et `[]`
        # (retiré à la main → sélection vide) ne disent pas la même chose.
        "selectedPrincipaux": bloc["selected_principals"],
        "s1StartDate": bloc["s1_start_date"].isoformat() if bloc["s1_start_date"] else "",
        "s1EndDate": bloc["s1_end_date"].isoformat() if bloc["s1_end_date"] else "",
    }
