"""Les objectifs d'athlète : ce que l'athlète SE fixe (`athlete_goals`).

Domaine ISOLÉ : ne touche QUE `athlete_goals` — ni le profil, ni les 1RM, ni
les PR. Autz `owner_or_staff` : l'athlète édite SES objectifs, le staff aussi.

⚠️ Trois familles d'objectifs, qui ne se fusionnent pas : `athlete_goals` (posés
par l'athlète), `block_objectives` (ceux d'un bloc de programmation),
`objectifs_techniques` (les corrections du coach par mouvement). Elles diffèrent
par QUI les pose et par leur horizon.

Le front écrit la liste EN BLOC : le PUT remplace l'ensemble en UNE transaction,
sous garde de version (FRE-134). L'`athlete_id` du chemin est
`athletes.legacy_id`. Les dates passent en texte 'YYYY-MM-DD' (cast implicite).
"""


from fastapi import APIRouter, Depends, status
from sqlalchemy import bindparam, text

from app.socle.erreurs import erreurs
from app.socle.audit import log_write
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.socle.empreinte import empreinte
from app.objectifs.schemas_goals import GoalsReplace, ObjectifsLus
from app.socle.schemas_ecriture import Denombrement
from app.socle.erreurs import ErreurMetier

router = APIRouter(prefix="/athletes/{athlete_id}/goals", tags=["goals"])

_ATHLETE_SQL = text("SELECT id FROM athletes WHERE legacy_id = :legacy")

_READ_SQL = text(
    """
    SELECT g.legacy_id, g.exercise, g.sets, g.reps, g.weight, g.motivation,
           g.created_on, g.achieved_on
    FROM athlete_goals g
    JOIN athletes a ON a.id = g.athlete_id
    WHERE a.legacy_id = :legacy
    ORDER BY g.created_on, g.legacy_id
    """
)


def _version(rows) -> str:
    """L'empreinte de la liste d'objectifs d'athlète (cf. `app/socle/empreinte.py`).

    ⚠️ Elle dépend de l'ORDRE des lignes : `_READ_SQL` départage deux objectifs
    du même jour par `legacy_id`, sinon Postgres les rend comme il veut.
    """
    return empreinte(rows)

_UPSERT_SQL = text(
    """
    INSERT INTO athlete_goals
        (athlete_id, legacy_id, exercise, sets, reps, weight, motivation, created_on, achieved_on)
    VALUES
        (:athlete_id, :legacy_id, :exercise, :sets, :reps, :weight, :motivation, :created_on, :achieved_on)
    ON CONFLICT (athlete_id, legacy_id) DO UPDATE SET
        exercise    = EXCLUDED.exercise,
        sets        = EXCLUDED.sets,
        reps        = EXCLUDED.reps,
        weight      = EXCLUDED.weight,
        motivation  = EXCLUDED.motivation,
        created_on  = EXCLUDED.created_on,
        achieved_on = EXCLUDED.achieved_on
    """
)

_DELETE_ABSENT_SQL = text(
    "DELETE FROM athlete_goals WHERE athlete_id = :athlete_id AND legacy_id NOT IN :keep"
).bindparams(bindparam("keep", expanding=True))

_DELETE_ALL_SQL = text("DELETE FROM athlete_goals WHERE athlete_id = :athlete_id")


def _resolve_athlete(session, legacy_id: str) -> str:
    """`legacy_id` (l'identifiant hérité de Firestore, celui du chemin) → uuid SQL.

    Raises:
        ErreurMetier: `athlete_introuvable` (404) — jamais silencieux.
    """
    row = session.execute(_ATHLETE_SQL, {"legacy": legacy_id}).first()
    if row is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND, "athlète inconnu en base SQL")
    return row[0]


def _iso(value) -> str:
    """Date SQL → 'YYYY-MM-DD' (Postgres rend un `date`, SQLite une `str`)."""
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


@router.get("", response_model=ObjectifsLus, response_model_exclude_unset=True, responses=erreurs(401, 403, 404))
def list_goals(
    access: AthleteAccess = Depends(require_athlete_access("owner_or_staff")),
) -> dict:
    """Les objectifs de l'athlète, par date de création, AVEC leur version.

    `achievedAt` est omis si NULL. La version est celle que le PUT exige (FRE-134).
    """
    with get_session() as session:
        _resolve_athlete(session, access.athlete_id)  # 404 si absent
        rows = session.execute(_READ_SQL, {"legacy": access.athlete_id}).all()

    out: list[dict] = []
    for legacy_id, exercise, sets, reps, weight, motivation, created_on, achieved_on in rows:
        goal = {
            "id": legacy_id,
            "exercise": exercise,
            "sets": sets,
            "reps": reps,
            "weight": weight,
            "motivation": motivation,
            "createdAt": _iso(created_on),
        }
        if achieved_on is not None:
            goal["achievedAt"] = _iso(achieved_on)
        out.append(goal)
    return {"goals": out, "version": _version(rows)}


@router.put("", response_model=Denombrement, responses=erreurs(401, 403, 404, 409))
def replace_goals(
    payload: GoalsReplace,
    access: AthleteAccess = Depends(require_athlete_access("owner_or_staff")),
) -> dict:
    """Remplace l'ENSEMBLE des objectifs, en une transaction.

    Upsert des présents, delete des absents. Le plafond de la liste est tenu par
    le schéma (422).

    ⚠️ Seulement si la liste n'a PAS BOUGÉ depuis sa lecture (FRE-134).
    `owner_or_staff` ouvre la porte à deux humains — l'athlète et son coach : sans
    la version, le premier à avoir chargé la page efface l'ajout de l'autre, en
    silence.

    Raises:
        ErreurMetier: `objectifs_perimes` (409).
    """
    goals = payload.goals
    with get_session() as session:
        athlete_uuid = _resolve_athlete(session, access.athlete_id)

        # ⚠️ Relue DANS la transaction d'écriture : lue avant, elle laisserait la
        # fenêtre qu'elle prétend fermer.
        actuelle = _version(session.execute(_READ_SQL, {"legacy": access.athlete_id}).all())
        if payload.version != actuelle:
            raise ErreurMetier(
                "objectifs_perimes",
                status.HTTP_409_CONFLICT,
                "la liste d'objectifs a changé depuis sa lecture — recharger avant d'enregistrer",
            )

        for goal in goals:
            session.execute(
                _UPSERT_SQL,
                {
                    "athlete_id": athlete_uuid,
                    "legacy_id": goal.id,
                    "exercise": goal.exercise,
                    "sets": goal.sets,
                    "reps": goal.reps,
                    "weight": goal.weight,
                    "motivation": goal.motivation,
                    "created_on": goal.createdAt,
                    "achieved_on": goal.achievedAt,
                },
            )

        keep_ids = [goal.id for goal in goals]
        if keep_ids:
            session.execute(_DELETE_ABSENT_SQL, {"athlete_id": athlete_uuid, "keep": keep_ids})
        else:  # tableau vide = tout supprimer (NOT IN () serait invalide)
            session.execute(_DELETE_ALL_SQL, {"athlete_id": athlete_uuid})

    log_write(
        uid=access.claims["uid"],
        resource="athlete_goals",
        doc_path=f"athletes/{access.athlete_id}/goals",
        fields=["goals"],
    )
    return {"ok": True, "count": len(goals)}
