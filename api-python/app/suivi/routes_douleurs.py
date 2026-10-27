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
        SELECT id, nom, debut, fin FROM douleurs
         WHERE id = CAST(:d AS uuid) AND athlete_id = CAST(:a AS uuid)"""),
        {"d": douleur_id, "a": athlete_uuid}).mappings().first()
    if row is None:
        raise ErreurMetier("douleur_introuvable", status.HTTP_404_NOT_FOUND,
                           "cette douleur n'existe pas pour cet athlète")
    return row


_LISTE_SQL = text("""
    SELECT d.id::text AS id, d.nom, d.debut, d.fin,
           ARRAY(SELECT z.zone FROM douleur_zones z WHERE z.douleur_id = d.id ORDER BY z.zone) AS zones,
           (SELECT count(*) FROM douleur_logs l WHERE l.douleur_id = d.id) AS logs,
           dl.log_date, dl.intensite, dl.commentaire, dl.entrainement, dl.exercices
      FROM douleurs d
      LEFT JOIN LATERAL (
          -- `douleur_notes` : la note ET les lignes de séance d'où elle vient.
          SELECT l.log_date, l.intensite, l.commentaire, l.entrainement, l.exercices
            FROM douleur_notes l
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
        "id": r["id"], "nom": r["nom"], "zones": r["zones"],
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
            "entrainement": r["entrainement"],
            "exercices": r["exercices"],
        },
    } for r in lignes]


_LOGS_SQL = text("""
    SELECT log_date, intensite, commentaire, entrainement, exercices
      FROM douleur_notes
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
        "exercices": r["exercices"],
    } for r in lignes]


@router.post("", status_code=status.HTTP_201_CREATED,
             response_model=DouleurCreeeReponse, responses=erreurs(401, 403, 404))
def declarer(
    athlete_id: str,
    payload: DouleurCreee,
    access: AthleteAccess = Depends(require_athlete_access("owner")),
) -> dict:
    """Déclare une douleur. Mode `owner` : c'est l'athlète qui sait où il a mal.

    ⚠️ UNE ZONE DÉJÀ PRISE PAR UNE AUTRE DOULEUR VIVANTE EST PERMISE (FRE-196) :
    un claquage du biceps n'est pas la vieille épaule. Rattacher à l'existante
    est le choix de l'athlète, que l'écran lui propose.
    """
    with get_session() as conn:
        uuid = _resolve_athlete(conn, athlete_id)
        nouvelle = conn.execute(text("""
            INSERT INTO douleurs (athlete_id, nom, debut)
            VALUES (CAST(:a AS uuid), :nom, :debut) RETURNING id"""),
            {"a": uuid, "nom": payload.nom.strip(), "debut": payload.debut}).scalar()
        _poser_les_zones(conn, str(nouvelle), payload.zones)
    log_write(uid=access.claims["uid"], resource="douleur",
              doc_path=f"athletes/{athlete_id}/douleurs/{nouvelle}", fields=["create"])
    return {"ok": True, "id": str(nouvelle)}


def _poser_les_zones(conn, douleur_id: str, zones: list[str]) -> None:
    """Remplace les zones d'une douleur — dans la transaction de l'appelant."""
    conn.execute(text("DELETE FROM douleur_zones WHERE douleur_id = CAST(:d AS uuid)"),
                 {"d": douleur_id})
    conn.execute(text("""
        INSERT INTO douleur_zones (douleur_id, zone)
        SELECT CAST(:d AS uuid), unnest(CAST(:z AS text[]))"""),
        {"d": douleur_id, "z": [z.strip() for z in zones]})


@router.patch("/{douleur_id}", response_model=ChampsEcrits, responses=erreurs(401, 403, 404))
def modifier(
    athlete_id: str,
    douleur_id: str,
    payload: DouleurModifiee,
    access: AthleteAccess = Depends(require_athlete_access("owner")),
) -> dict:
    """Renomme, redate, change les zones, clôt — ou ROUVRE.

    ⚠️ ROUVRIR EST UN CAS RÉEL, pas une commodité : une épaule se calme, puis
    revient. Reposer `fin` à `null` rend la douleur vivante.

    Raises:
        ErreurMetier: `corps_invalide` (422) — aucun champ, ou `zones: null` :
            sans zone, la douleur disparaît de la figure sans être close.
    """
    fourni = payload.model_dump(exclude_unset=True)
    if not fourni:
        # `corps_invalide` existe déjà pour ça : le vocabulaire des erreurs est
        # CLOS, et un code de plus pour le même refus le diluerait.
        raise ErreurMetier("corps_invalide", status.HTTP_422_UNPROCESSABLE_CONTENT,
                           "aucun champ à écrire")
    if "zones" in fourni and fourni["zones"] is None:
        raise ErreurMetier("corps_invalide", status.HTTP_422_UNPROCESSABLE_CONTENT,
                           "une douleur garde au moins une zone")
    zones = fourni.pop("zones", None)
    with get_session() as conn:
        uuid = _resolve_athlete(conn, athlete_id)
        _douleur_de_l_athlete(conn, uuid, douleur_id)
        if "nom" in fourni and fourni["nom"] is not None:
            fourni["nom"] = fourni["nom"].strip()
        if fourni:
            sets = ", ".join(f"{c} = :{c}" for c in fourni)
            conn.execute(text(f"UPDATE douleurs SET {sets} WHERE id = CAST(:d AS uuid)"),
                         {**fourni, "d": douleur_id})
        if zones is not None:
            _poser_les_zones(conn, douleur_id, zones)
            fourni["zones"] = zones
    log_write(uid=access.claims["uid"], resource="douleur",
              doc_path=f"athletes/{athlete_id}/douleurs/{douleur_id}", fields=sorted(fourni))
    return {"ok": True, "written": sorted(fourni)}


# LA LIGNE DE SÉANCE D'OÙ L'ON SIGNALE — celle de CET athlète, remontée jusqu'au
# programme (FRE-43 : l'appartenance se vérifie, pas seulement l'accès). Le
# réalisé vaut quand il est saisi, sinon le prescrit — la règle du guichet.
_LIGNE_SQL = text("""
    SELECT x.name, coalesce(x.variant, '{}') AS variant, x.tempo, x.format, x.sets,
           coalesce(x.reps_done, x.reps) AS reps, coalesce(x.weight_done, x.weight) AS weight
      FROM training_exercises x
      JOIN training_sessions s ON s.id = x.session_id
      JOIN training_weeks    w ON w.id = s.week_id
      JOIN training_blocks   b ON b.id = w.block_id
      JOIN training_macros   m ON m.id = b.macro_id
      JOIN programs          p ON p.id = m.program_id
     WHERE x.id = CAST(:x AS uuid) AND p.athlete_id = CAST(:a AS uuid)
""")


def _ligne_de_l_athlete(session, athlete_uuid: str, exercise_id: str):
    """Le cliché d'une ligne de séance, si elle est bien dans le programme de CET
    athlète.

    Raises:
        ErreurMetier: `exercice_introuvable` (404) — y compris pour la ligne d'un
            autre athlète : on ne confirme pas l'existence de ce qui ne vous
            regarde pas.
        ErreurMetier: `corps_invalide` (422) sur une ligne sans mouvement : il
            n'y a rien à nommer dans la note.
    """
    row = session.execute(_LIGNE_SQL, {"x": exercise_id, "a": athlete_uuid}).mappings().first()
    if row is None:
        raise ErreurMetier("exercice_introuvable", status.HTTP_404_NOT_FOUND,
                           "cette ligne n'est pas dans le programme de cet athlète")
    if row["name"] is None:
        raise ErreurMetier("corps_invalide", status.HTTP_422_UNPROCESSABLE_CONTENT,
                           "cette ligne n'a pas de mouvement")
    return row


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

    ⚠️ SAUF L'EXERCICE, QUI S'AJOUTE. Signalée depuis une ligne de séance, la
    note garde cette ligne — et la suivante si l'épaule gêne aussi aux dips. La
    même ligne deux fois ne fait qu'une entrée. Signaler depuis une ligne DIT
    qu'on s'est entraîné : `entrainement: false` est alors une contradiction.

    Raises:
        ErreurMetier: `corps_invalide` (422) — un exercice avec
            `entrainement: false` ; `exercice_introuvable` (404) — une ligne
            hors du programme de cet athlète.
    """
    entrainement = payload.entrainement
    if payload.exercice is not None:
        if entrainement is False:
            raise ErreurMetier("corps_invalide", status.HTTP_422_UNPROCESSABLE_CONTENT,
                               "signalée depuis une ligne de séance, la note est un jour entraîné")
        entrainement = True
    with get_session() as conn:
        uuid = _resolve_athlete(conn, athlete_id)
        _douleur_de_l_athlete(conn, uuid, douleur_id)
        ligne = (None if payload.exercice is None
                 else _ligne_de_l_athlete(conn, uuid, str(payload.exercice.exerciseId)))
        # ⚠️ `NULL` ET JAMAIS `''` (FRE-137) : une seule façon de dire « rien ».
        # Un commentaire effacé revient à l'absence, pas à une chaîne vide que la
        # contrainte refuserait de toute façon.
        commentaire = (payload.commentaire or "").strip() or None
        log_id = conn.execute(text("""
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
                   modifie_le = clock_timestamp()
            RETURNING id"""),
            {"d": douleur_id, "j": jour, "i": payload.intensite, "c": commentaire,
             "e": entrainement}).scalar()
        if ligne is not None:
            conn.execute(text("""
                INSERT INTO douleur_log_exercices
                       (log_id, exercise_id, name, variant, tempo, format, sets, reps, weight)
                VALUES (CAST(:l AS uuid), CAST(:x AS uuid), :name, :variant, :tempo, :format,
                        :sets, :reps, :weight)
                ON CONFLICT (log_id, exercise_id) WHERE exercise_id IS NOT NULL DO NOTHING"""),
                {"l": log_id, "x": str(payload.exercice.exerciseId), **dict(ligne)})
    ecrits = ["intensite"] + (["commentaire"] if commentaire else [])
    if entrainement is not None:
        ecrits.append("entrainement")
    if ligne is not None:
        ecrits.append("exercice")
    log_write(uid=access.claims["uid"], resource="douleur_log",
              doc_path=f"athletes/{athlete_id}/douleurs/{douleur_id}/logs/{jour}",
              fields=ecrits)
    return {"ok": True, "written": ecrits}
