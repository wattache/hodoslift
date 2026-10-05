"""Les routes d'écriture de la STRUCTURE de l'arbre d'entraînement (FRE-12).

Macros, blocs, semaines, séances, BASE d'un bloc. Les lignes ont leur routeur
(`routes_training_lines.py`) ; le métier vit dans `metier_training_structure.py`.

⚠️ `require_program_access` autorise le PROGRAMME de l'URL, pas l'objet visé :
chaque route remonte jusqu'au programme (`metier.verifier`), sinon un coach
écrirait chez un autre athlète avec son propre `program_id`.

⚠️ Les numéros sont calculés PAR LE SERVEUR et RECOMPACTÉS après suppression, aux
trois niveaux : avec `max + 1`, un trou finit en doublon, que le Tracking FUSIONNE.
"""

from typing import Literal

from fastapi import APIRouter, Depends, status

from app.socle.erreurs import erreurs
from app.socle.audit import log_write
from app.socle.authz import ProgramAccess, require_program_access
from app.socle.perimetre import refuser_hors_perimetre
from app.entrainement.relecture import marquer_semaine_modifiee
from app.socle.db import get_session
from app.socle.erreurs import ErreurMetier
from app.entrainement.schemas_block_objectives import ObjectivesReplace
from app.entrainement.schemas_training_structure import (
    BasePreview, BaseReplace, BlockCreate, BlockPatch, MacroCreate, MacroPatch, Order,
    SessionCreate, SessionPatch, WeekContentReplace, WeekCreate, WeekPatch,
)
from app.socle.schemas_ecriture import (ArbreCree, ChampsEcrits, Confirmation, ContenuRealise,
                               Denombrement, ObjectifsRemplaces, ObjetCree)
# Le vocabulaire d'une ligne vit dans `prescription.py` (FRE-45), jamais ici.
from app.entrainement.arbre_creation import (
    creer_bloc, creer_seances, creer_semaine,
)
from app.entrainement.generation_semaine import generer_semaine
from app.entrainement.semaine_suivante import semaine_suivante
from app.entrainement.training_tree import lire_base, version_des_objectifs
from app.entrainement.schemas_training_lecture import SemaineLue
from app.entrainement import metier_training_structure as metier
from app.notifications.metier_push import notifier_nouvelle_semaine


router = APIRouter(prefix="/programs/{program_id}", tags=["training"])

_coach = require_program_access("coach")


# --------------------------------------------------------------------------- #
# MACRO
# --------------------------------------------------------------------------- #

@router.patch("/macros/{macro_id}", response_model=ChampsEcrits, responses=erreurs(401, 403, 404))
def patch_macro(program_id: str, macro_id: str, payload: MacroPatch,
                access: ProgramAccess = Depends(_coach)) -> dict:
    with get_session() as conn:
        metier.verifier(conn, "macro", program_id, macro_id)
        ecrits = metier.patch(conn, "macro", macro_id, payload.model_dump(exclude_unset=True))
    log_write(uid=access.claims["uid"], resource="training_macro",
              doc_path=f"programs/{program_id}/macros/{macro_id}", fields=ecrits)
    return {"ok": True, "written": ecrits}


@router.post("/macros", status_code=status.HTTP_201_CREATED, response_model=ArbreCree, response_model_exclude_unset=True, responses=erreurs(401, 403, 404, 409))
def create_macro(program_id: str, payload: MacroCreate,
                 access: ProgramAccess = Depends(_coach)) -> dict:
    """Crée un macro, et par défaut son premier bloc.

    Un macro vide n'est pas un état que l'interface sait présenter.

    ⚠️ REJOUABLE quand le client donne les identités (`MacroCreate`) : le macro
    déjà là est retrouvé, et son bloc n'est recréé que s'il porte lui aussi une
    identité — sinon chaque rejeu ajouterait un bloc."""
    with get_session() as conn:
        macro_id, existait = metier.inserer_le_macro(conn, program_id, payload)
        ids = {"macro": str(macro_id)}
        bloc = payload.block or BlockCreate()
        if not existait or bloc.id is not None:
            ids |= creer_bloc(conn, macro_id, bloc)
    log_write(uid=access.claims["uid"], resource="training_macro",
              doc_path=f"programs/{program_id}/macros/{ids['macro']}", fields=["create"])
    return {"ok": True, "ids": ids}


@router.get("/realise/{niveau}/{objet_id}", response_model=ContenuRealise,
            responses=erreurs(401, 403, 404))
def get_contenu_realise(
    program_id: str,
    niveau: Literal["macro", "bloc", "semaine", "seance"],
    objet_id: str,
    access: ProgramAccess = Depends(_coach),
) -> dict:
    """Rend ce qu'une suppression de cet objet détruirait de RÉALISÉ (FRE-130).

    Une route pour les quatre niveaux : la définition de « réalisé » n'a qu'une
    adresse, seule la colonne de jointure change.

    ⚠️ Même garde que la suppression (`_coach`), et l'appartenance d'abord (404) :
    sinon ce compte apprendrait l'existence d'un objet qu'on n'a pas le droit de
    voir."""
    with get_session() as conn:
        metier.verifier(conn, niveau, program_id, objet_id)
        return metier.contenu_realise(conn, niveau, program_id, objet_id)


@router.delete("/macros/{macro_id}", response_model=Confirmation, responses=erreurs(401, 403, 404))
def delete_macro(program_id: str, macro_id: str,
                 access: ProgramAccess = Depends(_coach)) -> dict:
    """Supprime un macro et tout ce qu'il porte.

    La cascade est tenue par les clés étrangères (`ON DELETE CASCADE`) : blocs,
    semaines, séances, lignes et BASE partent avec, dans la transaction."""
    with get_session() as conn:
        metier.verifier(conn, "macro", program_id, macro_id)
        # ⚠️ Compté AVANT d'effacer : le journal est le seul endroit où une
        # suppression massive reste constatable (FRE-130).
        detruit = metier.contenu_realise(conn, "macro", program_id, macro_id)
        metier.supprimer_l_objet(conn, "macro", macro_id)
        metier.recompacter(conn, "macro", program_id)
    log_write(uid=access.claims["uid"], resource="training_macro",
              doc_path=f"programs/{program_id}/macros/{macro_id}", fields=["delete"],
              count=detruit["lignes"])
    return {"ok": True}


# --------------------------------------------------------------------------- #
# BLOC
# --------------------------------------------------------------------------- #

@router.patch("/blocks/{block_id}", response_model=ChampsEcrits, responses=erreurs(401, 403, 404))
def patch_block(program_id: str, block_id: str, payload: BlockPatch,
                access: ProgramAccess = Depends(_coach)) -> dict:
    with get_session() as conn:
        metier.verifier(conn, "bloc", program_id, block_id)
        ecrits = metier.patch(conn, "bloc", block_id, payload.model_dump(exclude_unset=True))
    log_write(uid=access.claims["uid"], resource="training_block",
              doc_path=f"programs/{program_id}/blocks/{block_id}", fields=ecrits)
    return {"ok": True, "written": ecrits}


@router.post("/macros/{macro_id}/blocks", status_code=status.HTTP_201_CREATED, response_model=ArbreCree, response_model_exclude_unset=True, responses=erreurs(401, 403, 404, 409))
def create_block(program_id: str, macro_id: str, payload: BlockCreate,
                 access: ProgramAccess = Depends(_coach)) -> dict:
    with get_session() as conn:
        macro = metier.verifier(conn, "macro", program_id, macro_id)
        ids = creer_bloc(conn, macro["id"], payload)
    log_write(uid=access.claims["uid"], resource="training_block",
              doc_path=f"programs/{program_id}/blocks/{ids['block']}", fields=["create"])
    return {"ok": True, "ids": ids}


@router.delete("/blocks/{block_id}", response_model=Confirmation, responses=erreurs(401, 403, 404, 409))
def delete_block(program_id: str, block_id: str,
                 access: ProgramAccess = Depends(_coach)) -> dict:
    """Supprime un bloc, sauf le DERNIER de son macro.

    Un macro vide n'a pas de représentation à l'écran.

    Raises:
        ErreurMetier: `dernier_bloc` (409)."""
    with get_session() as conn:
        bloc = metier.verifier(conn, "bloc", program_id, block_id)
        restants = metier.blocs_du_macro(conn, bloc["macro_id"])
        if restants <= 1:
            raise ErreurMetier("dernier_bloc", status.HTTP_409_CONFLICT,
                                detail="dernier bloc du macrocycle : suppression refusée")
        # ⚠️ Compté AVANT d'effacer : le journal est le seul endroit où une
        # suppression massive reste constatable (FRE-130).
        detruit = metier.contenu_realise(conn, "bloc", program_id, block_id)
        metier.supprimer_l_objet(conn, "bloc", block_id)
        metier.recompacter(conn, "bloc", bloc["macro_id"])
    log_write(uid=access.claims["uid"], resource="training_block",
              doc_path=f"programs/{program_id}/blocks/{block_id}", fields=["delete"],
              count=detruit["lignes"])
    return {"ok": True}


@router.put("/blocks/{block_id}/base", response_model=Confirmation, responses=erreurs(401, 403, 404))
def replace_base(program_id: str, block_id: str, payload: BaseReplace,
                 access: ProgramAccess = Depends(_coach)) -> dict:
    """Remplace INTÉGRALEMENT la BASE, et redate les semaines du bloc.

    Les lignes sont supprimées puis réinsérées : leur identité est leur position,
    elles n'ont pas de clé propre côté client."""
    base = payload.base
    with get_session() as conn:
        metier.verifier(conn, "bloc", program_id, block_id)
        metier.ecrire_la_base(conn, block_id, base)
        # Dans la MÊME transaction : la trame ne diverge jamais du calendrier.
        metier.redater_les_semaines(conn, block_id, payload.weekDates or [])
    log_write(uid=access.claims["uid"], resource="training_base",
              doc_path=f"programs/{program_id}/blocks/{block_id}/base",
              fields=["base"], count=len(base.principles) + len(base.accessories))
    return {"ok": True}


@router.put("/blocks/{block_id}/objectives", response_model=ObjectifsRemplaces, responses=erreurs(401, 403, 404, 409))
def replace_objectives(program_id: str, block_id: str, payload: ObjectivesReplace,
                       access: ProgramAccess = Depends(_coach)) -> dict:
    """Remplace la liste d'objectifs d'un bloc, si elle n'a pas bougé depuis sa lecture.

    Le bloc est désigné par son uuid : `block_objectives` porte une vraie clé
    étrangère (FRE-12).

    Raises:
        ErreurMetier: `objectifs_perimes` (409), la version reçue n'est plus
            celle de la base (FRE-163)."""
    # ⚠️ Les bornes et les champs refusés sont ceux du MODÈLE (`ObjectivesReplace`,
    # FRE-124) : pas de seconde borne écrite à la main ici.
    objectifs = [o.model_dump() for o in payload.objectives]
    with get_session() as conn:
        metier.verifier(conn, "bloc", program_id, block_id)
        # ⚠️ La version se relit DANS la transaction d'écriture (FRE-163) : lue
        # avant, elle laisserait la fenêtre qu'elle prétend fermer.
        actuelle = version_des_objectifs(metier.objectifs_du_bloc(conn, block_id))
        if payload.version != actuelle:
            raise ErreurMetier(
                "objectifs_perimes",
                status.HTTP_409_CONFLICT,
                "les objectifs du bloc ont changé depuis leur lecture — recharger avant d'enregistrer",
            )
        sortie = metier.remplacer_les_objectifs(conn, block_id, objectifs)
        # Relue plutôt que recalculée de ce qui a été reçu : c'est ce que la
        # prochaine lecture rendra, donc ce que la prochaine écriture comparera.
        nouvelle = version_des_objectifs(metier.objectifs_du_bloc(conn, block_id))
    log_write(uid=access.claims["uid"], resource="block_objectives",
              doc_path=f"programs/{program_id}/blocks/{block_id}/objectives",
              fields=["objectives"], count=len(objectifs))
    return {"ok": True, "count": len(objectifs), "objectives": sortie, "version": nouvelle}


# --------------------------------------------------------------------------- #
# SEMAINE
# --------------------------------------------------------------------------- #

@router.patch("/weeks/{week_id}", response_model=ChampsEcrits, responses=erreurs(401, 403, 404))
def patch_week(program_id: str, week_id: str, payload: WeekPatch,
               access: ProgramAccess = Depends(require_program_access("coach_or_athlete"))) -> dict:
    """Écrit la méta d'une semaine — `coach_or_athlete`, pas sur les mêmes champs.

    L'athlète met à jour son poids et sa taille de la semaine, pas le nom ni les
    dates ni `hidden` (`app/socle/perimetre.py`)."""
    fourni = payload.model_dump(exclude_unset=True)
    with get_session() as conn:
        # ⚠️ L'appartenance D'ABORD, le périmètre des champs ensuite : inversés,
        # un athlète visant l'objet d'un AUTRE programme reçoit 403 là où ce
        # module promet 404.
        metier.verifier(conn, "semaine", program_id, week_id)
        refuser_hors_perimetre(access, "semaine", fourni)
        ecrits = metier.patch(conn, "semaine", week_id, fourni)
    log_write(uid=access.claims["uid"], resource="training_week",
              doc_path=f"programs/{program_id}/weeks/{week_id}", fields=ecrits)
    return {"ok": True, "written": ecrits}


# --------------------------------------------------------------------------- #
# DEUX ROUTES-OUTILS, SANS APPELANT DANS LE FRONT (FRE-142)
#
# `POST /blocks/{id}/weeks` et `PUT /weeks/{id}/content` : le front génère par
# `generate-week` et `next-week`, qui créent la semaine EUX-MÊMES.
#
# Elles restent comme OUTILS : ce sont les seules à poser une semaine complète
# en un appel, ce dont vivent les fixtures de ce dépôt et le harnais réel d'eitri
# (`e2e-reel/semaine-deja-remplie.spec.ts`). Ne pas les brancher à un écran sans
# relire ce qui suit sur le réalisé.
# --------------------------------------------------------------------------- #


@router.post("/blocks/{block_id}/weeks", status_code=status.HTTP_201_CREATED, response_model=ArbreCree, response_model_exclude_unset=True, responses=erreurs(401, 403, 404))
def create_week(program_id: str, block_id: str, payload: WeekCreate,
                access: ProgramAccess = Depends(_coach)) -> dict:
    """Crée une semaine ET ses séances en un appel. Route-outil, cf. ci-dessus."""
    with get_session() as conn:
        bloc = metier.verifier(conn, "bloc", program_id, block_id)
        ids = creer_semaine(conn, bloc["id"], payload)
    log_write(uid=access.claims["uid"], resource="training_week",
              doc_path=f"programs/{program_id}/weeks/{ids['week']}", fields=["create"],
              count=len(payload.sessions))
    return {"ok": True, "ids": ids}


@router.put("/weeks/{week_id}/content", response_model=ArbreCree, response_model_exclude_unset=True,
            responses=erreurs(401, 403, 404, 409))
def replace_week_content(program_id: str, week_id: str, payload: WeekContentReplace,
                         access: ProgramAccess = Depends(_coach)) -> dict:
    """Remplit une semaine VIDE avec le contenu reçu, et rend les ids créés.

    Route-outil, cf. l'en-tête de section.

    ⚠️ SEULEMENT SI ELLE EST VIDE (FRE-84) : les séances sont réinsérées SANS les
    colonnes de réalisé, donc remplacer une semaine entraînée effacerait le
    travail de l'athlète. La garde est ici, et pas seulement à l'écran, pour
    valoir pour un appel direct ou un script.

    ⚠️ « Zéro séance », et pas « sans réalisé » : c'est la règle de l'écran, et un
    fait qui se compte — « réalisé » s'interprète, et bute sur `''` contre NULL.
    Régénérer une semaine remplie reste possible : on la SUPPRIME d'abord, le
    geste destructeur est explicite.

    Raises:
        ErreurMetier: `semaine_deja_remplie` (409)."""
    with get_session() as conn:
        semaine = metier.verifier(conn, "semaine", program_id, week_id)
        deja = metier.seances_de_la_semaine(conn, semaine["id"])
        if deja:
            raise ErreurMetier(
                "semaine_deja_remplie", status.HTTP_409_CONFLICT,
                f"la semaine porte déjà {deja} séance(s) — la supprimer pour la régénérer",
            )
        instantane = payload.athlete or {}
        # L'instantané athlète suit le contenu : il décrit la personne AU MOMENT
        # de cette semaine.
        if payload.athlete is not None:
            metier.ecrire_l_instantane_athlete(conn, week_id, instantane)
        metier.vider_la_semaine(conn, semaine["id"])
        sessions = creer_seances(conn, semaine["id"], payload.sessions)
        # Un chemin d'écriture de séance de plus pour la file de relecture — les
        # autres sont dans `routes_training_lines.py`, même fonction.
        marquer_semaine_modifiee(conn, semaine["id"], access.claims["uid"])
    log_write(uid=access.claims["uid"], resource="training_week",
              doc_path=f"programs/{program_id}/weeks/{week_id}/content",
              fields=["content"], count=len(payload.sessions))
    return {"ok": True, "ids": {"week": week_id, "sessions": sessions}}


@router.post("/sessions/{session_id}/relecture", response_model=Confirmation,
             responses=erreurs(401, 403, 404))
def marquer_relue(program_id: str, session_id: str,
                  access: ProgramAccess = Depends(_coach)) -> dict:
    """Le coach a vu cette séance : elle sort de sa file."""
    with get_session() as conn:
        seance = metier.verifier(conn, "seance", program_id, session_id)
        metier.marquer_la_seance_relue(conn, seance["id"], access.claims["uid"])
    log_write(uid=access.claims["uid"], resource="training_session",
              doc_path=f"programs/{program_id}/sessions/{session_id}/relecture", fields=["relue"])
    return {"ok": True}


@router.delete("/sessions/{session_id}/relecture", response_model=Confirmation,
               responses=erreurs(401, 403, 404))
def retirer_la_relecture(program_id: str, session_id: str,
                         access: ProgramAccess = Depends(_coach)) -> dict:
    """La séance redevient à relire."""
    with get_session() as conn:
        seance = metier.verifier(conn, "seance", program_id, session_id)
        metier.retirer_la_relecture_de(conn, seance["id"])
    log_write(uid=access.claims["uid"], resource="training_session",
              doc_path=f"programs/{program_id}/sessions/{session_id}/relecture", fields=["non-relue"])
    return {"ok": True}


@router.post("/blocks/{block_id}/base/preview-week", response_model=SemaineLue,
             responses=erreurs(401, 403, 404))
def preview_week(program_id: str, block_id: str, payload: BasePreview,
                 access: ProgramAccess = Depends(_coach)) -> dict:
    """Rend la semaine que la BASE ENVOYÉE produirait — sans rien écrire.

    ⚠️ Une route, et pas un calcul du front : l'aperçu et la génération passent par
    la MÊME fonction (`generer_semaine`), ils ne peuvent pas diverger.

    La BASE vient du CORPS, pas de la base de données : le brouillon n'est pas
    enregistré, et l'aperçu suit la frappe. Les identifiants rendus sont des
    étiquettes d'affichage (`apercu-…`) : rien n'existe en base."""
    with get_session() as conn:
        metier.verifier(conn, "bloc", program_id, block_id)
    semaine = generer_semaine(payload.base.model_dump(), graine_id="apercu")
    return metier.en_semaine_lue(semaine, identifiant="apercu")


@router.post("/blocks/{block_id}/generate-week", status_code=status.HTTP_201_CREATED,
             response_model=SemaineLue, responses=erreurs(401, 403, 404, 409))
def generate_week(program_id: str, block_id: str,
                  access: ProgramAccess = Depends(_coach)) -> dict:
    """Génère la SEMAINE 1 du bloc depuis sa BASE ENREGISTRÉE, et la rend.

    Un ordre, une transaction : la réponse est la semaine telle qu'elle EXISTE,
    relue par le chemin de lecture.

    ⚠️ La garde de FRE-84 s'applique : on ne génère que sur une semaine VIDE
    (cf. `replace_week_content`).

    Raises:
        ErreurMetier: `semaine_deja_remplie` (409) ; `base_sans_dates` (409) par
            `metier.exiger_les_dates_de_s1`."""
    with get_session() as conn:
        bloc = metier.verifier(conn, "bloc", program_id, block_id)
        base = lire_base(conn, str(bloc["id"]))
        metier.exiger_les_dates_de_s1(base)
        semaine = generer_semaine(base)

        existante = metier.premiere_semaine_du_bloc(conn, str(bloc["id"]))

        if existante is None:
            week_id = metier.inserer_la_semaine(conn, str(bloc["id"]), 1, semaine)
        else:
            deja = metier.seances_de_la_semaine(conn, existante["id"])
            if deja:
                raise ErreurMetier(
                    "semaine_deja_remplie", status.HTTP_409_CONFLICT,
                    f"la semaine porte déjà {deja} séance(s) — la supprimer pour la régénérer",
                )
            week_id = existante["id"]
            metier.dater_la_semaine(conn, week_id, semaine)

        creer_seances(conn, week_id, semaine["sessions"])
        lue = metier.relire_semaine(conn, program_id, str(week_id))

    log_write(uid=access.claims["uid"], resource="training_week",
              doc_path=f"programs/{program_id}/weeks/{week_id}", fields=["generate"],
              count=len(semaine["sessions"]))
    # APRÈS le commit : l'athlète apprend une semaine qui existe. Jamais avant.
    notifier_nouvelle_semaine(program_id=program_id, numero=1, auteur_uid=access.claims["uid"])
    return lue


@router.post("/blocks/{block_id}/next-week", status_code=status.HTTP_201_CREATED,
             response_model=SemaineLue, responses=erreurs(401, 403, 404, 409))
def create_next_week(program_id: str, block_id: str,
                     access: ProgramAccess = Depends(_coach)) -> dict:
    """Ajoute au bloc la semaine qui SUIT la dernière, et la rend.

    Réalisé vidé, incréments appliqués, charges effacées là où rien ne les fait
    progresser : le calcul vit dans `semaine_suivante.py`. Aucun 1RM n'est lu."""
    with get_session() as conn:
        bloc_sql = metier.verifier(conn, "bloc", program_id, block_id)
        bloc = metier.bloc_de_l_arbre(conn, program_id, str(bloc_sql["id"]))
        # AVANT toute écriture : un refus rendu après coup laisserait une semaine.
        metier.exiger_les_dates_de_s1(bloc.get("base") or {})
        semaine = semaine_suivante(bloc)

        week_id = metier.inserer_la_semaine(
            conn, str(bloc_sql["id"]), semaine["weekNumber"], semaine)
        creees = creer_seances(conn, week_id, semaine["sessions"])

        # ⚠️ UN BLOC SANS SEMAINE DONNE UNE SÉANCE AVEC UNE LIGNE VIDE, insérée À
        # PART : le chargement en masse ÉCARTE les lignes sans nom (résidus
        # d'édition), et une séance neuve ressortirait sans ligne où taper.
        if not bloc.get("weeks") and creees:
            metier.poser_une_ligne_vide(conn, creees[0]["id"])

        lue = metier.relire_semaine(conn, program_id, str(week_id))

    log_write(uid=access.claims["uid"], resource="training_week",
              doc_path=f"programs/{program_id}/weeks/{week_id}", fields=["next-week"],
              count=len(semaine["sessions"]))
    notifier_nouvelle_semaine(program_id=program_id, numero=semaine["weekNumber"], auteur_uid=access.claims["uid"])
    return lue


@router.delete("/weeks/{week_id}", response_model=Confirmation, responses=erreurs(401, 403, 404))
def delete_week(program_id: str, week_id: str,
                access: ProgramAccess = Depends(_coach)) -> dict:
    with get_session() as conn:
        semaine = metier.verifier(conn, "semaine", program_id, week_id)
        # ⚠️ Compté AVANT d'effacer : le journal est le seul endroit où une
        # suppression massive reste constatable (FRE-130).
        detruit = metier.contenu_realise(conn, "semaine", program_id, week_id)
        metier.supprimer_l_objet(conn, "semaine", week_id)
        metier.recompacter(conn, "semaine", semaine["block_id"])
    log_write(uid=access.claims["uid"], resource="training_week",
              doc_path=f"programs/{program_id}/weeks/{week_id}", fields=["delete"],
              count=detruit["lignes"])
    return {"ok": True}


# --------------------------------------------------------------------------- #
# SÉANCE
# --------------------------------------------------------------------------- #

@router.patch("/sessions/{session_id}", response_model=ChampsEcrits, responses=erreurs(401, 403, 404))
def patch_session(program_id: str, session_id: str, payload: SessionPatch,
                  access: ProgramAccess = Depends(require_program_access("coach_or_athlete"))) -> dict:
    """Écrit la méta d'une séance — `coach_or_athlete`, pas sur les mêmes champs.

    L'athlète saisit la FORME DU JOUR, et elle seule : renommer ou dater une
    séance reste un geste de programmation."""
    fourni = payload.model_dump(exclude_unset=True)
    with get_session() as conn:
        # ⚠️ L'appartenance D'ABORD, le périmètre des champs ensuite : inversés,
        # un athlète visant l'objet d'un AUTRE programme reçoit 403 là où ce
        # module promet 404.
        metier.verifier(conn, "seance", program_id, session_id)
        refuser_hors_perimetre(access, "seance", fourni)
        ecrits = metier.patch(conn, "seance", session_id, fourni)
    log_write(uid=access.claims["uid"], resource="training_session",
              doc_path=f"programs/{program_id}/sessions/{session_id}", fields=ecrits)
    return {"ok": True, "written": ecrits}


@router.post("/weeks/{week_id}/sessions", status_code=status.HTTP_201_CREATED, response_model=ObjetCree, responses=erreurs(401, 403, 404, 409))
def create_session(program_id: str, week_id: str, payload: SessionCreate,
                   access: ProgramAccess = Depends(_coach)) -> dict:
    with get_session() as conn:
        semaine = metier.verifier(conn, "semaine", program_id, week_id)
        session_id = metier.ajouter_une_seance(conn, semaine["id"], payload)
    log_write(uid=access.claims["uid"], resource="training_session",
              doc_path=f"programs/{program_id}/sessions/{session_id}", fields=["create"])
    return {"ok": True, "id": str(session_id)}


@router.delete("/sessions/{session_id}", response_model=Confirmation, responses=erreurs(401, 403, 404))
def delete_session(program_id: str, session_id: str,
                   access: ProgramAccess = Depends(_coach)) -> dict:
    with get_session() as conn:
        seance = metier.verifier(conn, "seance", program_id, session_id)
        # ⚠️ Compté AVANT d'effacer : le journal est le seul endroit où une
        # suppression massive reste constatable (FRE-130).
        detruit = metier.contenu_realise(conn, "seance", program_id, session_id)
        metier.supprimer_l_objet(conn, "seance", session_id)
        metier.repositionner_les_seances(conn, seance["week_id"])
    log_write(uid=access.claims["uid"], resource="training_session",
              doc_path=f"programs/{program_id}/sessions/{session_id}", fields=["delete"],
              count=detruit["lignes"])
    return {"ok": True}


@router.put("/weeks/{week_id}/sessions/order", response_model=Denombrement, responses=erreurs(401, 403, 404))
def reorder_sessions(program_id: str, week_id: str, payload: Order,
                     access: ProgramAccess = Depends(_coach)) -> dict:
    with get_session() as conn:
        semaine = metier.verifier(conn, "semaine", program_id, week_id)
        actuels = metier.ids_des_seances(conn, semaine["id"])
        if len(set(payload.ids)) != len(payload.ids) or set(payload.ids) != actuels:
            raise ErreurMetier("reordonnancement_incoherent", 
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="la liste doit contenir exactement les séances de la semaine, "
                       "une fois chacune")
        metier.poser_l_ordre_des_seances(conn, payload.ids)
    log_write(uid=access.claims["uid"], resource="training_session",
              doc_path=f"programs/{program_id}/weeks/{week_id}/sessions/order",
              fields=["order"], count=len(payload.ids))
    return {"ok": True, "count": len(payload.ids)}
