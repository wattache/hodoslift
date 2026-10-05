"""Point d'entrée FastAPI de brokkr."""

import logging
import time
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.socle import erreurs, observabilite
from app.socle.config import settings
from app.socle.logging_config import request_id_var, setup_logging
from app.socle import routes_health
from app.personnes import routes_athlete_profile, routes_athletes, routes_coach_profiles, routes_events, routes_users
from app.entrainement import routes_programs, routes_training_lines, routes_training_structure
from app.suivi import (routes_daily_logs, routes_douleurs, routes_guichet, routes_poids, routes_prs,
                       routes_tracking)
from app.competitions import routes_competitions, routes_weight_categories
from app.kine import routes_bilan_medias, routes_bilan_modeles, routes_bilans, routes_kine_notes, routes_kines
from app.objectifs import routes_goals, routes_objectifs_techniques
from app.bibliotheque import routes_library
from app.notifications import routes_push

setup_logging()

# ⚠️ AVANT la création de l'app : le SDK doit être en place quand FastAPI monte
# ses intégrations, sinon les exceptions des premières requêtes lui échappent.
# Sans DSN, l'appel ne fait rien — c'est ce qui garde les tests muets.
observabilite.installer()

logger = logging.getLogger(__name__)

app = FastAPI(
    title="brokkr",
    description="Le forgeron : l'API de French Forge Trainer — FastAPI, Postgres (Neon), Firebase Auth.",
    version="0.1.0",
)

# ⚠️ La forme d'erreur unique (FRE-40), posée AVANT CORS : `add_middleware` empile
# vers l'extérieur, et le filet d'`erreurs.installer` doit rester SOUS CORS pour
# que sa réponse en porte les en-têtes. Sans cet appel, une exception sort sous la
# forme par défaut de FastAPI, et le front n'a que le statut HTTP pour décider.
erreurs.installer(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.regex_d_origines,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _request_id_middleware(request: Request, call_next):
    """Pose l'ID de requête dans le contexte et loggue la fin de chaque appel."""
    trace_header = request.headers.get("X-Cloud-Trace-Context")
    if trace_header:
        # Format Cloud Run : "TRACE_ID/SPAN_ID;o=FLAG" — on ne garde que le TRACE_ID.
        request_id = trace_header.split("/")[0]
    else:
        request_id = str(uuid4())

    token = request_id_var.set(request_id)
    t0 = time.monotonic()
    try:
        response = await call_next(request)
        duration_ms = round((time.monotonic() - t0) * 1000, 1)
        response.headers["X-Request-Id"] = request_id
        logger.info(
            "%s %s %d %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response
    finally:
        request_id_var.reset(token)


app.include_router(routes_health.router)
app.include_router(routes_daily_logs.router)
# Le suivi de poids par semaine (29/09) : le départ se pose, les semaines se lisent.
app.include_router(routes_poids.router)
app.include_router(routes_douleurs.router)
app.include_router(routes_library.router)
app.include_router(routes_events.router)
app.include_router(routes_goals.router)
app.include_router(routes_prs.router)
app.include_router(routes_athletes.router)
app.include_router(routes_users.router)
# Les notifications push (28/09) : l'abonnement de l'appelant, et la clé publique.
app.include_router(routes_push.router)
app.include_router(routes_athlete_profile.router)
app.include_router(routes_coach_profiles.router)
app.include_router(routes_competitions.router)
app.include_router(routes_weight_categories.router)
app.include_router(routes_programs.router)
app.include_router(routes_tracking.router)
# Les records : tables VIVANTES, pas la projection — un PR s'affiche à la seconde.
app.include_router(routes_tracking.records_router)
# Écriture au grain de la LIGNE (FRE-12) : la voie normale. Le remplacement en
# bloc d'une semaine (`PUT .../weeks/{id}/content`, training_structure) est une
# ROUTE-OUTIL : sans appelant dans eitri, elle sert les fixtures et le harnais
# réel (FRE-142).
app.include_router(routes_training_lines.router)
app.include_router(routes_training_structure.router)
# Le répertoire des kinés (FRE-65) : une lecture, pour le sélecteur du coach.
app.include_router(routes_kines.router)
# Les MODÈLES de bilan — ce que la kiné compose. `require_kine` partout, lectures
# comprises : décider quels tests cliniques existent est un acte de praticien.
app.include_router(routes_bilan_modeles.router)
# Le BILAN d'un athlète. ⚠️ SEUL DOMAINE EN `owner_or_kine` : le coach en est
# exclu, un bilan portant des antécédents et des pathologies (bilan-kine.md §8).
app.include_router(routes_bilan_medias.router)
app.include_router(routes_bilans.router)
app.include_router(routes_kine_notes.router)
# Les OBJECTIFS TECHNIQUES par mouvement (FRE-122). ⚠️ LECTURE et ÉCRITURE
# n'ont pas le même mode : `owner_or_staff` d'un côté, `coach` de l'autre —
# l'athlète lit une consigne, il ne la réécrit pas.
app.include_router(routes_objectifs_techniques.router)
# Le GUICHET du coach : la file de travail, en UNE route — trois requêtes, quel
# que soit le nombre d'athlètes. Aucune garde de rôle : c'est le lien qui décide,
# et qui ne staffe personne reçoit une file vide.
app.include_router(routes_guichet.router)