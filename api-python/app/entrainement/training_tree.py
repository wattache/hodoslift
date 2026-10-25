"""Les trois lectures de l'entraînement : l'arbre, la charpente, le contenu d'un bloc.

Une requête à plat par niveau, recomposées en mémoire : une seule jointure de la
racine aux exercices multiplierait chaque ligne parente par ses enfants.

Les trois lectures partagent leurs projections (`_sortie`, `_sortie_seance`,
`_sortie_base`, `_sortie_objectif`) et leur filtre de masquage (`_visibles`).

Une séance est identifiée par son `id` (uuid) ; `legacy_id` ne sert qu'à l'ordre
et ne sort pas de l'API. `athlete` recompose prénom et nom par jointure ; le
poids et la taille, mesures datées, vivent sur la semaine.
"""

from typing import NamedTuple

from sqlalchemy import text

from app.socle.empreinte import empreinte
from app.entrainement.arbre_creation import est_un_uuid
from app.entrainement.prescription import COLONNES_LIGNE, COLONNES_PAR_TABLE, NATURE_PAR_DEFAUT
from app.entrainement.avancement_objectifs import avancement, lignes_realisees
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


def _blocs_visibles(blocs_du_macro, voit_les_masquees):
    """Les blocs qui ont encore quelque chose à montrer à ce lecteur (FRE-158).

    ⚠️ Un bloc dont TOUTES les semaines sont masquées ne sort pas — et ses
    objectifs partent avec lui : le tableau de bord de l'athlète lit
    `block.objectives` sur la charpente, et afficherait ceux d'un bloc caché.

    Un bloc réellement SANS semaine tombe par la même porte, et c'est voulu : un
    bloc neuf naît sans semaine, le coach le compose, l'athlète n'a rien à y voir.

    Qui programme garde tout : le bloc en construction vit chez lui, et c'est lui
    qui démasque. La règle est celle de `blocs_lus.visible_a_l_athlete`.
    """
    if voit_les_masquees:
        return list(blocs_du_macro)
    return [b for b in blocs_du_macro if b["visible_a_l_athlete"]]

def _bornes(bloc) -> dict:
    """Un bloc s'étend sur ses SEMAINES : `blocs_lus.debut` et `fin`.

    ⚠️ UNE SEULE DÉFINITION, dans la vue. `training_blocks` n'a plus de dates
    propres : elles ont porté une seconde définition de la même période, et
    elle a divergé — un bloc borné à sa seule S1 laissait un trou d'un mois dans
    la frise. Sans semaine datée, le bloc n'a pas de période, et le rend : `''`
    des deux côtés, jamais `null`."""
    return {"startDate": _iso(bloc["debut"]) if bloc["debut"] else "",
            "endDate": _iso(bloc["fin"]) if bloc["fin"] else ""}


_MACROS = text("""
    SELECT id, legacy_id, number, name, training_frequency, coach_notes
    FROM training_macros WHERE program_id = :pid ORDER BY number, legacy_id
""")


# LES DEUX PORTÉES (FRE-119, FRE-232). Chaque lecture s'écrit UNE fois, et ne
# diffère d'une portée à l'autre que par ce fragment : deux copies d'une
# projection divergent au premier champ ajouté d'un seul côté.
#
# ⚠️ La portée BLOC ne remonte pas au programme : `_bloc_lu` vérifie déjà
# l'appartenance du bloc. Et elle borne le TRAVAIL autant que la réponse — une
# séance lue au programme entier ne rougirait aucun test (la sortie n'itère que
# les semaines du bloc), mais remonterait tout l'historique à chaque clic.
def _par_programme(colonne: str) -> str:
    return f"""
    JOIN training_blocks b ON b.id = {colonne}
    JOIN training_macros m ON m.id = b.macro_id
    WHERE m.program_id = :pid"""


def _par_bloc(colonne: str) -> str:
    return f"WHERE {colonne} = CAST(:bid AS uuid)"


# Les blocs et les semaines viennent de leurs VUES (FRE-219) : bornes, trame,
# visibilité et compte de séances y sont posés une fois, pour l'arbre comme
# pour la charpente.
def _blocs(filtre: str):
    return text(f"""
    SELECT b.id, b.macro_id, b.number, b.name,
           b.day_split, b.selected_principals, b.granularity,
           b.s1_start_date, b.s1_end_date,
           b.debut, b.fin, b.visible_a_l_athlete, b.a_une_base
    FROM blocs_lus b
    WHERE b.program_id = :pid {filtre} ORDER BY b.number, b.legacy_id
""")


def _semaines(portee: str):
    return text(f"""
    SELECT w.id, w.block_id, w.number, w.name, w.hidden, w.start_date, w.end_date,
           w.athlete_weight_kg, w.athlete_height_cm, w.session_count
    FROM semaines_lues w
    {portee} ORDER BY w.number, w.legacy_id
""")


def _seances(portee: str):
    return text(f"""
    SELECT s.id, s.week_id, s.position, s.name, s.session_date, s.form_of_the_day
    FROM training_sessions s
    JOIN training_weeks w ON w.id = s.week_id
    {portee} ORDER BY s.position
""")


# `e.*` volontairement : énumérer les colonnes ferait disparaître sans erreur un
# champ ajouté et oublié ici. C'est `_EXERCICE_SORTIE`, plus bas, qui dit ce qui
# sort : elle est le CONTRAT. Une seule requête : deux copies du calcul de
# `mechano` divergeraient au premier ajustement de la formule (FRE-103).
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


def _base_lignes(table: str, portee: str):
    return text(f"SELECT l.* FROM {table} l {portee} ORDER BY l.position")


def _objectifs(portee: str):
    return text(f"""
    SELECT o.block_id AS bloc_uuid, o.id, o.exercise, o.variant, o.format, o.sets,
           o.reps, o.weight_min, o.weight_max, o.assistance, o.atteint_le,
           o.cluster_mode, o.cluster_rest, o.tempo, o.source, o.tier
    FROM block_objectives o
    {portee}
    ORDER BY o.position
""")


_BLOCS = _blocs("")
_BLOC_LU = _blocs("AND b.id = CAST(:bid AS uuid)")
_SEMAINES = _semaines(_par_programme("w.block_id"))
_SEMAINES_DU_BLOC = _semaines(_par_bloc("w.block_id"))
_SEANCES = _seances(_par_programme("w.block_id"))
_SEANCES_DU_BLOC = _seances(_par_bloc("w.block_id"))
_EXERCICES = _exercices(_par_programme("w.block_id"))
_EXERCICES_DU_BLOC = _exercices(_par_bloc("w.block_id"))
_PRINCIPES = _base_lignes("training_base_principles", _par_programme("l.block_id"))
_PRINCIPES_DU_BLOC = _base_lignes("training_base_principles", _par_bloc("l.block_id"))
_ACCESSOIRES = _base_lignes("training_base_accessories", _par_programme("l.block_id"))
_ACCESSOIRES_DU_BLOC = _base_lignes("training_base_accessories", _par_bloc("l.block_id"))
_OBJECTIFS = _objectifs(_par_programme("o.block_id"))
_OBJECTIFS_DU_BLOC = _objectifs(_par_bloc("o.block_id"))

_ATHLETE = text("""
    SELECT a.first_name, a.last_name FROM programs p
    JOIN athletes a ON a.id = p.athlete_id WHERE p.id = :pid
""")


def _identite(conn, program_id: str) -> dict:
    """Le nom de l'athlète du programme ; `''` des deux côtés s'il n'en a pas."""
    athlete = conn.execute(_ATHLETE, {"pid": program_id}).mappings().first()
    return ({"firstName": athlete["first_name"], "lastName": athlete["last_name"]}
            if athlete else {"firstName": "", "lastName": ""})


def objectifs_du_bloc(conn, block_id: str) -> list:
    """Les objectifs d'un bloc, par la requête de l'arbre : la version exigée à
    l'écriture se calcule sur les MÊMES lignes que celle servie à la lecture."""
    return conn.execute(_OBJECTIFS_DU_BLOC, {"bid": block_id}).mappings().all()


# Colonne → clé du contrat, DÉRIVÉ de `COLONNES_LIGNE` (contrat → colonne) : la
# liste explicite est une, l'écriture et la lecture la partagent (FRE-233). Un
# champ n'apparaît donc que si quelqu'un l'a écrit là-bas — pas par conversion
# automatique d'un nom de colonne.
_EXERCICE_SORTIE = {
    "id": "id",
    **{colonne: cle for cle, colonne in COLONNES_LIGNE.items()},
    # Lu seulement, jamais écrit : dérivé du tempo (`ff_mechano`). Absent de la
    # BASE, volontairement — une trame n'est pas une série réalisée.
    "mechano": "mechano",
}

# La BASE ne sort que les champs que ses deux tables acceptent (`day` compris,
# qui se traduit à l'identique).
_BASE_SORTIE = {
    "id": "id",
    **{COLONNES_LIGNE.get(cle, cle): cle
       for cle in sorted(COLONNES_PAR_TABLE["training_base_principles"]
                         | COLONNES_PAR_TABLE["training_base_accessories"])},
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
                                "weight_min", "weight_max", "assistance", "atteint_le",
                                "cluster_mode", "cluster_rest", "tempo", "source", "tier")


def version_des_objectifs(lignes) -> str:
    """Rend la version d'une liste d'objectifs de bloc (FRE-163).

    Lue avec la charpente, exigée par `PUT …/objectives`.

    ⚠️ La lecture et l'écriture l'obtiennent ICI toutes les deux. `lignes` sont des
    lignes de `block_objectives` (mappings), triées par `position`.
    """
    return empreinte(tuple(o[c] for c in COLONNES_EMPREINTE_OBJECTIFS) for o in lignes)


def _sortie_objectif(o, lignes_du_bloc: list[dict] | None = None) -> dict:
    """Rend un objectif de bloc dans la forme du contrat.

    ⚠️ Une seule définition, partagée par `read_tree` et `read_structure`
    (FRE-119) : deux copies de la même correspondance divergent.
    """
    return {
        "id": str(o["id"]), "exercise": o["exercise"], "variant": o["variant"],
        "format": o["format"], "clusterMode": o["cluster_mode"], "clusterRest": o["cluster_rest"],
        "tempo": o["tempo"], "source": o["source"], "tier": o["tier"],
        "sets": o["sets"], "reps": o["reps"],
        "weightMin": o["weight_min"], "weightMax": o["weight_max"],
        "assistance": o["assistance"],
        # ⚠️ `None` ET NON `''` — « pas atteint » est une ABSENCE de date. Les
        # autres champs sortent en `''` parce qu'ils alimentent un tableau
        # ÉDITABLE, où un `null` casserait la saisie ; celui-ci n'est pas une
        # case de texte, c'est une coche.
        "atteintLe": o["atteint_le"].isoformat() if o["atteint_le"] else None,
        # Où en est l'athlète (FRE-254) : calculé ICI, lu tel quel par les trois
        # écrans qui montrent les objectifs.
        "avancement": avancement(o, lignes_du_bloc or []),
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
    donnée que seul le coach lit. `hasBase` (`blocs_lus.a_une_base`) dit
    seulement si elle existe ; son contenu vient de `read_block_content`.

    ⚠️ `sessionCount` plutôt que `sessions` : la barre éteint la pastille d'une
    semaine vide, il lui faut le compte, pas le contenu (`semaines_lues`).
    """
    p = {"pid": program_id}
    identite = _identite(conn, program_id)
    macros = conn.execute(_MACROS, p).mappings().all()
    blocs = _grouper(conn.execute(_BLOCS, p).mappings().all(), "macro_id")
    semaines = _grouper(conn.execute(_SEMAINES, p).mappings().all(), "block_id")
    objectifs = _grouper(conn.execute(_OBJECTIFS, p).mappings().all(), "bloc_uuid")
    realisees = lignes_realisees(conn, program_id=program_id) if objectifs else {}

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
            **_bornes(b),
            "objectives": [_sortie_objectif(o, realisees.get(str(b["id"])))
                           for o in objectifs.get(str(b["id"]), [])],
            "objectivesVersion": version_des_objectifs(objectifs.get(str(b["id"]), [])),
            "hasBase": b["a_une_base"],
            "weeks": [_sortie_semaine(w, identite)
                      for w in _visibles(semaines.get(str(b["id"]), []), voit_les_masquees)],
        } for b in _blocs_visibles(blocs.get(str(m["id"]), []), voit_les_masquees)],
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
    if not est_un_uuid(block_id):
        return None
    p_ = {"pid": program_id, "bid": block_id}
    bloc = conn.execute(_BLOC_LU, p_).mappings().first()
    if bloc is None:
        return None

    semaines = conn.execute(_SEMAINES_DU_BLOC, p_).mappings().all()
    seances = _grouper(conn.execute(_SEANCES_DU_BLOC, p_).mappings().all(), "week_id")
    exercices = _grouper(conn.execute(_EXERCICES_DU_BLOC, p_).mappings().all(), "session_id")
    principes = conn.execute(_PRINCIPES_DU_BLOC, p_).mappings().all()
    accessoires = conn.execute(_ACCESSOIRES_DU_BLOC, p_).mappings().all()

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
    identite = _identite(conn, program_id)
    macros = conn.execute(_MACROS, p).mappings().all()
    blocs = _grouper(conn.execute(_BLOCS, p).mappings().all(), "macro_id")
    semaines = _grouper(conn.execute(_SEMAINES, p).mappings().all(), "block_id")
    seances = _grouper(conn.execute(_SEANCES, p).mappings().all(), "week_id")
    exercices = _grouper(conn.execute(_EXERCICES, p).mappings().all(), "session_id")
    principes = _grouper(conn.execute(_PRINCIPES, p).mappings().all(), "block_id")
    accessoires = _grouper(conn.execute(_ACCESSOIRES, p).mappings().all(), "block_id")
    objectifs = _grouper(conn.execute(_OBJECTIFS, p).mappings().all(), "bloc_uuid")

    realisees = lignes_realisees(conn, program_id=program_id) if objectifs else {}
    lu = _Lu(identite, seances, exercices, principes, accessoires, objectifs, realisees)
    return {"macros": [{
        "id": str(m["id"]),
        "macroNumber": m["number"],
        "name": m["name"],
        # `trainingFrequency` et `coachNotes` sont NULLABLES au contrat.
        "trainingFrequency": m["training_frequency"],
        "coachNotes": m["coach_notes"],
        "blocks": [_sortie_bloc(b, semaines.get(str(b["id"]), []), lu, voit_les_masquees)
                   for b in _blocs_visibles(blocs.get(str(m["id"]), []), voit_les_masquees)],
    } for m in macros]}


class _Lu(NamedTuple):
    """Ce que les projections d'un bloc lisent, groupé par parent."""

    identite: dict
    seances: dict
    exercices: dict
    principes: dict
    accessoires: dict
    objectifs: dict
    realisees: dict


def _sortie_semaine(w, identite: dict, sessions: list | None = None) -> dict:
    """UNE semaine, pour la charpente comme pour l'arbre.

    Sans `sessions` (la charpente), la semaine porte son COMPTE de séances :
    la barre éteint la pastille d'une semaine vide, il lui faut le compte, pas
    le contenu. Avec, l'arbre y range ses séances.
    """
    sortie = {
        "id": str(w["id"]),
        "weekNumber": w["number"],
        "name": w["name"],
        "hidden": w["hidden"],
        "startDate": _iso(w["start_date"]),
        "endDate": _iso(w["end_date"]),
        # Le poids et la taille sont des mesures DATÉES (celles de cette
        # semaine) ; le nom vient de la fiche athlète.
        "athlete": {
            **identite,
            # ⚠️ `None` et non `0` (FRE-137) : la plupart des semaines n'ont pas
            # de pesée. Un athlète de zéro kilo n'existe pas ; « pas pesé cette
            # semaine-là », si.
            "weight": float(w["athlete_weight_kg"]) if w["athlete_weight_kg"] is not None else None,
            "height": float(w["athlete_height_cm"]) if w["athlete_height_cm"] is not None else None,
        },
    }
    if sessions is None:
        sortie["sessionCount"] = w["session_count"]
    else:
        sortie["sessions"] = sessions
    return sortie


def _sortie_bloc(b, semaines: list, lu: _Lu, voit_les_masquees: bool) -> dict:
    """UN `BlocLu`, pour `read_tree` comme pour `read_block` : une seule projection."""
    bid = str(b["id"])
    return {
        "id": bid,
        "blockNumber": b["number"],
        "name": b["name"],
        **_bornes(b),
        "base": _sortie_base(b, lu.principes.get(bid, []), lu.accessoires.get(bid, [])),
        # Jamais absent, même vide : le front lit la clé sans la tester.
        "objectives": [_sortie_objectif(o, lu.realisees.get(bid)) for o in lu.objectifs.get(bid, [])],
        "objectivesVersion": version_des_objectifs(lu.objectifs.get(bid, [])),
        "weeks": [_sortie_semaine(w, lu.identite,
                                  [_sortie_seance(s, lu.exercices) for s in lu.seances.get(str(w["id"]), [])])
                  for w in _visibles(semaines, voit_les_masquees)],
    }


def read_block(conn, program_id: str, block_id: str) -> dict | None:
    """UN bloc dans la forme de `read_tree` — `BlocLu` —, par des lectures bornées au bloc.

    Pour les gestes qui relisent ce qu'ils viennent d'écrire (`next-week`,
    `generate-week`) : la même projection que l'arbre, sans lire l'historique
    entier du programme à chaque « + Semaine ». Les semaines masquées sont là :
    l'appelant est du staff par construction.

    Rend `None` si le bloc n'appartient pas à ce programme.
    """
    p = {"pid": program_id, "bid": block_id}
    bloc = conn.execute(_BLOC_LU, p).mappings().first()
    if bloc is None:
        return None
    semaines = conn.execute(_SEMAINES_DU_BLOC, p).mappings().all()
    lu = _Lu(
        _identite(conn, program_id),
        _grouper(conn.execute(_SEANCES_DU_BLOC, p).mappings().all(), "week_id"),
        _grouper(conn.execute(_EXERCICES_DU_BLOC, p).mappings().all(), "session_id"),
        _grouper(conn.execute(_PRINCIPES_DU_BLOC, p).mappings().all(), "block_id"),
        _grouper(conn.execute(_ACCESSOIRES_DU_BLOC, p).mappings().all(), "block_id"),
        _grouper(conn.execute(_OBJECTIFS_DU_BLOC, p).mappings().all(), "bloc_uuid"),
        lignes_realisees(conn, block_id=block_id),
    )
    return _sortie_bloc(bloc, semaines, lu, voit_les_masquees=True)
