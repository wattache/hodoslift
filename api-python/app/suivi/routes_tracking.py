"""Le suivi de progression : lecture de la projection `training_sets`.

Sert le graphe « Tracking » : par semaine et pour UN mouvement, la charge max,
le tonnage AU top set (il distingue deux vagues montant aux mêmes charges), le
tonnage total, les séances. Le SQL vit dans `metier_tracking.py`.

⚠️ `training_sets` est une PROJECTION, reconstruite chaque nuit
(`scripts/etl_training_sets.py`) : `lastSessionDate` dit au front jusqu'où va la
donnée. Les records et la forme du jour lisent les tables VIVANTES.

AUTZ — l'athlète ou son staff (`owner_or_staff`), la règle commune.
"""

from fastapi import APIRouter, Depends, Query

from app.socle.erreurs import erreurs
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.entrainement.records import lire_records
from app.suivi.schemas_tracking import PointDeForme, RecordLu, SuiviLu
from app.suivi import metier_tracking as metier

router = APIRouter(prefix="/athletes/{athlete_id}/tracking", tags=["tracking"])


# La dépendance COMMUNE, pas une vérification maison : elle teste le LIEN
# (`coach_uid` est-il l'appelant ?), pas le RÔLE — avec `is_coach`, n'importe
# quel coach passerait.
_acces = require_athlete_access("owner_or_staff")


@router.get("", response_model=SuiviLu, responses=erreurs(401, 403, 404))
def get_tracking(
    exercise: str | None = Query(default=None),
    access: AthleteAccess = Depends(_acces),
) -> dict:
    """Rend le suivi hebdomadaire d'un mouvement.

    Sans `exercise`, c'est le plus travaillé : le front n'a pas à connaître le
    catalogue pour un premier rendu.
    """
    legacy = access.athlete_id
    with get_session() as session:
        exercises = [
            {"name": r.exercise, "count": r.n}
            for r in metier.exercises(session, legacy=legacy)
        ]
        selected = metier.pick_exercise(exercises, exercise)
        if selected is None:
            return {"exercise": None, "exercises": [], "weeks": [], "courbes": [], "athleteWeeks": [],
                    "rpeBlocks": [], "lastSessionDate": None, "oneRmKg": None,
                    "setsByMovement": []}

        rows = metier.weeks(session, legacy=legacy, exercise=selected)
        courbes = metier.courbes_par_combinaison(metier.courbes(session, legacy=legacy, exercise=selected))
        last = metier.last_session(session, legacy=legacy)
        # 1RM du mouvement, si c'en est un qui en a un. 0 = non renseigné → None.
        rm_key = metier.one_rm_key(selected)
        one_rm = (
            metier.one_rm(session, key=rm_key, legacy=legacy)
            if rm_key else None
        )
        one_rm = float(one_rm) if one_rm else None
        athlete_rows = metier.athlete_weeks(session, legacy=legacy)
        block_rows = metier.rpe_blocks(session, legacy=legacy)
        series_rows = metier.series_par_lift(session, legacy=legacy)

    return {
        "exercise": selected,
        "exercises": exercises,
        "lastSessionDate": last.isoformat() if last else None,
        "oneRmKg": one_rm,
        # Calibrage RPE par bloc (tous mouvements) — graphe autonome.
        "rpeBlocks": [
            {
                "macroNumber": r.macro_number,
                "blockNumber": r.block_number,
                "from": r.from_date.isoformat() if r.from_date else None,
                "to": r.to_date.isoformat() if r.to_date else None,
                "weeks": r.weeks,
                "feltRpe": metier.num(r.felt_rpe),
                "aimedRpe": metier.num(r.aimed_rpe),
                "gap": metier.num(r.gap),
                "rated": r.rated,
            }
            for r in block_rows
        ],
        # RPE global de l'athlète (tous mouvements), timeline complète.
        "athleteWeeks": [
            {
                "week": r.semaine.isoformat(),
                "feltRpe": metier.num(r.felt_rpe),
                "aimedRpe": metier.num(r.aimed_rpe),
                "sessions": r.sessions,
                "macroNumber": r.macro_number,
                "blockNumber": r.block_number,
            }
            for r in athlete_rows
        ],
        # Les séries de TOUS les lifts de compétition (FRE-148) — la question
        # inverse de `weeks` : comparer les mouvements plutôt qu'en creuser un.
        "setsByMovement": [
            {
                "week": r.semaine.isoformat(),
                "movement": r.mouvement,
                "setsDone": r.sets_faits,
                "setsPlanned": r.sets_prescrits,
            }
            for r in series_rows
        ],
        # UNE COURBE PAR (variante, tempo, format), la plus travaillée d'abord
        # (FRE-182). `weeks` reste le mouvement ENTIER : le volume, le 1RM et le
        # RPE se lisent toujours sur lui.
        "courbes": courbes,
        "weeks": [
            {
                "week": r.semaine.isoformat(),
                "chargeMaxKg": metier.num(r.charge_max_kg),
                "tonnageAtMaxKg": metier.num(r.tonnage_at_max_kg),
                "topSetFormat": r.top_set_format,
                "tonnageTotalKg": metier.num(r.tonnage_total_kg),
                "tonnagePrevuTotalKg": metier.num(r.tonnage_prevu_total_kg),
                "repsPrevuTotal": metier.num(r.reps_prevu_total),
                "repsTotal": metier.num(r.reps_total),
                "feltRpe": metier.num(r.felt_rpe),
                "aimedRpe": metier.num(r.aimed_rpe),
                "sessions": r.sessions,
                "fails": r.fails,
                "failsAtMax": r.fails_at_max,
                "macroNumber": r.macro_number,
                "blockNumber": r.block_number,
            }
            for r in rows
        ],
    }


# ⚠️ Un routeur À PART, pas une route de plus sous `/tracking` : les records se
# calculent sur les tables VIVANTES, pas sur la projection. Sous le même préfixe,
# ils laisseraient croire qu'ils partagent le retard du suivi (jusqu'à une nuit).
records_router = APIRouter(prefix="/athletes/{athlete_id}", tags=["tracking"])


@records_router.get("/records", response_model=list[RecordLu],
                    responses=erreurs(401, 403, 404))
def get_records(access: AthleteAccess = Depends(_acces)) -> list:
    """Rend la meilleure charge par mouvement et par nombre de répétitions.

    ⚠️ Le calcul est ICI et pas au front : le front n'a pas à recevoir l'arbre
    entier pour remplir une grille, ni à porter une seconde définition de
    « réalisé » (`app/entrainement/records.py`).

    Sur les tables vivantes : un PR apparaît à la seconde où l'athlète note son
    RPE.
    """
    with get_session() as session:
        programme = metier.programme_de_l_athlete(session, access.athlete_id)
        if programme is None:
            # Un athlète sans programme n'a pas de records — pas une erreur.
            return []
        return lire_records(session, programme)


@records_router.get("/forme-du-jour", response_model=list[PointDeForme],
                    responses=erreurs(401, 403, 404))
def get_forme_du_jour(
    depuis: str = Query(description="Date ISO — premier jour retenu, incluse"),
    access: AthleteAccess = Depends(_acces),
) -> list:
    """Les formes du jour saisies depuis une date, une par séance notée.

    ⚠️ Calculé ICI, comme les records : le front n'a pas à recevoir l'arbre
    entier pour en tirer trente points, ni à porter la règle de date
    (`metier.FORME_DU_JOUR`).

    ⚠️ Sur les tables VIVANTES, pas sur la projection : une forme saisie il y a
    dix minutes apparaît tout de suite. `training_sets` ne la porte d'ailleurs
    pas.

    `depuis` est INCLUSE. Une séance sans aucune date — ni la sienne, ni celle de
    sa semaine — est écartée : `NULL >= date` n'est pas vrai, et une forme qu'on
    ne sait pas dater ne se place sur aucune courbe.
    """
    with get_session() as session:
        return [{"date": r["jour"].isoformat(), "form": r["forme"]}
                for r in metier.forme_du_jour(session, legacy=access.athlete_id, depuis=depuis)]
