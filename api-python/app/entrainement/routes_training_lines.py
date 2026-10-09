"""Écriture de l'entraînement AU GRAIN DE LA LIGNE (FRE-12).

La voie NORMALE d'écriture : à ce grain, une valeur invalide ne coûte que SA
ligne, et une règle par nature de ligne (FRE-13, FRE-53) devient applicable.

⚠️ `require_program_access` autorise l'accès au PROGRAMME du chemin, pas à la
ligne visée : seule la remontée de `metier_training_lines` empêche un coach de
passer SON program_id avec l'id d'une ligne d'un autre athlète.
⚠️ Le mode est la PORTE, pas la règle : l'appartenance d'abord (404), puis
`app/socle/perimetre.py` tranche sur les champs écrits (403).
"""


from fastapi import APIRouter, Depends, status

from app.socle.erreurs import erreurs
from app.socle.audit import log_write
from app.socle.authz import ProgramAccess, require_program_access
from app.socle.db import get_session
from app.socle.perimetre import refuser_prescription
from app.entrainement.prescription import (
    vide_vaut_absence,
)
# ⚠️ TOUTES les écritures de ce fichier horodatent la séance, par la MÊME
# fonction : une demi-règle fausserait la file de relecture du coach.
from app.entrainement.relecture import marquer_modifiee
from app.entrainement.schemas_training_line import ExerciseLineCreate, ExerciseLinePatch, ExerciseMove, ExerciseOrder
from app.socle.schemas_ecriture import ChampsEcrits, Denombrement, LigneSupprimee, ObjetCree
from app.socle.erreurs import ErreurMetier
from app.entrainement import metier_training_lines as metier

router = APIRouter(prefix="/programs/{program_id}", tags=["training"])


# Les champs où un `None` explicite (« vider la case ») s'écrit `''`, parce que la
# colonne est NOT NULL. ⚠️ VIDE, et gardé pour la prochaine colonne NOT NULL :
# `name` n'y est pas (FRE-123) — il référence la bibliothèque, et une clé
# étrangère REFUSE `''` là où elle accepte `NULL`.
_NON_NULLABLES: set[str] = set()

# ⚠️ Ce que la lecture rend mais que l'écriture IGNORE (FRE-103). `mechano` est
# DÉRIVÉ (`ff_mechano`, aucune colonne). Le contrat l'ACCEPTE — ce que la lecture
# rend doit pouvoir être renvoyé tel quel — mais il n'atteint jamais le SQL, où
# `COLONNES_LIGNE[k]` lèverait un KeyError, donc un 500.
# Retiré ICI et non dans le schéma : le schéma dit ce qu'on accepte de recevoir,
# cette liste ce qu'on n'écrit pas.
_LECTURE_SEULE = {"mechano"}


@router.patch("/exercises/{exercise_id}", response_model=ChampsEcrits, responses=erreurs(401, 403, 404))
def patch_exercise(
    program_id: str,
    exercise_id: str,
    payload: ExerciseLinePatch,
    access: ProgramAccess = Depends(require_program_access("coach_or_athlete_or_kine")),
) -> dict:
    """Modifie une ligne. Seuls les champs FOURNIS sont écrits.

    Un refus de validation ne coûte que cette ligne, jamais la semaine.

    Le MODE laisse entrer les trois principaux — l'athlète y saisit son RÉALISÉ.
    `refuser_prescription` tranche ensuite sur les CHAMPS écrits : le réalisé pour
    tous, la prescription pour le staff seul.
    """
    # ⚠️ `''` devient `NULL` ICI AUSSI (FRE-137), et c'est le chemin qui compte :
    # le PATCH réécrit la ligne à chaque saisie de réalisé. La règle vit dans
    # `prescription`, où la création la prend aussi.
    fourni = {k: vide_vaut_absence(k, "" if v is None and k in _NON_NULLABLES else v)
              for k, v in payload.model_dump(exclude_unset=True).items()
              if k not in _LECTURE_SEULE}
    # ⚠️ Un tableau VIDE devient `NULL` : `''` contre `NULL`, sur un type tableau.
    # Le suivi (`_SERIES_PAR_LIFT_SQL`) marque une ligne « faite » sur
    # `felt_rpe_by_set IS NOT NULL`, ce qu'un `{}` satisferait sans le moindre
    # ressenti. `ff_moyenne_rpe(NULL)` rend `''` comme `ff_moyenne_rpe('{}')` : la
    # dérivation n'en est pas changée.
    for tableau in metier.DERIVEES:
        if tableau in fourni and not fourni[tableau]:
            fourni[tableau] = None
    with get_session() as conn:
        # ⚠️ L'APPARTENANCE D'ABORD (404), le périmètre ensuite (403) (FRE-43).
        # Inversé, la différence entre les deux refus révélerait l'existence d'une
        # ligne qui ne regarde pas l'appelant.
        ligne = metier.exercice(conn, program_id, exercise_id)
        refuser_prescription(access, fourni)
        # AVANT de bâtir le SET : `metier.derivations` retire du patch les
        # scalaires que le serveur recalcule.
        derivees = metier.derivations(fourni)
        metier.ecrire_la_ligne(conn, exercise_id, fourni, derivees)
        # ⚠️ Ce qui appartient au GROUPE s'écrit sur tout le groupe (FRE-36). Le
        # front le propage déjà à la frappe ; la règle est ici pour tous les
        # appelants. Une valeur divergente n'est montrée par aucun écran (« ↑ » sur
        # les membres suivants) : aucun écran ne la corrigerait.
        metier.propager_les_champs_de_groupe(conn, ligne, fourni)

        # La nature suit le groupe, qu'il vienne de CE patch (on lie et on qualifie
        # d'un coup) ou d'avant lui (on requalifie). Le `groupId` d'APRÈS
        # l'écriture tranche dans les deux cas.
        if "groupKind" in fourni or "groupId" in fourni:
            gid = fourni.get("groupId", ligne["group_id"])
            nature = fourni.get("groupKind")
            if nature is None and gid:
                # Le patch ne portait que le lien : la nature est celle que le
                # groupe a déjà, pas un effacement.
                nature = metier.nature_du_groupe(conn, ligne["session_id"], gid)
            metier.propager_la_nature(conn, ligne["session_id"], gid, nature)
        metier.aligner_un_groupe_chronometre(
            conn, ligne["session_id"], (fourni.get("groupId", ligne["group_id"]) or "").strip())
        metier.ranger_les_liens(conn, ligne["session_id"])
        # ⚠️ QUI a écrit, pas seulement QUAND : l'athlète qui ressaisit son réalisé
        # remet la séance dans la file de relecture, pas le coach qui la retouche.
        marquer_modifiee(conn, ligne["session_id"], access.claims["uid"])
    log_write(uid=access.claims["uid"], resource="training_line",
              doc_path=f"programs/{program_id}/exercises/{exercise_id}",
              fields=sorted(fourni))
    return {"ok": True, "written": sorted(fourni)}


@router.post("/sessions/{session_id}/exercises", status_code=status.HTTP_201_CREATED, response_model=ObjetCree, responses=erreurs(401, 403, 404, 409))
def add_exercise(
    program_id: str,
    session_id: str,
    payload: ExerciseLineCreate,
    access: ProgramAccess = Depends(require_program_access("coach")),
) -> dict:
    """Ajoute une ligne EN FIN de séance.

    La position est calculée par le serveur : la laisser au client permettrait
    des collisions.

    Créer est un geste de PROGRAMMATION, donc le mode `coach` — qui inclut le
    kiné de l'athlète (`_MODES`, `authz.py`). L'athlète n'ajoute pas de ligne à
    sa séance.
    """
    # ⚠️ Une ligne naît par TROIS chemins : ici, `inserer_ligne` (création
    # d'arbre) et la génération de semaine. Chacun ferme la porte au `''`.
    # L'identité n'est pas de la prescription : elle sort du corps avant d'écrire.
    fourni = {k: vide_vaut_absence(k, v)
              for k, v in payload.model_dump(exclude_unset=True).items()
              if k not in _LECTURE_SEULE and k != "id"}
    with get_session() as conn:
        metier.seance(conn, program_id, session_id)
        eid, existait = metier.ajouter_en_fin_de_seance(conn, session_id, fourni, payload.id)
        if existait:
            # Un rejeu : la ligne est là, avec ce que les patchs suivants lui ont
            # déjà donné. Ne rien réécrire.
            return {"ok": True, "id": eid}
        # ⚠️ Une ligne qui REJOINT un groupe en adopte la nature. Sinon une
        # troisième descente ajoutée à un dropset y glisserait un bi-set, et le
        # groupe serait illisible pour l'écran comme pour la génération.
        gid = (fourni.get("groupId") or "").strip()
        if gid:
            metier.propager_la_nature(
                conn, session_id, gid, metier.nature_du_groupe(conn, session_id, gid))
            metier.aligner_un_groupe_chronometre(conn, session_id, gid)
        # Ajouter une ligne est une écriture de séance comme les autres.
        metier.ranger_les_liens(conn, session_id)
        marquer_modifiee(conn, session_id, access.claims["uid"])
    log_write(uid=access.claims["uid"], resource="training_line",
              doc_path=f"programs/{program_id}/sessions/{session_id}/exercises/{eid}",
              fields=sorted(fourni))
    return {"ok": True, "id": str(eid)}


@router.post("/exercises/{exercise_id}/duplicate", status_code=status.HTTP_201_CREATED, response_model=ObjetCree, responses=erreurs(401, 403, 404))
def duplicate_exercise(
    program_id: str,
    exercise_id: str,
    access: ProgramAccess = Depends(require_program_access("coach")),
) -> dict:
    """Duplique une ligne JUSTE DESSOUS, prescription comprise.

    ⚠️ Ce qui se copie est la liste de la GÉNÉRATION (`CHAMPS_COPIES` : la
    prescription et le `kind`) : une seconde liste, tenue par le front, dériverait
    au premier champ ajouté. JAMAIS le réalisé.

    ⚠️ PAS AU MILIEU D'UN GROUPE. Sous le premier membre d'un bi-set, la copie se
    glisserait ENTRE les deux : des lignes non consécutives, que l'écran et la
    génération lisent comme deux groupes (FRE-31). Elle se pose sous le GROUPE
    entier, et n'en fait pas partie : `group_id` n'est pas un champ de
    prescription.

    Mode `coach`, qui inclut le kiné de l'athlète : c'est de la programmation.
    """
    with get_session() as conn:
        ligne = metier.exercice(conn, program_id, exercise_id)
        eid = metier.dupliquer_sous_son_groupe(conn, ligne, exercise_id)
        metier.ranger_les_liens(conn, ligne["session_id"])
        marquer_modifiee(conn, ligne["session_id"], access.claims["uid"])
    log_write(uid=access.claims["uid"], resource="training_line",
              doc_path=f"programs/{program_id}/exercises/{eid}",
              fields=["duplicate"])
    return {"ok": True, "id": str(eid)}


@router.delete("/exercises/{exercise_id}", response_model=LigneSupprimee, responses=erreurs(401, 403, 404))
def delete_exercise(
    program_id: str,
    exercise_id: str,
    access: ProgramAccess = Depends(require_program_access("coach")),
) -> dict:
    """Supprime une ligne, renumérote la séance, et délie le groupe réduit à un membre.

    Mode `coach`, qui inclut le kiné de l'athlète : supprimer est de la
    programmation, et l'athlète ne retire pas une ligne de sa séance.
    """
    with get_session() as conn:
        ligne = metier.exercice(conn, program_id, exercise_id)
        metier.supprimer_la_ligne(conn, exercise_id)
        orphelins = metier.nettoyer_groupe(conn, ligne["session_id"], ligne["group_id"])
        metier.renumeroter(conn, ligne["session_id"])
        metier.ranger_les_liens(conn, ligne["session_id"])
        marquer_modifiee(conn, ligne["session_id"], access.claims["uid"])
    log_write(uid=access.claims["uid"], resource="training_line",
              doc_path=f"programs/{program_id}/exercises/{exercise_id}",
              fields=["delete"], count=orphelins)
    return {"ok": True, "groupesNettoyes": orphelins}


@router.put("/sessions/{session_id}/exercises/order", response_model=Denombrement, responses=erreurs(401, 403, 404))
def reorder_exercises(
    program_id: str,
    session_id: str,
    payload: ExerciseOrder,
    access: ProgramAccess = Depends(require_program_access("coach")),
) -> dict:
    """Réordonne une séance à partir de la liste COMPLÈTE de ses lignes.

    L'ensemble reçu doit être EXACTEMENT celui de la séance : ni oubli, ni
    intrus, ni doublon. C'est ce qui distingue un réordonnancement d'un état
    partiel.

    Raises:
        ErreurMetier: `reordonnancement_incoherent` (422).
    """
    with get_session() as conn:
        metier.seance(conn, program_id, session_id)
        actuels = metier.ids_de_la_seance(conn, session_id)
        recus = payload.exerciseIds
        if len(set(recus)) != len(recus) or set(recus) != actuels:
            raise ErreurMetier("reordonnancement_incoherent", 
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="la liste doit contenir exactement les exercices de la séance, "
                       "une fois chacun",
            )
        metier.poser_l_ordre(conn, recus)
        # ⚠️ Le réordonnancement AUSSI : le coach relit, réordonne, et sans
        # `modifiee_par` la séance lui reviendrait dans la file.
        metier.ranger_les_liens(conn, session_id)
        marquer_modifiee(conn, session_id, access.claims["uid"])
    log_write(uid=access.claims["uid"], resource="training_line",
              doc_path=f"programs/{program_id}/sessions/{session_id}/exercises/order",
              fields=["order"], count=len(payload.exerciseIds))
    return {"ok": True, "count": len(payload.exerciseIds)}


@router.put("/exercises/{exercise_id}/seance", response_model=Denombrement, responses=erreurs(401, 403, 404, 409))
def move_exercise(
    program_id: str,
    exercise_id: str,
    payload: ExerciseMove,
    access: ProgramAccess = Depends(require_program_access("coach")),
) -> dict:
    """Déplace une ligne — son groupe entier, s'il y en a un — dans une AUTRE
    séance de la même semaine, et rend le nombre de lignes déplacées (FRE-188).

    Une seule transaction, l'`id` inchangé, le réalisé intact. Les deux séances
    sont renumérotées, leurs liens rangés, et remises dans la file de relecture :
    le coach a changé la forme des deux.

    Raises:
        ErreurMetier: `exercice_introuvable`, `seance_introuvable` (404) ;
            `seance_d_une_autre_semaine` (409).
    """
    with get_session() as conn:
        ligne = metier.exercice(conn, program_id, exercise_id)
        cible = metier.seance(conn, program_id, payload.sessionId)
        source_id, cible_id = str(ligne["session_id"]), str(cible["id"])
        if not metier.meme_semaine(conn, source_id, cible_id):
            raise ErreurMetier("seance_d_une_autre_semaine", status.HTTP_409_CONFLICT,
                               detail="la séance cible n'est pas dans la même semaine")
        deplaces = metier.deplacer_vers(conn, ligne, cible_id, payload.position) if source_id != cible_id else []
        for sid in (source_id, cible_id):
            metier.renumeroter(conn, sid)
            metier.ranger_les_liens(conn, sid)
            marquer_modifiee(conn, sid, access.claims["uid"])
    log_write(uid=access.claims["uid"], resource="training_line",
              doc_path=f"programs/{program_id}/exercises/{exercise_id}/seance",
              fields=["move"], count=len(deplaces))
    return {"ok": True, "count": len(deplaces)}
