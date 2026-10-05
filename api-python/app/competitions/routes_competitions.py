"""Les routes des compétitions : écriture, lecture, disponibilités des coachs.

Le contrat reste le document imbriqué (participants[].movements[].attempts[]) :
`metier_competitions` le décompose à l'écriture et le recompose à la lecture.

AUTORISATION — dans SA structure (FRE-13), tout coach crée, édite et supprime ;
hors d'elle, 404. ⚠️ La LECTURE n'est pas ouverte à tout membre : un non-coach ne
voit que les compétitions où il concourt — sinon la PII des autres athlètes
(poids, catégorie, essais) serait exposée.

DÉRIVÉS SERVEUR, refusés en entrée (422) : `createdBy`, `participantUids`, `score`
(recalculé à la lecture, jamais stocké). `editorEmails` : accepté, NON persisté.
"""


from fastapi import APIRouter, Depends, Query, status

from app.socle.audit import log_write
from app.socle.auth import verify_token
from app.socle.authz import is_admin, is_coach, require_membre
from app.socle.structures import slugs_de, structure_ecrite
from app.socle.db import get_session
from app.competitions.schemas_competition import CoachAvailabilityPut, CompetitionCreate, CompetitionPatch
from app.competitions.schemas_competition_lecture import (
    AthleteInscriptible,
    CompetitionLue,
    DispoDeCoach,
    LigneDeMatrice,
)
from app.socle.schemas_ecriture import CompetitionEcrite, Confirmation, ObjetCree, ObjetSupprime
from app.socle.erreurs import ErreurMetier, IdentifiantDeChemin, erreurs
from app.competitions import metier_competitions as metier

router = APIRouter(prefix="/competitions", tags=["competitions"])


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.put("/{comp_id}", response_model=ObjetCree, responses=erreurs(401, 403, 404, 409))
def put_competition(
    comp_id: IdentifiantDeChemin,
    payload: CompetitionCreate,
    claims: dict = Depends(verify_token),
    structure: str | None = Query(default=None, max_length=64,
                                  description="Où elle naît (FRE-13) — l'admin nomme la structure qu'il regarde ; "
                                              "absente = celle où l'on coache"),
) -> dict:
    """Crée ou remplace une compétition — tout coach de sa structure.

    Le remplacement supprime les enfants et les réinsère, dans UNE transaction.
    """
    uid = claims["uid"]
    if not is_coach(uid):
        raise ErreurMetier("reserve_aux_coachs", status.HTTP_403_FORBIDDEN, "réservé aux coachs")

    with get_session() as session:
        # La sienne si elle existe ; sinon celle où elle va naître.
        sienne = (metier.structure_de_comp(session, legacy=comp_id)
                  or structure_ecrite(session, uid, structure))
        metier.validate_competition_movements(session, payload.movementNames, sienne)
        internal = metier.participants_to_internal(payload.participants, metier.athlete_map(session))
        metier.validate_competes_on(
            [(p["name"], p["competes_on"]) for p in internal], payload.startDate, payload.endDate
        )
        metier.validate_weight_categories(session, internal)
        metier.validate_attempt_norep(internal)
        metier.validate_annonces_croissantes(internal)
        metier.validate_flights(session, payload.flights)
        # Le payload est décomposé TEL QU'IL EST : un essai sur un mouvement absent
        # de `movementNames` serait sauté sans un mot.
        metier.valider_essais_conserves(payload.movementNames, internal)
        metier.exiger_sa_structure(session, uid, comp_id)
        existing = metier.select_comp(session, legacy=comp_id)
        comp_params = {
            "legacy_id": comp_id, "name": payload.name, "start_date": payload.startDate,
            "end_date": payload.endDate, "location": payload.location, "max_attempts": payload.maxAttempts,
        }
        if existing is None:  # create
            cid = metier.inserer_la_competition(session, comp_params, created_by=uid, structure=sienne)
        else:  # replace — createdBy préservé
            cid = existing[0]
            metier.remplacer_la_meta(session, cid, comp_params)
            metier.clear_children(session, cid)

        metier.write_children(session, cid, payload.movementNames, internal)
        metier.replace_flights(session, cid, payload.flights)

    log_write(uid=uid, resource="competition", doc_path=f"competitions/{comp_id}",
              fields=["name", "date", "movements", "participants", "flights"])
    return {"ok": True, "id": comp_id}


@router.patch("/{comp_id}", response_model=CompetitionEcrite, responses=erreurs(401, 403, 404, 409))
def patch_competition(
    comp_id: IdentifiantDeChemin,
    payload: CompetitionPatch,
    claims: dict = Depends(verify_token),
) -> dict:
    """Patch partiel — tout coach de sa structure. Les champs absents restent inchangés.

    Si `movementNames` OU `participants` change, les DEUX sont réinsérés ensemble :
    les essais référencent le `movement_id`, on ne recrée pas les mouvements sans
    re-câbler les essais.

    Raises:
        ErreurMetier: `competition_perimee` (409) si `version` n'est plus celle de
            la base ; `fin_avant_debut` (422).
    """
    uid = claims["uid"]
    if not is_coach(uid):
        raise ErreurMetier("reserve_aux_coachs", status.HTTP_403_FORBIDDEN, "réservé aux coachs")

    provided = payload.model_dump(exclude_none=True, exclude={"version"})
    with get_session() as session:
        metier.exiger_sa_structure(session, uid, comp_id)
        row = metier.select_comp(session, legacy=comp_id)
        if row is None:
            raise ErreurMetier("competition_introuvable", status.HTTP_404_NOT_FOUND, "compétition introuvable")
        # ⚠️ Seulement si elle n'a pas bougé depuis sa lecture (FRE-162). Relue DANS
        # la transaction d'écriture, et APRÈS le verrou de `select_comp` : lue avant,
        # elle laisserait la fenêtre qu'elle prétend fermer. AVANT toute écriture :
        # un refus ne laisse rien derrière lui.
        if payload.version != metier.version_actuelle(session, comp_id):
            raise ErreurMetier(
                "competition_perimee", status.HTTP_409_CONFLICT,
                "la compétition a changé depuis sa lecture — recharger avant d'enregistrer",
            )
        cid, _created_by, existing_start, existing_end = row
        existing_start, existing_end = metier.iso(existing_start), metier.iso(existing_end)

        # --- Toutes les validations AVANT toute écriture (422 ⟹ rien de partiel) ---
        if "movementNames" in provided:
            metier.validate_competition_movements(session, payload.movementNames, metier.structure_de_comp(session, legacy=comp_id))

        dates_changed = "startDate" in provided or "endDate" in provided
        new_start = payload.startDate if payload.startDate is not None else existing_start
        new_end = payload.endDate if payload.endDate is not None else existing_end
        if dates_changed and new_end < new_start:
            raise ErreurMetier("fin_avant_debut", status.HTTP_422_UNPROCESSABLE_CONTENT, "endDate ne peut pas précéder startDate")
        eff_start, eff_end = (new_start, new_end) if dates_changed else (existing_start, existing_end)

        mv_changed = "movementNames" in provided
        parts_changed = "participants" in provided
        internal = None
        if parts_changed:  # nouveaux participants → contre la plage effective
            internal = metier.participants_to_internal(payload.participants, metier.athlete_map(session))
            metier.validate_competes_on([(p["name"], p["competes_on"]) for p in internal], eff_start, eff_end)
            metier.validate_weight_categories(session, internal)
            metier.validate_attempt_norep(internal)
            metier.validate_annonces_croissantes(internal)
        elif dates_changed:  # participants non touchés mais la plage bouge → garde-fou rétrécissement
            pairs = [
                (n, metier.iso(co))
                for n, co in metier.jours_de_passage(session, cid)
            ]
            metier.validate_competes_on(pairs, eff_start, eff_end)

        if payload.flights is not None:
            metier.validate_flights(session, payload.flights)

        # ⚠️ ICI, avec les autres validations, AVANT `metier.clear_children` : une
        # fois les enfants supprimés, refuser ne rend plus les essais.
        movement_names = None
        if mv_changed or parts_changed:
            movement_names = payload.movementNames if mv_changed else metier.load_movement_names(session, cid)
            # Participants non fournis → ceux de la base, qui portent leurs essais :
            # c'est le cas du `PATCH movementNames` seul, celui que le garde vise.
            if internal is None:
                internal = metier.load_participants_internal(session, cid)
            metier.valider_essais_conserves(movement_names, internal)

        # --- Écritures ---
        set_clauses, params = [], {"cid": cid}
        if "name" in provided:
            set_clauses.append("name = :name")
            params["name"] = payload.name
        if "location" in provided:
            set_clauses.append("location = :location")
            params["location"] = payload.location
        if "maxAttempts" in provided:
            set_clauses.append("max_attempts = :max_attempts")
            params["max_attempts"] = payload.maxAttempts
        if dates_changed:
            set_clauses += ["start_date = :start_date", "end_date = :end_date"]
            params["start_date"], params["end_date"] = new_start, new_end
        if set_clauses:
            metier.ecrire_la_competition(session, set_clauses, params)

        if mv_changed or parts_changed:
            metier.clear_children(session, cid)
            metier.write_children(session, cid, movement_names, internal)
        if payload.flights is not None:
            metier.replace_flights(session, cid, payload.flights)

        # Relue plutôt que recalculée de ce qui a été reçu : c'est ce que la
        # prochaine lecture rendra, donc ce que la prochaine écriture comparera.
        nouvelle = metier.version_actuelle(session, comp_id)

    log_write(uid=uid, resource="competition", doc_path=f"competitions/{comp_id}",
              fields=sorted(provided.keys()))
    return {"ok": True, "written": sorted(provided.keys()), "version": nouvelle}


@router.delete("/{comp_id}", response_model=ObjetSupprime, responses=erreurs(401, 403, 404))
def delete_competition(
    comp_id: IdentifiantDeChemin,
    claims: dict = Depends(verify_token),
) -> dict:
    """Supprime une compétition — tout coach de sa structure, comme créer et éditer (FRE-85).

    ⚠️ PAS le créateur seul : le front offre le bouton à tout coach, et il ne
    propose une écriture que là où brokkr l'accepte. On n'arbitre pas entre
    membres du staff par le code.

    `created_by` ne décide donc pas de qui supprime, mais reste une DONNÉE : exposé
    en lecture, et la FK RESTRICT qui empêche de rétrograder un coach propriétaire
    de compétitions (`users.py`) s'appuie dessus.

    Les enfants sont supprimés explicitement, puis la compétition : portable, sans
    dépendre du CASCADE.
    """
    uid = claims["uid"]
    if not is_coach(uid):
        raise ErreurMetier("reserve_aux_coachs", status.HTTP_403_FORBIDDEN, "réservé aux coachs")

    with get_session() as session:
        metier.exiger_sa_structure(session, uid, comp_id)
        row = metier.select_comp(session, legacy=comp_id)
        if row is None:
            raise ErreurMetier("competition_introuvable", status.HTTP_404_NOT_FOUND, "compétition introuvable")
        cid = row[0]
        metier.clear_children(session, cid)
        metier.clear_flights(session, cid)
        metier.del_comp(session, cid=cid)

    log_write(uid=claims["uid"], resource="competition", doc_path=f"competitions/{comp_id}",
              fields=[], status="deleted")
    return {"ok": True, "deleted": comp_id}


@router.get("", response_model=list[CompetitionLue], response_model_exclude_unset=True, responses=erreurs(401, 403))
def list_competitions(
    claims: dict = Depends(require_membre),
    structure: str | None = Query(default=None, max_length=64,
                                  description="Borne la liste à une structure (FRE-13) ; absente = toutes"),
) -> list:
    """Les compétitions visibles par l'appelant.

    ⚠️ PAR STRUCTURE (FRE-13). Un coach voit celles de la structure où il COACHE,
    l'admin voit tout. Chacun voit en plus celles où il CONCOURT, et celles où
    concourt un athlète qu'il coache — même dans une autre structure.

    `?structure=` est le filtre de VUE de la structure sélectionnée, appliqué
    APRÈS l'autorisation : il ne peut que retirer.

    Le filtre en Python après recomposition suffit à l'échelle du club. Si le
    volume grandit, filtrer en SQL plutôt que de tout recomposer.
    """
    uid = claims["uid"]
    with get_session() as session:
        comps = metier.recompose_all(session)
        structure_de = metier.structure_par_competition(session)
        coache_dans = metier.structure_du_coach(session, uid=uid)
        # Celles où concourt un athlète que je coache — le meet partagé.
        mes_athletes_y_sont = metier.competitions_de_mes_athletes(session, uid)
    admin = is_admin(uid)
    visibles = [
        c for c in comps
        if admin
        or (coache_dans is not None and structure_de.get(c["id"]) == coache_dans)
        or uid in (c.get("participantUids") or [])
        or c["id"] in mes_athletes_y_sont
    ]
    if structure is not None:
        visibles = [c for c in visibles if structure_de.get(c["id"]) == structure]
    return visibles


@router.get("/{comp_id}/athletes", response_model=list[AthleteInscriptible], responses=erreurs(401, 403, 404))
def get_athletes_inscriptibles(comp_id: IdentifiantDeChemin, claims: dict = Depends(verify_token)) -> list[dict]:
    """Les athlètes que ce coach peut inscrire : TOUS ceux de la structure (FRE-190).

    Sur un plateau, tous les coachs gèrent tous les inscrits, et l'écriture le
    permet déjà (`put_competition`) : la liste proposée suit, au lieu de se
    limiter aux athlètes de l'appelant.

    Raises:
        ErreurMetier: `reserve_aux_coachs` (403) ; `competition_introuvable` (404)
            hors de sa structure, ou absente.
    """
    uid = claims["uid"]
    if not is_coach(uid) and not is_admin(uid):
        raise ErreurMetier("reserve_aux_coachs", status.HTTP_403_FORBIDDEN, "réservé aux coachs")
    with get_session() as session:
        if metier.structure_de_comp(session, legacy=comp_id) is None:
            raise ErreurMetier("competition_introuvable", status.HTTP_404_NOT_FOUND, "compétition introuvable")
        metier.exiger_sa_structure(session, uid, comp_id)
        return metier.athletes_inscriptibles(session, legacy=comp_id)


@router.get("/{comp_id}/availability", response_model=list[LigneDeMatrice], responses=erreurs(401, 403, 404))
def get_availability(comp_id: IdentifiantDeChemin, claims: dict = Depends(require_membre)) -> list[dict]:
    """La matrice coach × jour, comblée à `pending`.

    Lisible par tout MEMBRE de la structure, athlètes compris : savoir qui encadre
    n'est pas sensible entre membres, et ils ont un intérêt direct à le voir.

    ⚠️ « MEMBRE », pas « authentifié » (FRE-141) : Firebase n'impose aucun domaine,
    « authentifié » veut dire « existe chez Google ». Et cette route énumère les
    coachs avec leur nom — ou leur ADRESSE E-MAIL en repli.
    """
    with get_session() as session:
        metier.exiger_de_la_voir(session, claims["uid"], comp_id)
        row = metier.competition_row(session, comp_id)
        stored = {
            (r.coach_uid, metier.iso(r.day)): r.status
            for r in metier.avail(session, cid=row.id)
        }
        # ⚠️ Les coachs de SA structure, et ceux de ses PARTICIPANTS (FRE-13) : un
        # coach d'ailleurs n'a rien à déclarer ici, sauf si un de ses athlètes y
        # concourt.
        coaches = metier.coachs_de_la_comp(session, cid=row.id)
        return [
            {
                "coachUid": coach.uid,
                "coachName": coach.name,
                "day": day,
                "status": stored.get((coach.uid, day), "pending"),
            }
            for coach in coaches
            for day in metier.days(row.start_date, row.end_date)
        ]


# UN SEUL SEGMENT, volontairement : « /{coach_uid}/availability » entrerait en
# collision avec « /{comp_id}/availability ».
@router.get("/coach-availability", response_model=list[DispoDeCoach], responses=erreurs(401, 403))
def get_coach_availability(
    coachUid: str, claims: dict = Depends(require_membre)  # noqa: N803 (camelCase côté API)
) -> list[dict]:
    """Les disponibilités déclarées par UN coach, toutes compétitions confondues (FRE-25).

    La matrice répond à « qui vient à celle-ci ? » ; cette route à « à quelles
    compétitions va CE coach ? », la question du calendrier : celles où il ENCADRE.

    Le coach est un PARAMÈTRE, pas le porteur du jeton : un calendrier décrit
    celui qu'on regarde, jamais celui qui regarde. Lisible par tout membre, mais
    ⚠️ bornée aux structures de l'APPELANT (`COACH_AVAIL_SQL`).

    Renvoie le STATUT, pas les seuls jours retenus : le calendrier ne montre que
    les `available`, et le front filtre — un rappel « tu n'as pas répondu » reste
    possible sans changer le contrat.

    Seules les lignes RÉELLEMENT déclarées sortent, sans matrice comblée : « il
    n'a rien dit » se lit comme une absence.
    """
    with get_session() as session:
        return [
            {"competitionId": r.competition_id, "day": metier.iso(r.day), "status": r.status}
            for r in metier.coach_avail(session, uid=coachUid, structures=sorted(slugs_de(claims["uid"])))
        ]


@router.put("/{comp_id}/availability", response_model=Confirmation, responses=erreurs(400, 401, 403, 404))
def put_availability(
    comp_id: IdentifiantDeChemin,
    payload: CoachAvailabilityPut,
    claims: dict = Depends(verify_token),
) -> dict:
    """Déclare la disponibilité d'un coach pour un jour de la compétition.

    Réservé aux coachs, sans notion de propriétaire : tout coach de la MATRICE
    déclare pour tout coach de la matrice — le tableau se remplit collectivement.

    Raises:
        ErreurMetier: `reserve_aux_coachs` (403) ; `competition_introuvable` (404)
            hors de la matrice ; `jour_hors_competition`, `coach_inconnu` (400).
    """
    uid = claims["uid"]
    with get_session() as session:
        if not is_coach(uid):
            raise ErreurMetier("reserve_aux_coachs", status.HTTP_403_FORBIDDEN, "réservé aux coachs")
        row = metier.competition_row(session, comp_id)
        # ⚠️ FIGURER DANS LA MATRICE, pas coacher dans sa structure (FRE-13) : le
        # coach d'un participant venu d'ailleurs se déclare sur le meet partagé.
        # Hors de la matrice, la compétition n'existe pas pour lui — 404.
        matrice = {c.uid for c in metier.coachs_de_la_comp(session, cid=row.id)}
        if uid not in matrice and not is_admin(uid):
            raise ErreurMetier("competition_introuvable", status.HTTP_404_NOT_FOUND, "compétition introuvable")

        # Un jour hors de la compétition n'a pas de sens et créerait une ligne
        # que l'affichage (borné aux jours de l'épreuve) ne montrerait jamais.
        if payload.day not in metier.days(row.start_date, row.end_date):
            raise ErreurMetier("jour_hors_competition", 
                status.HTTP_400_BAD_REQUEST,
                f"{payload.day} n'est pas un jour de cette compétition",
            )
        # Un coach DE LA MATRICE (FRE-13) — de sa structure, ou d'un de ses
        # participants : une ligne pour un autre serait écrite et jamais lue.
        if payload.coachUid not in matrice:
            raise ErreurMetier("coach_inconnu", status.HTTP_400_BAD_REQUEST, "coach inconnu")

        metier.upsert_avail(session, cid=row.id, uid=payload.coachUid, day=payload.day, status=payload.status)
    log_write(uid=uid, resource="competition_availability", doc_path=f"competitions/{comp_id}",
              fields=["coach_uid", "day", "status"])
    return {"ok": True}
