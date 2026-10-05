"""Le guichet du coach : la file de travail qui se vide.

L'écran d'accueil sert UN dossier à la fois — douleur, séance à relire, semaine
à écrire — avec de quoi le traiter sans quitter la page. L'écran vide est la
réussite.

⚠️ UNE route, QUATRE requêtes, quel que soit le nombre d'athlètes
(`test_guichet.py` les compte) : le front ne déduit rien par un appel par athlète.
⚠️ Le LIEN décide, pas le rôle ; l'ORDRE se décide ici, pas à l'écran ; les
bornes sont des FAITS, pas des dates de semaine (FRE-179). Détail sur chaque SQL.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.socle.auth import verify_token
from app.socle.db import get_session
from app.socle.erreurs import erreurs
from app.entrainement.records import TRACE_ARBRE
from app.entrainement.relecture import A_RELIRE_SQL, MISE_EN_SERVICE
from app.suivi.schemas_guichet import Guichet

router = APIRouter(prefix="/guichet", tags=["guichet"])

# ⚠️ Le LIEN décide, pas le rôle : le coach du programme, ou le kiné de son
# athlète — ceux que `require_program_access("coach")` laisse relire. La route
# n'a ni paramètre d'athlète ni garde `require_coach` : qui ne staffe personne
# reçoit une file VIDE en 200, pas un refus.
_STAFF_DU_PROGRAMME = "(p.coach_uid = :uid OR a.kine_uid = :uid)"

# ⚠️ Warmup et rehab sont dans la LISTE, pas dans les MESURES — le même partage
# que `metier_tracking.py`. Un échauffement chargé déplace un poids réel, mais
# le tonnage qu'on vient juger est celui du travail.
_TRAVAIL = "coalesce(x.kind, 'training') = 'training'"

# LE DOSSIER SÉANCE — les séances RÉALISÉES que ce lecteur n'a pas encore relues.
#
# ⚠️ Calculé EN DIRECT, pas depuis `training_sets` : la projection est
# reconstruite la nuit, et la séance finie aujourd'hui — celle que la file doit
# servir — n'y est pas. Les mesures viennent des fonctions SQL partagées
# (`ff_series_tenues`, `ff_tonnage`, `ff_rpe`) et de `TRACE_ARBRE`, LA définition
# de « réalisé » : ne pas en écrire une seconde ici.
#
# ⚠️ La borne est le MARQUEUR D'ÉCRITURE (`modifiee_le >= MISE_EN_SERVICE`), pas
# une date de semaine (FRE-179). Les générateurs n'écrivent pas `session_date`,
# et on n'attend pas lundi pour faire la séance de lundi : une date de semaine ne
# dit pas si la trace est récente. L'historique, sans marqueur, sort de lui-même
# (voir `relecture.py`). La date de garde ne sert qu'à SITUER la séance à l'écran.
#
# `EXISTS (… TRACE_ARBRE)` et non un JOIN filtrant : une séance est UN dossier,
# quel que soit le nombre de ses lignes réalisées.
_SEANCES_SQL = text(f"""
    WITH candidates AS (
        SELECT s.id AS session_id, s.name AS session_name, w.id AS week_id,
               w.number AS week_number, coalesce(b.name, '') AS block_name,
               m.program_id, a.legacy_id, a.first_name, a.last_name,
               -- Pour SITUER la séance à l'écran, pas pour la borner.
               coalesce(s.session_date, w.start_date) AS date_garde,
               s.modifiee_le
          FROM training_sessions s
          JOIN training_weeks  w ON w.id = s.week_id
          JOIN training_blocks b ON b.id = w.block_id
          JOIN training_macros m ON m.id = b.macro_id
          JOIN programs        p ON p.id = m.program_id
          JOIN athletes        a ON a.id = p.athlete_id
         WHERE {_STAFF_DU_PROGRAMME}
           AND a.archive_le IS NULL
           -- ⚠️ LA BORNE EST LE MARQUEUR, PAS LA DATE DE LA SEMAINE (FRE-179).
           -- Et AUCUNE garde « pas dans le futur » : une semaine préparée
           -- d'avance qui porte une trace posée après la mise en service a été
           -- faite, tout simplement — on n'attend pas lundi pour faire la séance
           -- de lundi. La première version excluait les deux, et cachait toute
           -- la semaine en cours (voir l'en-tête du module).
           AND s.modifiee_le >= :depuis
           AND {A_RELIRE_SQL}
           AND EXISTS (SELECT 1 FROM training_exercises x
                        WHERE x.session_id = s.id AND {TRACE_ARBRE})
    )
    SELECT c.*,
           mesures.series_tenues, mesures.series_total, mesures.tonnage_kg,
           mesures.rpe_ressenti, mesures.rpe_vise,
           lignes.exercices, lignes.retours
      FROM candidates c
      -- Les trois mesures, sur le TRAVAIL seul.
      JOIN LATERAL (
          SELECT coalesce(sum(ff_series_tenues(x.sets, x.felt_rpe_by_set)), 0)::int AS series_tenues,
                 coalesce(sum(round(ff_num(x.sets))), 0)::int                      AS series_total,
                 sum(ff_tonnage(x.sets, x.reps, x.reps_done, x.reps_unit,
                                x.weight, x.weight_done,
                                x.felt_rpe_by_set, x.reps_done_by_set, x.weight_done_by_set)) AS tonnage_kg,
                 avg(ff_rpe(x.felt_rpe))  AS rpe_ressenti,
                 avg(ff_rpe(x.aimed_rpe)) AS rpe_vise
            FROM training_exercises x
           WHERE x.session_id = c.session_id AND {_TRAVAIL}
      ) mesures ON true
      -- La liste, TOUTES lignes, dans l'ordre de la séance.
      JOIN LATERAL (
          SELECT coalesce(json_agg(json_build_object(
                     'name', x.name,
                     'charge', coalesce(nullif(btrim(x.weight_done), ''), nullif(btrim(x.weight), '')),
                     'rpe', nullif(btrim(x.felt_rpe), ''),
                     'seriesTenues', ff_series_tenues(x.sets, x.felt_rpe_by_set),
                     'seriesTotal', round(ff_num(x.sets))::int
                 ) ORDER BY x.position) FILTER (WHERE btrim(coalesce(x.name, '')) <> ''), '[]'::json) AS exercices,
                 coalesce(json_agg(nullif(btrim(x.athlete_feedback), '') ORDER BY x.position)
                          FILTER (WHERE nullif(btrim(x.athlete_feedback), '') IS NOT NULL), '[]'::json) AS retours
            FROM training_exercises x
           WHERE x.session_id = c.session_id
      ) lignes ON true
     -- De la plus anciennement ÉCRITE à la plus récente : l'ordre du fait.
     ORDER BY c.modifiee_le, c.first_name, c.last_name, c.session_id
""")

# LE DOSSIER DOULEUR — les signalements que CE lecteur n'a pas cochés, ou qui ont
# bougé depuis sa coche. La coche est PAR LECTEUR (`signalement_vu`) : le kiné
# qui coche ne vide pas la file du coach.
#
# ⚠️ La séance du jour est une JOINTURE, pas un appel de plus depuis l'écran —
# et « du jour » se résout par la date de garde, `session_date` étant souvent
# NULL.
# ⚠️ LA SOURCE EST `douleur_logs` DEPUIS FRE-195, plus le bloc libre de
# `daily_logs`. Et l'agrégation par (athlète, jour) n'est pas cosmétique : la
# COCHE porte cette clé-là, donc deux douleurs notées le même jour doivent faire
# UNE ligne — sinon une seule coche en ferait disparaître deux.
_DOULEURS_SQL = text("""
    SELECT a.legacy_id, a.first_name, a.last_name, l.log_date,
           (SELECT p.id FROM programs p WHERE p.athlete_id = a.id ORDER BY p.id LIMIT 1) AS program_id,
           jsonb_agg(jsonb_build_object(
               'id', d.id::text, 'nom', d.nom, 'zone', d.zone,
               'intensite', l.intensite, 'commentaire', l.commentaire,
               'logs', (SELECT count(*) FROM douleur_logs x WHERE x.douleur_id = d.id),
               'recurrente', (SELECT count(*) FROM douleur_logs x WHERE x.douleur_id = d.id) > 1
           ) ORDER BY l.intensite DESC, d.nom) AS douleurs,
           max(l.modifie_le) AS note_le,
           sj.session_id, sj.week_id, sj.program_id AS sj_program_id, sj.session_name
      FROM douleur_logs l
      JOIN douleurs d ON d.id = l.douleur_id
      JOIN athletes a ON a.id = d.athlete_id
      LEFT JOIN signalement_vu v
             ON v.athlete_id = a.id AND v.log_date = l.log_date AND v.uid = :uid
      LEFT JOIN LATERAL (
          SELECT s.id AS session_id, w.id AS week_id, m.program_id, s.name AS session_name
            FROM training_sessions s
            JOIN training_weeks  w ON w.id = s.week_id
            JOIN training_blocks b ON b.id = w.block_id
            JOIN training_macros m ON m.id = b.macro_id
            JOIN programs        p ON p.id = m.program_id
           WHERE p.athlete_id = a.id
             AND coalesce(s.session_date, w.start_date) = l.log_date
           ORDER BY s.position, s.id
           LIMIT 1
      ) sj ON true
     WHERE (a.kine_uid = :uid OR a.coach_uid = :uid)
       AND a.archive_le IS NULL
       AND l.log_date >= :depuis
     GROUP BY a.legacy_id, a.first_name, a.last_name, l.log_date, a.id, v.vu_le,
              sj.session_id, sj.week_id, sj.program_id, sj.session_name
     -- ⚠️ « NOTÉ APRÈS COCHÉ » REVIENT DANS LA FILE, et c'est le cœur du guichet :
     -- corriger sa note doit rappeler le staff. Le repère est le plus récent
     -- `modifie_le` des logs du jour, que l'upsert rafraîchit quand on réécrit
     -- la même journée — et non leur date de CRÉATION, qui ne bouge pas.
     HAVING v.vu_le IS NULL OR max(l.modifie_le) > v.vu_le
     ORDER BY l.log_date, a.first_name, a.last_name
""")

# LE DOSSIER SEMAINE — la dernière semaine PROGRAMMÉE du programme est RÉALISÉE,
# et rien n'est écrit après elle.
#
# ⚠️ DES FAITS, PAS DES DATES (FRE-179). Ne pas chercher « une semaine suivante
# existante et vide » : la semaine suivante naît AVEC ses séances
# (`generate-week`, `next-week`), cet état n'existe pas — et une fixture qui le
# fabrique donne une spec verte pour rien.
#
# « RÉALISÉE » = CHAQUE séance porte AU MOINS UNE ligne tracée — pas toutes ses
# lignes : on oublie souvent de remplir les renfos, et la séance a eu lieu.
#
# La dernière programmée se cherche dans le PROGRAMME, pas dans le bloc : un bloc
# fini dont le suivant est déjà généré n'est pas un trou. L'ordre est celui des
# numéros — macro, bloc, semaine — les seuls que le produit garantit.
#
# Pas de coche, pas de date : le dossier sort quand une semaine plus loin reçoit
# une séance. Tri : la plus récemment ÉCRITE d'abord — l'athlète qui vient de
# finir s'entraîne demain, et un dormant descend au fond de la file, où il
# s'archive plutôt qu'il ne se coche.
_SEMAINES_SQL = text(f"""
    WITH mes_semaines AS (
        SELECT w.id, w.number, w.block_id, p.id AS program_id,
               m.number AS macro_number, b.number AS block_number,
               (SELECT count(*) FROM training_sessions s WHERE s.week_id = w.id) AS sessions,
               (SELECT count(*) FROM training_sessions s
                 WHERE s.week_id = w.id
                   AND EXISTS (SELECT 1 FROM training_exercises x
                                WHERE x.session_id = s.id AND {TRACE_ARBRE})) AS tracees,
               (SELECT max(s.modifiee_le) FROM training_sessions s WHERE s.week_id = w.id) AS ecrite_le
          FROM training_weeks  w
          JOIN training_blocks b ON b.id = w.block_id
          JOIN training_macros m ON m.id = b.macro_id
          JOIN programs        p ON p.id = m.program_id
          JOIN athletes        a ON a.id = p.athlete_id
         WHERE {_STAFF_DU_PROGRAMME} AND a.archive_le IS NULL
    ),
    derniere_programmee AS (
        SELECT DISTINCT ON (program_id) *
          FROM mes_semaines WHERE sessions > 0
         ORDER BY program_id, macro_number DESC, block_number DESC, number DESC
    )
    -- ⚠️ NI LES SEMAINES DU BLOC, NI LES CHARGES DE LA RÉALISÉE : l'écran ne
    -- dit qu'une chose, que la semaine MANQUE. Ce qu'il n'affiche pas ne se
    -- calcule pas ici.
    SELECT ecoulee.id AS week_id, ecoulee.number AS week_number, b.id AS block_id,
           coalesce(b.name, '') AS block_name,
           m.program_id, a.legacy_id, a.first_name, a.last_name
      FROM derniere_programmee ecoulee
      JOIN training_blocks b ON b.id = ecoulee.block_id
      JOIN training_macros m ON m.id = b.macro_id
      JOIN programs        p ON p.id = m.program_id
      JOIN athletes        a ON a.id = p.athlete_id
     WHERE ecoulee.tracees = ecoulee.sessions
     ORDER BY ecoulee.ecrite_le DESC NULLS LAST, a.first_name, a.last_name
""")


# « N athlètes à jour » — les SIENS, par le lien de l'athlète (coach ou kiné),
# hors archivés. L'annuaire entier, lui, compte aussi ceux des autres.
_ATHLETES_SQL = text("""
    SELECT count(*) FROM athletes a
     WHERE a.archive_le IS NULL AND (a.coach_uid = :uid OR a.kine_uid = :uid)
""")


def _athlete(r) -> dict:
    return {"athleteId": r["legacy_id"], "firstName": r["first_name"] or "",
            "lastName": r["last_name"] or "", "programId": r["program_id"]}


def _nombre(v) -> float | None:
    return None if v is None else float(v)


@router.get("", response_model=Guichet, responses=erreurs(401))
def lire_le_guichet(claims: dict = Depends(verify_token)) -> dict:
    """Rend la file de travail de l'appelant, dans l'ordre où il doit la traiter.

    ⚠️ L'ordre se décide ICI, jamais à l'écran : douleurs, puis séances de la plus
    anciennement écrite à la plus récente, puis semaines. Sinon deux coachs ne
    verraient pas la même file, et « suivant » n'aurait plus de sens.
    """
    params = {"uid": claims["uid"], "depuis": MISE_EN_SERVICE}
    with get_session() as conn:
        douleurs = conn.execute(_DOULEURS_SQL, params).mappings().all()
        seances = conn.execute(_SEANCES_SQL, params).mappings().all()
        semaines = conn.execute(_SEMAINES_SQL, params).mappings().all()
        athletes = conn.execute(_ATHLETES_SQL, params).scalar_one()

    dossiers: list[dict] = []
    for r in douleurs:
        dossiers.append({
            "type": "douleur", "athlete": _athlete(r), "date": r["log_date"].isoformat(),
            "douleurs": r["douleurs"],
            "seanceDuJour": None if r["session_id"] is None else {
                "sessionId": str(r["session_id"]), "weekId": str(r["week_id"]),
                "programId": r["sj_program_id"], "name": r["session_name"] or ""},
        })
    for r in seances:
        dossiers.append({
            "type": "seance", "athlete": _athlete(r), "programId": r["program_id"],
            "sessionId": str(r["session_id"]), "weekId": str(r["week_id"]),
            "name": r["session_name"] or "",
            "blockName": r["block_name"], "weekNumber": r["week_number"],
            "date": r["date_garde"].isoformat() if r["date_garde"] else None,
            "seriesTenues": r["series_tenues"], "seriesTotal": r["series_total"],
            "tonnageKg": _nombre(r["tonnage_kg"]),
            "rpeRessenti": _nombre(r["rpe_ressenti"]), "rpeVise": _nombre(r["rpe_vise"]),
            "exercices": r["exercices"], "retours": r["retours"],
        })
    for r in semaines:
        dossiers.append({
            "type": "semaine", "athlete": _athlete(r), "programId": r["program_id"],
            # La semaine RÉALISÉE, depuis laquelle on écrit la suivante — celle-ci
            # n'existe pas encore (FRE-179). Le numéro est celui à écrire.
            "blockId": str(r["block_id"]), "weekId": str(r["week_id"]),
            "weekNumber": r["week_number"] + 1, "blockName": r["block_name"],
        })
    return {"dossiers": dossiers,
            "comptes": {"douleur": len(douleurs), "seance": len(seances), "semaine": len(semaines),
                        "athletes": athletes}}
