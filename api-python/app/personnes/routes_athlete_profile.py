"""L'écriture du profil athlète : `PATCH /athletes/{id}/profile`, sur la table `athletes`.

Autorisation `require_athlete_access("staff")` : le coach gérant ou le kiné,
jamais l'athlète. `athlete_id` est `athletes.legacy_id`, l'id que le front utilise.

⚠️ coachId/linkedUserId/programId ne sont pas dans le schéma : la liste blanche
Pydantic (`extra="forbid"`) EST la protection au niveau du champ.

`""` sur `gender` ou `birthDate` EFFACE (colonne NULL). `currentOneRM` est
FUSIONNÉ en jsonb : les clés fournies écrasent, les autres restent. Cette fusion
est propre à Postgres (`::`/`||`) : elle ne s'éprouve pas sur les stubs SQLite.
"""

import json

from fastapi import APIRouter, Depends, status
from sqlalchemy import text

from app.socle.erreurs import erreurs
from app.socle.audit import log_write
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.personnes.schemas_athlete_profile import AthleteProfilePatch
from app.socle.schemas_ecriture import ChampsEcrits
from app.socle.erreurs import ErreurMetier

router = APIRouter(prefix="/athletes/{athlete_id}", tags=["athlete-profile"])

# ⚠️ L'existence ET la liaison en UNE requête : deux laisseraient un intervalle
# entre « la fiche existe » et « elle est liée », pour un aller-retour de plus.
_ETAT_SQL = text("SELECT user_uid IS NOT NULL AS liee FROM athletes WHERE legacy_id = :legacy")

# La projection des 1RM vers la page publique du coach (FRE-30).
#
# ⚠️ `coach_profiles.one_rm` est une COPIE de `athletes.current_one_rm`, et la
# redondance est le garde-fou : la route publique lit une seule table et ne joint
# JAMAIS `athletes`, donc aucune donnée d'athlète ne sort sans authentification.
#
# Elle se joue À L'ÉCRITURE, dans la MÊME transaction : un coach qui renseigne ses
# 1RM regarde sa page publique dans la foulée. Le job nocturne
# (`training-analytics-refresh`) rattrape ce qui change par un autre chemin.
#
# Ne touche que le profil du coach lié à CET athlète par `user_uid` ; pour un
# athlète qui n'est pas coach, la mise à jour ne fait rien.
_PROJETER_ONE_RM_SQL = text(
    "UPDATE coach_profiles SET one_rm = a.current_one_rm "
    "FROM athletes a "
    "WHERE a.user_uid = coach_profiles.coach_uid AND a.legacy_id = :legacy"
)

#: Les mesures d'un corps : un zéro y est une ABSENCE, jamais une valeur.
#:
#: ⚠️ Le front le fabrique sans le vouloir : vider la case envoie `0`
#: (`parseFloat(v) || 0`). La traduction vit ICI et pas dans le navigateur : elle
#: vaut pour tout client, et la file hors-ligne rejoue des patchs de versions
#: antérieures.
_MESURES_POSITIVES: frozenset[str] = frozenset({"height", "weight"})


def _mesure_ou_absence(cle: str, v):
    """Un zéro sur une mesure de corps est une absence : il s'écrit `NULL` (FRE-137)."""
    if cle in _MESURES_POSITIVES and isinstance(v, (int, float)) and v <= 0:
        return None
    return v


# Champs scalaires du schéma → colonnes (currentOneRM/gender traités à part).
_FIELD_TO_COL = {
    "firstName": "first_name",
    "lastName": "last_name",
    "email": "email",
    "height": "height_cm",
    "weight": "weight_kg",
}


@router.patch("/profile", response_model=ChampsEcrits, responses=erreurs(401, 403, 404, 409))
def patch_profile(
    payload: AthleteProfilePatch,
    access: AthleteAccess = Depends(require_athlete_access("staff")),
) -> dict:
    data = payload.model_dump(exclude_none=True)
    # `age` n'a pas de colonne (FRE-168) : un client ancien l'envoie encore, on
    # l'écarte — ni écrit, ni annoncé dans `written`. Un patch qui ne porte QUE
    # lui ne touche rien, et rend 200 (cf. `AthleteProfilePatch.age`).
    data.pop("age", None)
    legacy = access.athlete_id

    # Un seul UPDATE, construit selon les champs fournis.
    set_clauses: list[str] = []
    params: dict = {"legacy": legacy}
    for key, col in _FIELD_TO_COL.items():
        if key in data:
            set_clauses.append(f"{col} = :{col}")
            params[col] = _mesure_ou_absence(key, data[key])
    # `""` efface la date, comme pour `gender`.
    if "birthDate" in data:
        set_clauses.append("birth_date = :birth_date")
        params["birth_date"] = None if data["birthDate"] == "" else data["birthDate"]
    if "gender" in data:
        set_clauses.append("gender = :gender")
        params["gender"] = None if data["gender"] == "" else data["gender"]
    if "currentOneRM" in data:
        # Fusion jsonb : les clés fournies écrasent, les autres restent.
        #
        # ⚠️ Un 1RM à zéro n'est pas un record, c'est une case vide : sa clé est
        # RETIRÉE de l'objet, pour qu'aucun lecteur n'ait à distinguer `0` de
        # « non renseigné ».
        #
        # ⚠️ RETIRÉE et non mise à `null` : la fusion `||` poserait un `null` JSON,
        # qui se relit comme une valeur.
        orm ={k: v for k, v in data["currentOneRM"].items()
               if not (isinstance(v, (int, float)) and v <= 0)}
        a_retirer = [k for k in data["currentOneRM"] if k not in orm]
        # ⚠️ LES PARENTHÈSES NE SONT PAS DÉCORATIVES. En SQL, `-` lie plus fort
        # que `||` : sans elles, `A || B - C` s'évalue `A || (B - C)`, la clé
        # reste en place, et le PATCH rend 200 sans rien effacer.
        fusion = "COALESCE(current_one_rm, '{}'::jsonb) || CAST(:orm AS jsonb)"
        for i in range(len(a_retirer)):
            fusion = f"({fusion}) - CAST(:orm_del{i} AS text)"
        set_clauses.append(f"current_one_rm = {fusion}")
        params["orm"] = json.dumps(orm)
        for i, cle in enumerate(a_retirer):
            params[f"orm_del{i}"] = cle

    update_sql = text(f"UPDATE athletes SET {', '.join(set_clauses)} WHERE legacy_id = :legacy")

    with get_session() as session:
        etat = session.execute(_ETAT_SQL, {"legacy": legacy}).first()
        if etat is None:
            raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND, "athlète inconnu en base SQL")
        # ⚠️ L'EMAIL SE FIGE À LA LIAISON (FRE-131). Avant, c'est un contact que le
        # coach saisit et corrige. Après, c'est le miroir de l'identité du compte,
        # et la clé de rapprochement de `POST /athletes/link` : qui l'écrit décide
        # qui est OWNER de la fiche — donc qui lit les bilans kiné.
        if "email" in data and etat[0]:
            raise ErreurMetier(
                "email_fige_par_le_compte",
                status.HTTP_409_CONFLICT,
                "fiche rattachée à un compte : son adresse vient du compte",
            )
        if set_clauses:
            session.execute(update_sql, params)
        if "currentOneRM" in data:
            session.execute(_PROJETER_ONE_RM_SQL, {"legacy": legacy})

    log_write(
        uid=access.claims["uid"],
        resource="athlete_profile",
        doc_path=f"athletes/{legacy}",
        fields=sorted(data.keys()),
    )
    return {"ok": True, "written": sorted(data.keys())}
