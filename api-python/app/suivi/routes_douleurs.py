"""Les douleurs suivies d'un athlète (FRE-195).

Une douleur DURE : elle se déclare une fois, puis se note jour après jour. C'est
ce qui manquait au suivi kiné : la mesure existait, mais rien ne reliait deux
signalements de la même épaule, et personne n'avait jamais saisi deux fois.

QUI FAIT QUOI
  · l'ATHLÈTE déclare, note et clôt — mode `owner`. C'est lui qui sait où il a
    mal et quand ça passe, et les huit saisies historiques sont toutes de lui ;
  · le STAFF lit — mode `owner_or_staff`, kiné ET coach. Même règle que le suivi
    kiné, dont le guichet sert déjà les deux (`kine_uid = uid OR coach_uid = uid`).
    Le bilan kiné, lui, exclut le coach ; ce n'est pas le même objet.

`athlete_id` du chemin est `athletes.legacy_id` : l'uuid se résout avant toute
lecture ou écriture, 404 sinon.
"""

from datetime import date as date_cls

from fastapi import APIRouter, Depends, status
from sqlalchemy import text

from app.socle.audit import log_write
from app.socle.authz import AthleteAccess, require_athlete_access
from app.socle.db import get_session
from app.socle.erreurs import ErreurMetier, erreurs
from app.socle.schemas_ecriture import ChampsEcrits
from app.suivi.schemas_douleurs import (
    DouleurCreee, DouleurCreeeReponse, DouleurLue, DouleurModifiee, LogDouleur, LogLu,
)

router = APIRouter(prefix="/athletes/{athlete_id}/douleurs", tags=["douleurs"])


def _resolve_athlete(session, legacy_id: str) -> str:
    """Résout le `legacy_id` du chemin en uuid SQL.

    Raises:
        ErreurMetier: `athlete_introuvable` (404) si l'athlète n'est pas en base.
    """
    row = session.execute(
        text("SELECT id FROM athletes WHERE legacy_id = :legacy"), {"legacy": legacy_id}).first()
    if row is None:
        raise ErreurMetier("athlete_introuvable", status.HTTP_404_NOT_FOUND,
                           "athlète inconnu en base SQL")
    return str(row[0])


def _douleur_de_l_athlete(session, athlete_uuid: str, douleur_id: str):
    """La douleur, si elle appartient bien à CET athlète.

    ⚠️ L'APPARTENANCE EST VÉRIFIÉE ICI, PAS SEULEMENT L'ACCÈS À L'ATHLÈTE.
    `require_athlete_access` autorise l'athlète du CHEMIN ; sans cette
    remontée, un identifiant de douleur d'un autre athlète passerait avec un
    `athlete_id` légitime. C'est la règle de FRE-43, et un 404 plutôt qu'un 403 :
    on ne confirme pas l'existence de ce qui ne vous regarde pas.
    """
    row = session.execute(text("""
        SELECT id, nom, zone, debut, fin FROM douleurs
         WHERE id = CAST(:d AS uuid) AND athlete_id = CAST(:a AS uuid)"""),
        {"d": douleur_id, "a": athlete_uuid}).mappings().first()
    if row is None:
        raise ErreurMetier("douleur_introuvable", status.HTTP_404_NOT_FOUND,
                           "cette douleur n'existe pas pour cet athlète")
    return row


_LISTE_SQL = text("""
    SELECT d.id::text AS id, d.nom, d.zone, d.debut, d.fin,
           (SELECT count(*) FROM douleur_logs l WHERE l.douleur_id = d.id) AS logs,
           dl.log_date, dl.intensite, dl.commentaire
      FROM douleurs d
      LEFT JOIN LATERAL (
          SELECT l.log_date, l.intensite, l.commentaire
            FROM douleur_logs l
           WHERE l.douleur_id = d.id
           ORDER BY l.log_date DESC
           LIMIT 1
      ) dl ON true
     WHERE d.athlete_id = CAST(:a AS uuid)
     -- Les vivantes d'abord : c'est ce qu'on vient voir. Les closes restent
     -- lisibles — une épaule qui a fait mal six mois est un antécédent.
     ORDER BY (d.fin IS NULL) DESC, dl.log_date DESC NULLS LAST, d.nom
""")


@router.get("", response_model=list[DouleurLue], responses=erreurs(401, 403, 404))
def lister(
    athlete_id: str,
    access: AthleteAccess = Depends(require_athlete_access("owner_or_staff")),
) -> list[dict]:
    """Les douleurs de l'athlète, la plus fraîche en tête."""
    with get_session() as conn:
        uuid = _resolve_athlete(conn, athlete_id)
        lignes = conn.execute(_LISTE_SQL, {"a": uuid}).mappings().all()
    return [{
        "id": r["id"], "nom": r["nom"], "zone": r["zone"],
        "debut": r["debut"].isoformat() if r["debut"] else None,
        "fin": r["fin"].isoformat() if r["fin"] else None,
        "logs": r["logs"],
        # ⚠️ DÉDUITE DU COMPTE, jamais stockée : notée plus d'une fois, elle
        # revient. Un booléen à côté finirait par contredire l'historique.
        "recurrente": r["logs"] > 1,
        "derniere": None if r["log_date"] is None else {
            "date": r["log_date"].isoformat(),
            "intensite": r["intensite"],
            "commentaire": r["commentaire"],
        },
    } for r in lignes]


_LOGS_SQL = text("""
    SELECT log_date, intensite, commentaire, entrainement
      FROM douleur_logs
     WHERE douleur_id = CAST(:d AS uuid)
     ORDER BY log_date DESC
""")


@router.get("/{douleur_id}/logs", response_model=list[LogLu],
            responses=erreurs(401, 403, 404))
def lister_les_logs(
    athlete_id: str,
    douleur_id: str,
    access: AthleteAccess = Depends(require_athlete_access("owner_or_staff")),
) -> list[dict]:
    """L'histoire d'une douleur : tous ses relevés, le plus récent en tête.

    ⚠️ UN APPEL À PART, ET PAS UN CHAMP DE PLUS DANS `DouleurLue`. La liste des
    douleurs se lit à chaque ouverture de l'écran ; y embarquer les relevés de
    toutes les douleurs ferait payer l'historique à qui vient juste voir où il a
    mal. On le demande quand on ouvre une carte.

    ⚠️ UNE DOULEUR CLOSE GARDE SON HISTOIRE, et c'est ce que le kiné vient
    chercher : une épaule qui a fait mal six mois est un antécédent. Aucun
    filtre sur `fin`.

    ⚠️ L'ORDRE EST CELUI DU RELEVÉ (`log_date`), PAS CELUI DE L'ÉCRITURE. Une
    note corrigée garde son jour et ne remonte pas en tête : `modifie_le` sert
    au guichet — « noté après coché » —, jamais à raconter l'histoire.

    Raises:
        ErreurMetier: `athlete_introuvable` (404), `douleur_introuvable` (404).
    """
    with get_session() as conn:
        uuid = _resolve_athlete(conn, athlete_id)
        # ⚠️ L'APPARTENANCE D'ABORD : un identifiant de douleur d'un autre
        # athlète passerait sinon avec un `athlete_id` légitime (FRE-43).
        _douleur_de_l_athlete(conn, uuid, douleur_id)
        lignes = conn.execute(_LOGS_SQL, {"d": douleur_id}).mappings().all()
    return [{
        "date": r["log_date"].isoformat(),
        "intensite": r["intensite"],
        "commentaire": r["commentaire"],
        "entrainement": r["entrainement"],
    } for r in lignes]


@router.post("", status_code=status.HTTP_201_CREATED,
             response_model=DouleurCreeeReponse, responses=erreurs(401, 403, 404, 409))
def declarer(
    athlete_id: str,
    payload: DouleurCreee,
    access: AthleteAccess = Depends(require_athlete_access("owner")),
) -> dict:
    """Déclare une douleur. Mode `owner` : c'est l'athlète qui sait où il a mal.

    Raises:
        ErreurMetier: `douleur_deja_suivie` (409) si la même zone est déjà
            suivie et toujours ouverte — c'est la même douleur, et la rattacher
            est tout l'objet de la feature.
    """
    with get_session() as conn:
        uuid = _resolve_athlete(conn, athlete_id)
        deja = conn.execute(text("""
            SELECT id::text FROM douleurs
             WHERE athlete_id = CAST(:a AS uuid) AND zone = :z AND fin IS NULL"""),
            {"a": uuid, "z": payload.zone}).scalar()
        if deja:
            raise ErreurMetier(
                "douleur_deja_suivie", status.HTTP_409_CONFLICT,
                f"une douleur est déjà suivie sur cette zone ({deja})")
        nouvelle = conn.execute(text("""
            INSERT INTO douleurs (athlete_id, nom, zone, debut)
            VALUES (CAST(:a AS uuid), :nom, :zone, :debut) RETURNING id"""),
            {"a": uuid, "nom": payload.nom.strip(), "zone": payload.zone.strip(),
             "debut": payload.debut}).scalar()
    log_write(uid=access.claims["uid"], resource="douleur",
              doc_path=f"athletes/{athlete_id}/douleurs/{nouvelle}", fields=["create"])
    return {"ok": True, "id": str(nouvelle)}


@router.patch("/{douleur_id}", response_model=ChampsEcrits, responses=erreurs(401, 403, 404, 409))
def modifier(
    athlete_id: str,
    douleur_id: str,
    payload: DouleurModifiee,
    access: AthleteAccess = Depends(require_athlete_access("owner")),
) -> dict:
    """Renomme, redate, clôt — ou ROUVRE.

    ⚠️ ROUVRIR EST UN CAS RÉEL, pas une commodité : une épaule se calme, puis
    revient. Reposer `fin` à `null` rend la douleur vivante, et l'unicité par
    zone la protège d'un doublon au même moment.
    """
    fourni = payload.model_dump(exclude_unset=True)
    if not fourni:
        # `corps_invalide` existe déjà pour ça : le vocabulaire des erreurs est
        # CLOS, et un code de plus pour le même refus le diluerait.
        raise ErreurMetier("corps_invalide", status.HTTP_422_UNPROCESSABLE_CONTENT,
                           "aucun champ à écrire")
    with get_session() as conn:
        uuid = _resolve_athlete(conn, athlete_id)
        avant = _douleur_de_l_athlete(conn, uuid, douleur_id)
        if "nom" in fourni and fourni["nom"] is not None:
            fourni["nom"] = fourni["nom"].strip()
        # Rouvrir : on vérifie qu'aucune AUTRE ne tient déjà la zone.
        if "fin" in fourni and fourni["fin"] is None and avant["fin"] is not None:
            occupee = conn.execute(text("""
                SELECT count(*) FROM douleurs
                 WHERE athlete_id = CAST(:a AS uuid) AND zone = :z
                   AND fin IS NULL AND id <> CAST(:d AS uuid)"""),
                {"a": uuid, "z": avant["zone"], "d": douleur_id}).scalar()
            if occupee:
                raise ErreurMetier("douleur_deja_suivie", status.HTTP_409_CONFLICT,
                                   "une autre douleur est déjà ouverte sur cette zone")
        sets = ", ".join(f"{c} = :{c}" for c in fourni)
        conn.execute(text(f"UPDATE douleurs SET {sets} WHERE id = CAST(:d AS uuid)"),
                     {**fourni, "d": douleur_id})
    log_write(uid=access.claims["uid"], resource="douleur",
              doc_path=f"athletes/{athlete_id}/douleurs/{douleur_id}", fields=sorted(fourni))
    return {"ok": True, "written": sorted(fourni)}


@router.put("/{douleur_id}/logs/{jour}", response_model=ChampsEcrits,
            responses=erreurs(401, 403, 404))
def noter(
    athlete_id: str,
    douleur_id: str,
    jour: date_cls,
    payload: LogDouleur,
    access: AthleteAccess = Depends(require_athlete_access("owner")),
) -> dict:
    """Note la douleur pour un jour donné. Réécrire le même jour REMPLACE.

    ⚠️ UN LOG PAR JOUR ET PAR DOULEUR. Deux notes le même jour pour la même
    épaule se contrediraient : la seconde est une correction, pas un fait de
    plus. La base le tient (`UNIQUE (douleur_id, log_date)`), et l'upsert le
    rend naturel côté écran — on rouvre sa saisie, on corrige, on renvoie.
    """
    with get_session() as conn:
        uuid = _resolve_athlete(conn, athlete_id)
        _douleur_de_l_athlete(conn, uuid, douleur_id)
        # ⚠️ `NULL` ET JAMAIS `''` (FRE-137) : une seule façon de dire « rien ».
        # Un commentaire effacé revient à l'absence, pas à une chaîne vide que la
        # contrainte refuserait de toute façon.
        commentaire = (payload.commentaire or "").strip() or None
        conn.execute(text("""
            INSERT INTO douleur_logs (douleur_id, log_date, intensite, commentaire, entrainement)
            VALUES (CAST(:d AS uuid), :j, :i, :c, :e)
            ON CONFLICT (douleur_id, log_date) DO UPDATE
               SET intensite = EXCLUDED.intensite, commentaire = EXCLUDED.commentaire,
                   -- ⚠️ LA RÉPONSE SE REMPLACE, `NULL` COMPRIS : corriger sa
                   -- note en laissant la question de côté doit pouvoir la
                   -- remettre à « non dit ». Un COALESCE figerait la première
                   -- réponse pour toujours.
                   entrainement = EXCLUDED.entrainement,
                   -- ⚠️ CE QUI RAPPELLE LE STAFF. Sans ce rafraîchissement, une
                   -- douleur qui empire ne revient jamais dans la file de qui
                   -- l'a déjà cochée.
                   modifie_le = clock_timestamp()"""),
            {"d": douleur_id, "j": jour, "i": payload.intensite, "c": commentaire,
             "e": payload.entrainement})
    ecrits = ["intensite"] + (["commentaire"] if commentaire else [])
    if payload.entrainement is not None:
        ecrits.append("entrainement")
    log_write(uid=access.claims["uid"], resource="douleur_log",
              doc_path=f"athletes/{athlete_id}/douleurs/{douleur_id}/logs/{jour}",
              fields=ecrits)
    return {"ok": True, "written": ecrits}
