"""Le suivi de poids par semaine : le départ se pose, les semaines se lisent."""
from datetime import date

from fastapi import APIRouter, Depends, status

from app.socle.audit import log_write
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.socle.erreurs import ErreurMetier, erreurs
from app.socle.schemas_ecriture import Confirmation
from app.suivi import metier_poids
from app.suivi.schemas_poids import PoidsDepartEcrit, PoidsSemainesLu

router = APIRouter(prefix="/athletes/{athlete_id}/poids", tags=["poids"])


def _fiche(conn, legacy_id: str) -> dict:
    fiche = metier_poids.lire_depart(conn, legacy_id)
    if fiche is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND, "athlète inconnu en base SQL")
    return fiche


@router.get("/semaines", response_model=PoidsSemainesLu, responses=erreurs(401, 403, 404))
def semaines(access: AthleteAccess = Depends(require_athlete_access("owner_or_staff"))) -> dict:
    """Le tableau par semaine : moyenne des pesées, écart depuis le départ, et
    la droite vers la pesée de la prochaine compétition (sa catégorie)."""
    aujourdhui = date.today()
    with get_session() as conn:
        fiche = _fiche(conn, access.athlete_id)
        depart = fiche["depart"]
        cible = metier_poids.lire_cible(conn, fiche["id"], aujourdhui)
        depuis = depart["date"] if depart else aujourdhui - metier_poids.FENETRE_SANS_DEPART
        pesees = metier_poids.lire_pesees(conn, fiche["id"], depuis, aujourdhui)
    calcul = metier_poids.semaines(pesees, depart=depart, cible=cible, aujourdhui=aujourdhui)
    return {"depart": depart, "cible": cible, **calcul}


@router.put("/depart", response_model=Confirmation, responses=erreurs(401, 403, 404))
def poser_depart(payload: PoidsDepartEcrit,
                 access: AthleteAccess = Depends(require_athlete_access("owner_or_staff"))) -> dict:
    """Le point zéro : l'athlète le pose lui-même, ou son coach.

    Raises:
        ErreurMetier: `date_future` (422) — un départ ne s'anticipe pas."""
    if payload.date > date.today():
        raise ErreurMetier("date_future", status.HTTP_422_UNPROCESSABLE_CONTENT, "le départ ne peut pas être dans le futur")
    with get_session() as conn:
        _fiche(conn, access.athlete_id)
        metier_poids.poser_depart(conn, access.athlete_id, kg=payload.kg, le=payload.date)
    log_write(uid=access.claims["uid"], resource="athlete_poids_depart",
              doc_path=f"athletes/{access.athlete_id}/poids/depart", fields=["kg", "date"])
    return {"ok": True}


@router.delete("/depart", response_model=Confirmation, responses=erreurs(401, 403, 404))
def effacer_depart(access: AthleteAccess = Depends(require_athlete_access("owner_or_staff"))) -> dict:
    with get_session() as conn:
        _fiche(conn, access.athlete_id)
        metier_poids.effacer_depart(conn, access.athlete_id)
    log_write(uid=access.claims["uid"], resource="athlete_poids_depart",
              doc_path=f"athletes/{access.athlete_id}/poids/depart", fields=["delete"])
    return {"ok": True}
