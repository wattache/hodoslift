"""Les objectifs techniques par mouvement : le journal du coach (FRE-122).

Le coach choisit un mouvement et y note une consigne (« garde les coudes
hauts ») ; l'athlète la voit quand l'exercice est dans sa programmation.

⚠️ DEUX modes d'accès sur la même ressource : la LECTURE est `owner_or_staff`,
l'ÉCRITURE est `coach` — son coach SEUL. Si l'athlète pouvait la réécrire, ce ne
serait plus une consigne ; le kiné lit mais ne prescrit pas. Le front ne propose
donc aucun geste d'écriture à qui brokkr le refuse.

⚠️ Ce n'est pas `training_exercises.coach_note`, note ponctuelle sur UNE ligne
d'une séance, qui ne suit pas le mouvement. Ni les deux autres familles
d'objectifs (`athlete_goals`, `block_objectives`) : ici, c'est le coach qui pose.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.socle.audit import log_write
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.socle.erreurs import ErreurMetier, UuidDeChemin, erreurs
from app.objectifs.schemas_objectif_technique import ObjectifTechniqueCorrige, ObjectifTechniqueEcrit, ObjectifTechniqueLu

router = APIRouter(prefix="/athletes/{athlete_id}/objectifs-techniques",
                   tags=["training"])

_LECTURE = require_athlete_access("owner_or_staff")
_ECRITURE = require_athlete_access("coach")

_ATHLETE_SQL = text("SELECT id FROM athletes WHERE legacy_id = :legacy")

_COLONNES = "id, mouvement, texte, cree_par, cree_le, clos_le"

# ⚠️ TOUT est rendu — ouverts ET clos, tous mouvements confondus. Filtrer côté
# serveur imposerait un paramètre, donc une clé de cache par mouvement, pour une
# liste courte. C'est l'écran qui regroupe.
#
# Du plus récent au plus ancien, et l'index suit ce tri.
_LISTE_SQL = text(
    f"SELECT {_COLONNES} FROM objectifs_techniques "
    "WHERE athlete_id = :aid ORDER BY cree_le DESC"
)


def _uuid_athlete(session, legacy: str) -> str:
    ligne = session.execute(_ATHLETE_SQL, {"legacy": legacy}).first()
    if ligne is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND,
                           "athlète introuvable")
    return str(ligne[0])


def _lu(r) -> dict:
    return {
        "id": str(r["id"]),
        "mouvement": r["mouvement"],
        "texte": r["texte"],
        "creePar": r["cree_par"],
        "creeLe": r["cree_le"].isoformat(),
        # ⚠️ `None` et non `''` : « encore en travail » est une ABSENCE de date,
        # pas une date vide. Le contrat le dit (`str | None`).
        "closLe": r["clos_le"].isoformat() if r["clos_le"] else None,
    }


def _objectif_ou_404(session, objectif_id: str, aid: str):
    """L'objectif, cherché DANS ceux de l'athlète.

    ⚠️ L'appartenance fait partie de la RECHERCHE, pas d'un test qui suivrait :
    comparer `athlete_id` après coup confirmerait l'existence d'un objectif d'un
    AUTRE athlète, par différence de réponse. Ici il n'existe pas — 404.

    Raises:
        ErreurMetier: `objectif_introuvable` (404).
    """
    ligne = session.execute(text(
        f"SELECT {_COLONNES} FROM objectifs_techniques "
        "WHERE id = CAST(:oid AS uuid) AND athlete_id = :aid"),
        {"oid": objectif_id, "aid": aid}).mappings().first()
    if ligne is None:
        raise ErreurMetier("objectif_introuvable", status.HTTP_404_NOT_FOUND,
                           "objectif introuvable")
    return ligne


@router.get("", response_model=list[ObjectifTechniqueLu], responses=erreurs(401, 403, 404))
def lister(athlete_id: str, access: AthleteAccess = Depends(_LECTURE)) -> list:
    with get_session() as session:
        aid = _uuid_athlete(session, athlete_id)
        lignes = session.execute(_LISTE_SQL, {"aid": aid}).mappings().all()
    return [_lu(r) for r in lignes]


# ⚠️ 422 n'est PAS déclaré, même s'il est levé ici : FastAPI le documente déjà
# pour toute route qui valide un corps, et `test_contrat_erreurs` refuse qu'on le
# redéclare. `mouvement_inconnu` sort bien en 422 ; c'est son CODE qui le
# distingue d'une erreur de validation, pas son statut.
@router.post("", status_code=status.HTTP_201_CREATED, response_model=ObjectifTechniqueLu,
             responses=erreurs(401, 403, 404))
def creer(athlete_id: str, payload: ObjectifTechniqueEcrit,
          access: AthleteAccess = Depends(_ECRITURE)) -> dict:
    uid = access.claims["uid"]
    with get_session() as session:
        aid = _uuid_athlete(session, athlete_id)
        try:
            ligne = session.execute(text(
                f"INSERT INTO objectifs_techniques (athlete_id, mouvement, texte, cree_par) "
                f"VALUES (:aid, :mouvement, :texte, :uid) RETURNING {_COLONNES}"),
                {"aid": aid, "mouvement": payload.mouvement,
                 "texte": payload.texte, "uid": uid}).mappings().first()
        except IntegrityError as exc:
            # ⚠️ La GARANTIE est dans la base, la TRADUCTION est ici. C'est la clé
            # étrangère vers `library_entries` qui refuse un nom inventé, pas une
            # liste blanche recopiée en Python, qui divergerait. Sans cette
            # traduction, une faute de saisie rendrait un 500.
            raise ErreurMetier("mouvement_inconnu", status.HTTP_422_UNPROCESSABLE_ENTITY,
                               f"« {payload.mouvement} » n'est pas dans la bibliothèque") from exc
    log_write(uid=uid, resource="objectif_technique",
              doc_path=f"athletes/{athlete_id}/objectifs-techniques/{ligne['id']}",
              fields=["mouvement", "texte"])
    return _lu(ligne)


@router.patch("/{objectif_id}", response_model=ObjectifTechniqueLu,
              responses=erreurs(401, 403, 404))
def corriger(athlete_id: str, objectif_id: UuidDeChemin, payload: ObjectifTechniqueCorrige,
             access: AthleteAccess = Depends(_ECRITURE)) -> dict:
    """Corrige le texte, clôt l'objectif, ou le rouvre.

    ⚠️ CLORE n'efface pas : un objectif atteint reste dans le journal avec sa
    date. ROUVRIR remet `clos_le` à NULL — reposer le même objectif créerait un
    doublon qui mentirait sur depuis quand on le travaille.

    ⚠️ `cree_le` ne bouge JAMAIS : corriger une faute de frappe ne fait pas
    remonter un vieil objectif en tête du journal.
    """
    uid = access.claims["uid"]
    champs = payload.model_fields_set
    with get_session() as session:
        aid = _uuid_athlete(session, athlete_id)
        _objectif_ou_404(session, objectif_id, aid)

        sets, params = [], {"oid": objectif_id}
        if "texte" in champs:
            sets.append("texte = :texte")
            params["texte"] = payload.texte
        if "clos" in champs:
            # ⚠️ `clock_timestamp()` et non `now()`, qui rend l'heure de DÉBUT DE
            # TRANSACTION : un test qui crée puis clôt dans la même transaction
            # lirait deux fois la même valeur, et « la clôture est postérieure à
            # la création » serait invérifiable.
            sets.append("clos_le = clock_timestamp()" if payload.clos else "clos_le = NULL")

        ligne = session.execute(text(
            f"UPDATE objectifs_techniques SET {', '.join(sets)} "
            f"WHERE id = CAST(:oid AS uuid) RETURNING {_COLONNES}"),
            params).mappings().first()
    log_write(uid=uid, resource="objectif_technique",
              doc_path=f"athletes/{athlete_id}/objectifs-techniques/{objectif_id}",
              fields=sorted(champs))
    return _lu(ligne)


@router.delete("/{objectif_id}", status_code=status.HTTP_204_NO_CONTENT,
               responses=erreurs(401, 403, 404))
def supprimer(athlete_id: str, objectif_id: UuidDeChemin,
              access: AthleteAccess = Depends(_ECRITURE)) -> None:
    """Supprime un objectif posé par ERREUR.

    ⚠️ La suppression existe pour les fautes, pas pour les objectifs atteints :
    un objectif travaillé se CLÔT (`PATCH … {clos: true}`) et reste dans le
    journal. Clore est le geste courant, celui que l'écran met à portée de main.
    """
    with get_session() as session:
        aid = _uuid_athlete(session, athlete_id)
        _objectif_ou_404(session, objectif_id, aid)
        session.execute(text(
            "DELETE FROM objectifs_techniques WHERE id = CAST(:oid AS uuid)"),
            {"oid": objectif_id})
    log_write(uid=access.claims["uid"], resource="objectif_technique",
              doc_path=f"athletes/{athlete_id}/objectifs-techniques/{objectif_id}",
              fields=["delete"])
