"""Les notes de suivi du kiné : au fil de l'eau, hors bilan (FRE-102).

⚠️ Autz `kine` : le mode le plus ÉTROIT du produit, le seul qui exclue l'athlète
lui-même (et le coach, comme pour les bilans). Une note est l'observation du
praticien — une hypothèse, pas un constat : la montrer à l'athlète l'inquiéterait
sans contexte, et censurerait ce que le kiné y écrit. Élargir plus tard est
trivial ; resserrer après qu'on a écrit franchement ne l'est pas.

⚠️ C'est un JOURNAL, pas un bloc-notes : des entrées qui s'empilent, la dernière
disant l'état courant. Un texte unique qu'on réécrit perdrait comment on y est
arrivé.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy import text

from app.socle.audit import log_write
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.socle.erreurs import ErreurMetier, UuidDeChemin, erreurs
from app.kine.schemas_kine_note import NoteEcrite, NoteLue

router = APIRouter(prefix="/athletes/{athlete_id}/notes-kine", tags=["kine"])

# Son kiné SEUL — ni le coach, ni l'athlète.
_ACCES = require_athlete_access("kine")

_ATHLETE_SQL = text("SELECT id FROM athletes WHERE legacy_id = :legacy")

# ⚠️ Du plus RÉCENT au plus ancien, et l'index suit ce tri (`athlete_id, cree_le
# DESC`) : la dernière note EST l'état courant.
_LISTE_SQL = text(
    "SELECT id, contenu, kine_uid, cree_le, modifie_le FROM kine_notes "
    "WHERE athlete_id = :aid ORDER BY cree_le DESC"
)


def _uuid_athlete(session, legacy: str) -> str:
    ligne = session.execute(_ATHLETE_SQL, {"legacy": legacy}).first()
    if ligne is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND,
                           "athlète introuvable")
    return str(ligne[0])


def _lue(r) -> dict:
    return {
        "id": str(r["id"]),
        "contenu": r["contenu"],
        "kineUid": r["kine_uid"],
        "creeLe": r["cree_le"].isoformat(),
        "modifieLe": r["modifie_le"].isoformat(),
    }


def _note_ou_404(session, note_id: str, aid: str):
    """La note, cherchée DANS les notes de l'athlète.

    ⚠️ L'appartenance fait partie de la RECHERCHE, pas d'un test qui suivrait :
    comparer `athlete_id` après coup confirmerait l'existence d'une note d'un
    autre athlète, par différence de réponse. Ici elle n'existe pas — 404.

    Raises:
        ErreurMetier: `note_introuvable` (404).
    """
    ligne = session.execute(text(
        "SELECT id, contenu, kine_uid, cree_le, modifie_le FROM kine_notes "
        "WHERE id = CAST(:nid AS uuid) AND athlete_id = :aid"),
        {"nid": note_id, "aid": aid}).mappings().first()
    if ligne is None:
        raise ErreurMetier("note_introuvable", status.HTTP_404_NOT_FOUND,
                           "note introuvable")
    return ligne


@router.get("", response_model=list[NoteLue], responses=erreurs(401, 403, 404))
def lister(athlete_id: str, access: AthleteAccess = Depends(_ACCES)) -> list:
    with get_session() as session:
        aid = _uuid_athlete(session, athlete_id)
        lignes = session.execute(_LISTE_SQL, {"aid": aid}).mappings().all()
    return [_lue(r) for r in lignes]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=NoteLue,
             responses=erreurs(401, 403, 404))
def creer(athlete_id: str, payload: NoteEcrite,
          access: AthleteAccess = Depends(_ACCES)) -> dict:
    uid = access.claims["uid"]
    with get_session() as session:
        aid = _uuid_athlete(session, athlete_id)
        ligne = session.execute(text(
            "INSERT INTO kine_notes (athlete_id, kine_uid, contenu) "
            "VALUES (:aid, :uid, :contenu) "
            "RETURNING id, contenu, kine_uid, cree_le, modifie_le"),
            {"aid": aid, "uid": uid, "contenu": payload.contenu}).mappings().first()
    log_write(uid=uid, resource="note_kine",
              doc_path=f"athletes/{athlete_id}/notes-kine/{ligne['id']}", fields=["contenu"])
    return _lue(ligne)


@router.patch("/{note_id}", response_model=NoteLue, responses=erreurs(401, 403, 404))
def corriger(athlete_id: str, note_id: UuidDeChemin, payload: NoteEcrite,
             access: AthleteAccess = Depends(_ACCES)) -> dict:
    """Corrige le contenu d'une note.

    ⚠️ `modifie_le` bouge, `cree_le` NON, et le journal reste trié sur `cree_le` :
    corriger une faute ne fait pas remonter une vieille note en tête du suivi.
    """
    uid = access.claims["uid"]
    with get_session() as session:
        aid = _uuid_athlete(session, athlete_id)
        _note_ou_404(session, note_id, aid)
        # ⚠️ `clock_timestamp()` et non `now()`, qui rend l'heure de DÉBUT DE
        # TRANSACTION : un test qui écrit puis corrige dans la même transaction
        # lirait deux fois la même valeur, et « modifie_le bouge » serait
        # invérifiable.
        ligne = session.execute(text(
            "UPDATE kine_notes SET contenu = :contenu, modifie_le = clock_timestamp() "
            "WHERE id = CAST(:nid AS uuid) "
            "RETURNING id, contenu, kine_uid, cree_le, modifie_le"),
            {"contenu": payload.contenu, "nid": note_id}).mappings().first()
    log_write(uid=uid, resource="note_kine",
              doc_path=f"athletes/{athlete_id}/notes-kine/{note_id}", fields=["contenu"])
    return _lue(ligne)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT,
               responses=erreurs(401, 403, 404))
def supprimer(athlete_id: str, note_id: UuidDeChemin,
              access: AthleteAccess = Depends(_ACCES)) -> None:
    with get_session() as session:
        aid = _uuid_athlete(session, athlete_id)
        _note_ou_404(session, note_id, aid)
        session.execute(text("DELETE FROM kine_notes WHERE id = CAST(:nid AS uuid)"),
                        {"nid": note_id})
    log_write(uid=access.claims["uid"], resource="note_kine",
              doc_path=f"athletes/{athlete_id}/notes-kine/{note_id}", fields=["delete"])
