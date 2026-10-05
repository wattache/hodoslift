"""Identité et rôles des comptes.

`users(uid, email, display_name, is_admin, created_at)`, et une table
d'extension par rôle : être coach (ou kiné), c'est avoir une ligne dans `coaches`
(ou `kines`). L'athleteId d'un profil se DÉRIVE de `athletes.user_uid`.

- GET /users/me          : get-or-create le profil de l'appelant.
- PUT /users/{uid}/coach : promeut / rétrograde un coach (admin).
- PUT /users/{uid}/kine  : promeut / rétrograde un kiné (admin).
- GET /users             : annuaire admin, rôles dérivés.

⚠️ `/users/me` RESTE OUVERT à tout compte authentifié (`verify_token`, pas
`require_membre`) : c'est lui qui crée la ligne `users` d'un compte tout neuf.
"""

import json

from pydantic import ValidationError

from fastapi import APIRouter, Depends, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.socle.erreurs import erreurs
from app.socle.audit import log_write
from app.socle.auth import verify_token
from app.socle.authz import require_admin
from app.socle.db import get_session
from app.personnes.schemas_user import MoiLu, Preferences, PreferencesPatch, UserCoachSet, UserKineSet, UtilisateurLu
from app.socle.schemas_ecriture import RoleCoachEcrit, RoleKineEcrit
from app.socle.structures import structures_de
from app.socle.erreurs import ErreurMetier

router = APIRouter(prefix="/users", tags=["users"])

# ⚠️ get-or-create : on n'écrase JAMAIS une ligne existante (son `is_admin` reste
# intact) ; les colonnes NOT NULL restantes (is_admin, created_at) s'appuient sur
# leurs DEFAULT.
_UPSERT_ME_SQL = text(
    "INSERT INTO users (uid, email, display_name) VALUES (:uid, :email, :name) "
    "ON CONFLICT (uid) DO NOTHING"
)
_PROFILE_SQL = text(
    """
    SELECT u.email, u.display_name, u.is_admin, u.preferences,
           EXISTS(SELECT 1 FROM coaches c WHERE c.uid = u.uid) AS is_coach,
           EXISTS(SELECT 1 FROM kines k WHERE k.uid = u.uid) AS is_kine,
           (SELECT a.legacy_id FROM athletes a WHERE a.user_uid = u.uid LIMIT 1) AS athlete_id
    FROM users u WHERE u.uid = :uid
    """
)


@router.get("/me", response_model=MoiLu, responses=erreurs(401))
def get_me(claims: dict = Depends(verify_token)) -> dict:
    """Profil de l'appelant, créé au premier appel (get-or-create).

    `athleteId` est dérivé de `athletes.user_uid` : null si l'appelant n'est pas
    un athlète lié.
    """
    uid = claims["uid"]
    email = (claims.get("email") or "").strip().lower()
    name = claims.get("name") or (email.split("@")[0] if email else "")

    with get_session() as session:
        session.execute(_UPSERT_ME_SQL, {"uid": uid, "email": email, "name": name})
        row = session.execute(_PROFILE_SQL, {"uid": uid}).mappings().first()

    return {
        "uid": uid,
        "email": row["email"],
        "displayName": row["display_name"],
        "isCoach": bool(row["is_coach"]),
        # Le front en a besoin pour router un kiné vers ses athlètes suivis, comme
        # `isCoach` le fait pour un coach. Dérivé de la table, jamais stocké sur
        # `users` : un booléen recopié finit par diverger du lien réel.
        "isKine": bool(row["is_kine"]),
        "isAdmin": bool(row["is_admin"]),
        "athleteId": row["athlete_id"],
        "preferences": preferences_lues(row["preferences"]),
        "structures": structures_de(uid),
    }


_USER_EXISTS_SQL = text("SELECT 1 FROM users WHERE uid = :uid")
_PROMOTE_COACH_SQL = text("INSERT INTO coaches (uid) VALUES (:uid) ON CONFLICT DO NOTHING")
# ⚠️ LA STRUCTURE NOMMÉE ÉCRASE (FRE-13) : promouvoir chez SCAPPULIFT un coach
# déjà French Forge le DÉPLACE — c'est le geste de l'admin, et une seule
# structure par coach (modèle A). Sans structure, `_PROMOTE_COACH_SQL` ne touche
# pas à une ligne existante.
_PROMOTE_COACH_DANS_SQL = text(
    "INSERT INTO coaches (uid, structure) VALUES (:uid, :structure) "
    "ON CONFLICT (uid) DO UPDATE SET structure = EXCLUDED.structure")
_STRUCTURE_EXISTE_SQL = text("SELECT 1 FROM structures WHERE slug = :slug")


def _exiger_la_structure(session, slug: str | None) -> None:
    """Refuse une structure inconnue AVANT d'écrire.

    Laissée à la clé étrangère, la faute remonterait en `IntegrityError` — que ces
    routes lisent comme « encore référencé » : un 409 qui mentirait sur la cause.

    Raises:
        ErreurMetier: `structure_inconnue` (404).
    """
    if slug is not None and session.execute(_STRUCTURE_EXISTE_SQL, {"slug": slug}).first() is None:
        raise ErreurMetier("structure_inconnue", status.HTTP_404_NOT_FOUND, f"structure inconnue : {slug}")
_DEMOTE_COACH_SQL = text("DELETE FROM coaches WHERE uid = :uid")

# ⚠️ LES TROIS RÉFÉRENCES QUI BLOQUENT UNE RÉTROGRADATION (FRE-24). Parmi les
# tables qui référencent `coaches(uid)`, celles-ci RETIENNENT ; les autres lâchent
# le lien (CASCADE ou SET NULL) :
#
#   athletes.coach_uid          RESTRICT
#   programs.coach_uid          RESTRICT
#   competitions.created_by     RESTRICT
#
# ⚠️ `library_entries.created_by` N'EN FAIT PAS PARTIE, et c'est délibéré (SET
# NULL). Toute entrée de bibliothèque est PARTAGÉE : ce champ n'est qu'une trace
# d'auteur, jamais lue ni consultée pour autoriser. Une trace que personne ne lit
# n'a pas à empêcher un départ.
#
# ⚠️ UN PRÉ-CONTRÔLE PLUTÔT QUE LA LECTURE DE L'`IntegrityError` : Postgres
# n'annonce que la PREMIÈRE contrainte rencontrée, alors qu'un compte peut être
# retenu par plusieurs. Compter permet de tout dire d'un coup, donc de ne faire
# qu'un aller-retour à l'utilisateur.
_REFERENCES_BLOQUANTES = (
    ("athletes", "coach_uid", "athlète", "athlètes"),
    ("programs", "coach_uid", "programme", "programmes"),
    ("competitions", "created_by", "compétition", "compétitions"),
)


def _ce_qui_retient(session, uid: str) -> list[str]:
    """Ce qui empêche de rétrograder ce coach, énuméré et compté.

    Rend une liste vide si rien ne retient. Les libellés sont accordés : ce
    message est montré à un coach, et « 1 athlètes » se lit comme une machine.
    """
    retenu = []
    for table, colonne, singulier, pluriel in _REFERENCES_BLOQUANTES:
        n = session.execute(
            text(f"SELECT count(*) FROM {table} WHERE {colonne} = :uid"), {"uid": uid}
        ).scalar_one()
        if n:
            retenu.append(f"{n} {singulier if n == 1 else pluriel}")
    return retenu


_PREFERENCES_SQL = text(
    "UPDATE users SET preferences = CAST(:p AS jsonb) WHERE uid = :uid RETURNING preferences"
)


def preferences_lues(brut: dict | None) -> dict:
    """Ce que la colonne porte, passé au contrat. Une forme que le contrat ne
    connaît plus (la préférence a été PAR MODE avant d'être unique, 28/09) se
    lit comme « aucune préférence » : la prochaine écriture la remplace."""
    try:
        return Preferences.model_validate(brut or {}).model_dump()
    except ValidationError:
        return Preferences().model_dump()


@router.patch("/me/preferences", response_model=Preferences, responses=erreurs(401))
def patch_my_preferences(payload: PreferencesPatch, claims: dict = Depends(verify_token)) -> dict:
    """Les réglages d'affichage de l'appelant : ce qu'il fournit se pose, le
    reste tient (brief progression, 27/09).

    ⚠️ RELU, FUSIONNÉ, RÉÉCRIT — pas un `||` jsonb : le contrat (`Preferences`)
    valide ce qui est en base à la relecture, une clé inconnue n'y entre pas et
    une ancienne n'y survit pas."""
    uid = claims["uid"]
    with get_session() as session:
        session.execute(_UPSERT_ME_SQL, {"uid": uid, "email": (claims.get("email") or "").strip().lower(),
                                         "name": claims.get("name") or ""})
        actuelles = session.execute(text("SELECT preferences FROM users WHERE uid = :uid"),
                                    {"uid": uid}).scalar() or {}
        fusion = {**preferences_lues(actuelles), **payload.model_dump(exclude_unset=True)}
        row = session.execute(_PREFERENCES_SQL, {"uid": uid, "p": json.dumps(fusion)}).scalar()
    log_write(uid=uid, resource="user_preferences", doc_path=f"users/{uid}", fields=sorted(payload.model_dump(exclude_unset=True)))
    return row


@router.put("/{uid}/coach", response_model=RoleCoachEcrit, responses=erreurs(401, 403, 404, 409))
def set_user_coach(
    uid: str,
    payload: UserCoachSet,
    claims: dict = Depends(require_admin),
) -> dict:
    """Promeut (isCoach=true → ligne `coaches`) ou rétrograde (false → delete) un coach.

    Admin-only. Rétrograder, ou changer de structure, un coach encore retenu par
    des athlètes, des programmes ou des compétitions est refusé, et le message
    nomme ce qui retient (`_REFERENCES_BLOQUANTES`).

    Raises:
        ErreurMetier: `utilisateur_introuvable` (404), `structure_inconnue` (404),
            `coach_encore_reference` (409).
    """
    try:
        with get_session() as session:
            if session.execute(_USER_EXISTS_SQL, {"uid": uid}).first() is None:
                raise ErreurMetier("utilisateur_introuvable", status.HTTP_404_NOT_FOUND, "utilisateur inconnu")
            if payload.isCoach:
                _exiger_la_structure(session, payload.structure)
                if payload.structure is None:
                    session.execute(_PROMOTE_COACH_SQL, {"uid": uid})
                else:
                    # ⚠️ CHANGER DE STRUCTURE, C'EST QUITTER L'AUTRE : ce qui
                    # retient une rétrogradation retient aussi le départ, sinon
                    # ses fiches resteraient derrière lui, hors de la liste de
                    # l'une comme de l'autre (`fiche_dans_la_structure_de_son_coach`).
                    actuelle = session.execute(text("SELECT structure FROM coaches WHERE uid = :uid"),
                                               {"uid": uid}).scalar()
                    retenu = _ce_qui_retient(session, uid) if actuelle not in (None, payload.structure) else []
                    if retenu:
                        raise ErreurMetier(
                            "coach_encore_reference", status.HTTP_409_CONFLICT,
                            "impossible : " + " et ".join(retenu) + " le retiennent chez " + actuelle)
                    session.execute(_PROMOTE_COACH_DANS_SQL, {"uid": uid, "structure": payload.structure})
            else:
                # ⚠️ ON COMPTE AVANT DE SUPPRIMER, et on nomme ce qui retient
                # (FRE-24) : la FK seule ne donnerait qu'un message unique, faux
                # dès que ce n'est pas elle qui retient.
                retenu = _ce_qui_retient(session, uid)
                if retenu:
                    raise ErreurMetier(
                        "coach_encore_reference",
                        status.HTTP_409_CONFLICT,
                        "impossible : " + " et ".join(retenu)
                        + " " + ("dépend" if len(retenu) == 1 and retenu[0].startswith("1 ")
                                 else "dépendent")
                        + " encore de ce coach",
                    )
                session.execute(_DEMOTE_COACH_SQL, {"uid": uid})
    except IntegrityError:
        # ⚠️ LE FILET RESTE : le pré-contrôle et la suppression ne sont pas
        # atomiques vis-à-vis d'une écriture concurrente, et une table nouvelle
        # peut référencer `coaches` sans que `_REFERENCES_BLOQUANTES` la connaisse.
        # On échoue alors proprement, sans prétendre savoir ce qui retient.
        raise ErreurMetier(
            "coach_encore_reference",
            status.HTTP_409_CONFLICT,
            "ce coach est encore référencé ailleurs — impossible de le rétrograder",
        )

    log_write(
        uid=claims["uid"],
        resource="user_coach_set",
        doc_path=f"users/{uid}",
        fields=["is_coach", "structure"] if payload.structure else ["is_coach"],
    )
    return {"ok": True, "isCoach": payload.isCoach}


_PROMOTE_KINE_SQL = text("INSERT INTO kines (uid) VALUES (:uid) ON CONFLICT DO NOTHING")
_PROMOTE_KINE_DANS_SQL = text(
    "INSERT INTO kines (uid, structure) VALUES (:uid, :structure) "
    "ON CONFLICT (uid) DO UPDATE SET structure = EXCLUDED.structure")
_DEMOTE_KINE_SQL = text("DELETE FROM kines WHERE uid = :uid")


@router.put("/{uid}/kine", response_model=RoleKineEcrit, responses=erreurs(401, 403, 404, 409))
def set_user_kine(
    uid: str,
    payload: UserKineSet,
    claims: dict = Depends(require_admin),
) -> dict:
    """Promeut (isKine=true → ligne `kines`) ou rétrograde (false → delete) un kiné.

    Admin-only. JUMEAU de `set_user_coach`, et c'est voulu (FRE-52) : les deux
    rôles sont une ligne dans une table d'extension de `users`. Toute divergence
    serait un piège le jour où les organisations (FRE-64) les fondront en une
    seule notion d'adhésion.

    ⚠️ Le 409 tient à la FK RESTRICT sur `athletes.kine_uid` : sans lui,
    rétrograder un kiné détacherait ses suivis en silence. « Détache d'abord,
    rétrograde ensuite », et la base l'impose.

    Raises:
        ErreurMetier: `utilisateur_introuvable` (404), `structure_inconnue` (404),
            `kine_a_des_athletes` (409).
    """
    try:
        with get_session() as session:
            if session.execute(_USER_EXISTS_SQL, {"uid": uid}).first() is None:
                raise ErreurMetier("utilisateur_introuvable", status.HTTP_404_NOT_FOUND, "utilisateur inconnu")
            if payload.isKine:
                _exiger_la_structure(session, payload.structure)
                if payload.structure is None:
                    session.execute(_PROMOTE_KINE_SQL, {"uid": uid})
                else:
                    session.execute(_PROMOTE_KINE_DANS_SQL, {"uid": uid, "structure": payload.structure})
            else:
                session.execute(_DEMOTE_KINE_SQL, {"uid": uid})
    except IntegrityError:
        # ⚠️ UNE SEULE CONTRAINTE MÈNE ICI — `athletes.kine_uid`. La clé de
        # `kine_notes` pointe vers `users`, pas vers `kines` : une note appartient
        # à une personne, pas à un rôle, et ne retient pas une rétrogradation.
        raise ErreurMetier(
            "kine_a_des_athletes",
            status.HTTP_409_CONFLICT,
            "ce kiné suit encore des athlètes — détache-les d'abord",
        )

    log_write(
        uid=claims["uid"],
        resource="user_kine_set",
        doc_path=f"users/{uid}",
        fields=["is_kine", "structure"] if payload.structure else ["is_kine"],
    )
    return {"ok": True, "isKine": payload.isKine}


_LIST_USERS_SQL = text(
    """
    SELECT u.uid, u.email, u.display_name, u.is_admin,
           EXISTS(SELECT 1 FROM coaches c WHERE c.uid = u.uid) AS is_coach,
           EXISTS(SELECT 1 FROM kines k WHERE k.uid = u.uid) AS is_kine,
           (SELECT c.structure FROM coaches c WHERE c.uid = u.uid) AS coach_structure,
           (SELECT k.structure FROM kines k WHERE k.uid = u.uid) AS kine_structure,
           (SELECT array_agg(DISTINCT a.structure ORDER BY a.structure)
              FROM athletes a WHERE a.user_uid = u.uid) AS athlete_structures
    FROM users u
    ORDER BY u.display_name, u.email
    """
)


@router.get("", response_model=list[UtilisateurLu], responses=erreurs(401, 403))
def list_users(claims: dict = Depends(require_admin)) -> list:
    """Annuaire complet des utilisateurs (admin-only), avec les rôles dérivés.

    Tout rôle qu'une route POSE se lit ici : sans lecture, l'admin ne pourrait ni
    vérifier ce qu'il a fait, ni savoir à qui il l'a fait.
    """
    with get_session() as session:
        rows = session.execute(_LIST_USERS_SQL).mappings().all()
    return [
        {
            "uid": r["uid"],
            "email": r["email"],
            "displayName": r["display_name"],
            "isCoach": bool(r["is_coach"]),
            "isKine": bool(r["is_kine"]),
            "isAdmin": bool(r["is_admin"]),
            "coachStructure": r["coach_structure"],
            "kineStructure": r["kine_structure"],
            "athleteStructures": list(r["athlete_structures"] or []),
        }
        for r in rows
    ]
