"""Le métier de la STRUCTURE de l'arbre : appartenance, réalisé, renumérotation, relecture.

Ce que `routes_training_structure.py` appelle, sans HTTP :

  · `verifier` — l'objet appartient-il au programme de l'URL ? 404 sinon, jamais 403 ;
  · `contenu_realise` — ce qu'une suppression détruirait (FRE-130) ;
  · `recompacter` — les numéros restent contigus 1..n dans LEUR parent ;
  · `exiger_les_dates_de_s1` — aucune semaine ne naît d'une trame sans dates ;
  · `relire_semaine`, `bloc_de_l_arbre` — relus par `read_tree`, jamais par une
    requête dédiée, pour rester identiques au contrat de lecture.
"""

from typing import Any
from uuid import UUID

from fastapi import status
from sqlalchemy import text

from app.entrainement.arbre_creation import (
    retrouver,
    date_ou_none, inserer_avec_numero, inserer_ligne, json_ou_none,
)
from app.entrainement.prescription import normaliser_groupes
from app.entrainement.records import TRACE_ARBRE
from app.socle.erreurs import ErreurMetier
from app.entrainement.training_tree import read_tree


OBJECTIFS_DU_BLOC = text(
    "SELECT * FROM block_objectives WHERE block_id = CAST(:b AS uuid) ORDER BY position")


# --------------------------------------------------------------------------- #
# LA MARQUE DE RELECTURE
#
# Le coach COCHE qu'il a vu une séance : ouvrir n'est pas lire. La règle qui la
# remet dans la file vit dans `app/entrainement/relecture.py`.
#
# ⚠️ IDEMPOTENTES TOUTES LES DEUX. Recocher ne DÉPLACE pas la date déjà posée :
# sinon une séance modifiée entre deux clics passerait pour relue. Décocher ce
# qui n'est pas coché rend 200.
# --------------------------------------------------------------------------- #

RELIRE_SQL = text(
    "UPDATE training_sessions "
    "   SET relue_le = coalesce(relue_le, clock_timestamp()), relue_par = coalesce(relue_par, :uid) "
    " WHERE id = CAST(:sid AS uuid)"
)
DERELIRE_SQL = text(
    "UPDATE training_sessions SET relue_le = NULL, relue_par = NULL "
    " WHERE id = CAST(:sid AS uuid)"
)

# Chemin de chaque niveau jusqu'au programme. C'est ce qui ferme la porte.
_REMONTEE = {
    "macro": "FROM training_macros x WHERE x.id = CAST(:id AS uuid) AND x.program_id = :pid",
    "bloc": ("FROM training_blocks x JOIN training_macros m ON m.id = x.macro_id "
             "WHERE x.id = CAST(:id AS uuid) AND m.program_id = :pid"),
    "semaine": ("FROM training_weeks x JOIN training_blocks b ON b.id = x.block_id "
                "JOIN training_macros m ON m.id = b.macro_id "
                "WHERE x.id = CAST(:id AS uuid) AND m.program_id = :pid"),
    "seance": ("FROM training_sessions x JOIN training_weeks w ON w.id = x.week_id "
               "JOIN training_blocks b ON b.id = w.block_id "
               "JOIN training_macros m ON m.id = b.macro_id "
               "WHERE x.id = CAST(:id AS uuid) AND m.program_id = :pid"),
}

_TABLES = {
    "macro": "training_macros", "bloc": "training_blocks",
    "semaine": "training_weeks", "seance": "training_sessions",
}

# La descente, pendant de `_REMONTEE` : d'une ligne d'exercice jusqu'au niveau
# qu'on s'apprête à supprimer. Une chaîne de jointures, un `WHERE` par niveau.
_DESCENTE = {"macro": "m.id", "bloc": "b.id", "semaine": "w.id", "seance": "s.id"}

# CE QU'UNE SUPPRESSION VA DÉTRUIRE (FRE-130).
#
# ⚠️ ON NE BLOQUE PAS, ON DIT. Supprimer du réalisé pour réajuster est un geste
# légitime : pas de 409, mais un compte que le dialogue de confirmation affiche.
#
# ⚠️ La définition de « réalisé » est EMPRUNTÉE : `TRACE_ARBRE` vit dans
# `records.py`. Une seconde ici ferait deux réponses à « a-t-il fait cette
# séance ».
#
# ⚠️ `count(DISTINCT s.id)` pour les séances : une séance de huit lignes réalisées
# est UNE séance.
_REALISE_SQL = {
    niveau: text(f"""
        SELECT count(*) AS lignes, count(DISTINCT s.id) AS seances
          FROM training_exercises x
          JOIN training_sessions s ON s.id = x.session_id
          JOIN training_weeks    w ON w.id = s.week_id
          JOIN training_blocks   b ON b.id = w.block_id
          JOIN training_macros   m ON m.id = b.macro_id
         WHERE m.program_id = :pid AND {colonne} = CAST(:id AS uuid)
           AND {TRACE_ARBRE}
    """)
    for niveau, colonne in _DESCENTE.items()
}


def contenu_realise(conn, niveau: str, program_id: str, objet_id: str) -> dict:
    """Compte les lignes et les séances RÉALISÉES sous cet objet."""
    r = conn.execute(_REALISE_SQL[niveau],
                     {"pid": program_id, "id": objet_id}).mappings().one()
    return {"lignes": r["lignes"], "seances": r["seances"]}

# camelCase du contrat → colonne, par niveau. Explicite : une conversion
# automatique exposerait demain un champ que personne n'a décidé d'écrire.
_CHAMPS = {
    # Pas de dates : `training_macros` n'en a pas de colonnes (cf. `MacroPatch`).
    "macro": {"name": "name", "trainingFrequency": "training_frequency",
              "coachNotes": "coach_notes"},
    "bloc": {"name": "name", "startDate": "start_date", "endDate": "end_date"},
    "semaine": {"name": "name", "hidden": "hidden", "startDate": "start_date",
                "endDate": "end_date", "athleteWeightKg": "athlete_weight_kg",
                "athleteHeightCm": "athlete_height_cm"},
    "seance": {"name": "name", "sessionDate": "session_date",
               "formOfTheDay": "form_of_the_day"},
}


def verifier(conn, niveau: str, program_id: str, objet_id: str):
    """Rend l'objet, S'IL appartient à ce programme.

    ⚠️ 404 sinon, jamais 403 : on ne confirme pas l'existence de ce qu'on n'a pas
    le droit de voir.

    Raises:
        ErreurMetier: `objet_arbre_introuvable` (404)."""
    try:
        UUID(objet_id)
    except (ValueError, AttributeError, TypeError):
        # Un id qui n'est pas un uuid est INTROUVABLE, pas une erreur serveur :
        # sans ce filtre le `CAST(... AS uuid)` lève, et c'est un 500.
        raise ErreurMetier("objet_arbre_introuvable", status.HTTP_404_NOT_FOUND,
                            detail=f"{niveau} introuvable") from None
    row = conn.execute(text(f"SELECT x.* {_REMONTEE[niveau]}"),
                       {"id": objet_id, "pid": program_id}).mappings().first()
    if row is None:
        raise ErreurMetier("objet_arbre_introuvable", status.HTTP_404_NOT_FOUND, detail=f"{niveau} introuvable")
    return row


# La matrice de périmètre et son garde-fou vivent dans `app/socle/perimetre.py` :
# UNE adresse à la question « qui écrit quoi ».


def patch(conn, niveau: str, objet_id: str, fourni: dict) -> list[str]:
    cols = _CHAMPS[niveau]
    sets = ", ".join(f"{cols[k]} = :{k}" for k in fourni)
    conn.execute(text(f"UPDATE {_TABLES[niveau]} SET {sets} WHERE id = CAST(:id AS uuid)"),
                 {**fourni, "id": objet_id})
    return sorted(fourni)


# Table et colonne de PARENT, par niveau. Le recompactage ne s'applique JAMAIS
# globalement : le numéro d'une semaine n'a de sens que dans SON bloc.
_PARENT_DE = {
    "macro": ("training_macros", "program_id"),
    "bloc": ("training_blocks", "macro_id"),
    "semaine": ("training_weeks", "block_id"),
}


def recompacter(conn, niveau: str, parent_id) -> None:
    """Renumérote 1..n les enfants d'UN parent, dans leur ordre d'affichage.

    Sans elle, `max + 1` finit par créer des doublons, que le Tracking fusionne.
    Bornée au PARENT, jamais à la table entière (cf. `_PARENT_DE`). S'appelle dans
    la transaction de la suppression : l'arbre n'est jamais lisible à moitié
    renuméroté.

    ⚠️ Elle DÉPARTAGE sur `legacy_id` : la contrainte d'unicité (FRE-134) ferme la
    porte aux nouveaux doublons, pas aux anciens, et un tri sur `number` seul
    pourrait RÉORDONNER l'arbre au lieu de fermer les trous. `ORDER BY number,
    legacy_id` est l'ordre des lectures (`_MACROS`, `_BLOCS`, `_SEMAINES` dans
    `training_tree.py`)."""
    table, parent_col = _PARENT_DE[niveau]
    # ⚠️ Cet `UPDATE` TRAVERSE UN ÉTAT À DOUBLON (2,3 → 1,2), et ne tient que parce
    # que la contrainte d'unicité est déclarée `DEFERRABLE` : elle est alors
    # vérifiée en FIN D'INSTRUCTION, même en mode `IMMEDIATE`. Aucun
    # `SET CONSTRAINTS … DEFERRED` n'est nécessaire.
    conn.execute(text(
        f"UPDATE {table} t SET number = r.rang FROM ("
        f"  SELECT id, row_number() OVER (ORDER BY number, legacy_id) AS rang "
        f"  FROM {table} WHERE {parent_col} = :p) r "
        # `<>` : on n'écrit que les lignes qui bougent. Sur une numérotation déjà
        # contiguë, l'UPDATE ne touche aucune ligne.
        f"WHERE t.id = r.id AND t.number <> r.rang"), {"p": parent_id})


def exiger_les_dates_de_s1(base: dict[str, Any]) -> None:
    """Refuse de faire NAÎTRE une semaine d'une trame sans ses dates de S1 (FRE-138).

    ⚠️ UNE DÉFINITION, DEUX ROUTES : `generate-week` et `next-week`. Gardée sur une
    seule, l'autre fait naître des semaines NUES, et du réalisé sans date.

    ⚠️ Pas sur `PUT /base` : la trame se compose par petits gestes, chacun
    envoyant la BASE ENTIÈRE, et l'exiger là rendrait la composition impossible.
    La contrainte se pose au moment où une semaine naît.

    ⚠️ LES DEUX DATES : la fin de S1 donne la LONGUEUR de toutes les semaines du
    bloc (`blockWeekDates` au front, `semaine_suivante` ici). Sans elle, on
    retombe sur sept jours, que personne n'a demandés.

    Raises:
        ErreurMetier: `base_sans_dates` (409)."""
    if not base.get("s1StartDate") or not base.get("s1EndDate"):
        raise ErreurMetier("base_sans_dates", status.HTTP_409_CONFLICT,
                           "la trame de ce bloc n'a pas ses dates de semaine 1")


def en_semaine_lue(semaine: dict[str, Any], identifiant: str) -> dict[str, Any]:
    """Habille la semaine générée au contrat de LECTURE — pour l'aperçu.

    ⚠️ Des identifiants d'AFFICHAGE, et ça se voit dans leur nom (`apercu-0`,
    `apercu-0-1`) : rien n'existe en base, et un id d'allure réelle inviterait à
    patcher dessus."""
    return {
        **semaine,
        "id": identifiant,
        # ⚠️ `None` et non `""`/`0` (FRE-137) : un athlète de zéro kilo décrit
        # quelqu'un, au lieu de dire qu'il n'y a personne à décrire.
        # `firstName`/`lastName` restent des chaînes : leurs colonnes sont NOT NULL.
        "athlete": {"firstName": "", "lastName": "", "weight": None, "height": None},
        "sessions": [
            {
                **seance,
                "id": f"{identifiant}-{i}",
                "formOfTheDay": None,
                # Rien de réalisé, donc rien de noté sans ressenti (FRE-160).
                "lignesSansRessenti": 0,
                "exercises": [
                    {**ligne, "id": f"{identifiant}-{i}-{j}",
                     # Le RÉALISÉ, vide : le contrat de lecture exige ces clés.
                     # ⚠️ Les SCALAIRES disent l'absence par `None` (FRE-137) ;
                     # les TABLEAUX restent des listes vides (FRE-62, FRE-111).
                     "repsDone": None, "weightDone": None, "restActual": None,
                     "feltRPE": None, "feltRPEBySet": [], "repsDoneBySet": [],
                     "weightDoneBySet": [], "toursRealises": None, "athleteFeedback": None,
                     "link": None, "mechano": None}
                    for j, ligne in enumerate(seance["exercises"])
                ],
            }
            for i, seance in enumerate(semaine["sessions"])
        ],
    }


def bloc_de_l_arbre(conn, program_id: str, block_id: str) -> dict[str, Any]:
    """Rend le bloc AVEC ses semaines et leur réalisé, dans la forme du contrat.

    ⚠️ Par `read_tree`, comme `relire_semaine` : le calcul de la semaine suivante
    lit des lignes complètes, et une requête dédiée divergerait du contrat.

    Raises:
        ErreurMetier: `objet_arbre_introuvable` (404)."""
    for macro in read_tree(conn, program_id)["macros"]:
        for bloc in macro["blocks"]:
            if bloc["id"] == block_id:
                return bloc
    raise ErreurMetier("objet_arbre_introuvable", status.HTTP_404_NOT_FOUND,
                       detail="bloc introuvable")


def relire_semaine(conn, program_id: str, week_id: str) -> dict[str, Any]:
    """Rend la semaine telle qu'elle EXISTE, relue par le chemin de lecture normal.

    ⚠️ `read_tree` plutôt qu'une requête dédiée : la réponse est identique, au
    champ près, à ce que le front reçoit en rechargeant l'arbre. Une seconde
    requête finit par diverger sur un champ ajouté d'un seul côté. Le coût —
    quelques SELECT — porte sur un geste rare.

    Raises:
        ErreurMetier: `objet_arbre_introuvable` (404)."""
    for macro in read_tree(conn, program_id)["macros"]:
        for bloc in macro["blocks"]:
            for semaine in bloc["weeks"]:
                if semaine["id"] == week_id:
                    return semaine
    raise ErreurMetier("objet_arbre_introuvable", status.HTTP_404_NOT_FOUND,
                       detail="semaine introuvable après génération")


# --------------------------------------------------------------------------- #
# Lectures et écritures de STRUCTURE — ce que les gestionnaires appellent
# --------------------------------------------------------------------------- #

#: camelCase du contrat → colonne d'un objectif de bloc.
_COLONNES_OBJECTIF = {"exercise": "exercise", "variant": "variant", "format": "format",
                      "sets": "sets", "reps": "reps", "weightMin": "weight_min",
                      "weightMax": "weight_max", "assistance": "assistance",
                      "atteintLe": "atteint_le"}


def supprimer_l_objet(conn, niveau: str, objet_id: str) -> None:
    """La cascade est tenue par les clés étrangères, dans la transaction."""
    conn.execute(text(f"DELETE FROM {_TABLES[niveau]} WHERE id = CAST(:id AS uuid)"),
                 {"id": objet_id})


def inserer_le_macro(conn, program_id: str, payload) -> tuple[str, bool]:
    """Rend l'id du macro, et s'il EXISTAIT déjà — un rejeu (cf. `retrouver`)."""
    macro_id = inserer_avec_numero(
        conn, "training_macros", "program_id", program_id, lambda numero: conn.execute(text(
            "INSERT INTO training_macros (id, program_id, legacy_id, number, name, "
            "training_frequency, coach_notes) "
            "VALUES (coalesce(CAST(:id AS uuid), gen_random_uuid()), :p, gen_random_uuid()::text, "
            ":n, :name, :f, :c) ON CONFLICT (id) DO NOTHING RETURNING id"),
            {"id": str(payload.id) if payload.id else None,
             "p": program_id, "n": numero, "name": payload.name,
             "f": payload.trainingFrequency, "c": payload.coachNotes}).scalar())
    if macro_id is None:
        return retrouver(conn, "training_macros", "program_id", program_id, payload.id), True
    return str(macro_id), False


def blocs_du_macro(conn, macro_id) -> int:
    return conn.execute(text(
        "SELECT count(*) FROM training_blocks WHERE macro_id = :m"),
        {"m": macro_id}).scalar()


def ecrire_la_base(conn, block_id: str, base) -> None:
    """Remplace INTÉGRALEMENT la trame : la méta du bloc, puis ses deux tables de lignes."""
    conn.execute(text(
        "UPDATE training_blocks SET day_split = CAST(:ds AS jsonb), "
        "selected_principals = :sp, granularity = CAST(:g AS jsonb), "
        "s1_start_date = :s1, s1_end_date = :s2 WHERE id = CAST(:id AS uuid)"),
        {"ds": json_ou_none(base.daySplit), "sp": base.selectedPrincipaux,
         "g": json_ou_none(base.granularity), "s1": base.s1StartDate,
         "s2": base.s1EndDate, "id": block_id})
    # ⚠️ Une nature par groupe (FRE-36) : la BASE arrive en dictionnaires LIBRES,
    # où deux accessoires liés peuvent annoncer deux natures.
    normaliser_groupes(base.accessories)
    for table, lignes in (("training_base_principles", base.principles),
                          ("training_base_accessories", base.accessories)):
        conn.execute(text(f"DELETE FROM {table} WHERE block_id = CAST(:b AS uuid)"),
                     {"b": block_id})
        for position, ligne in enumerate(lignes):
            inserer_ligne(conn, table, "block_id", block_id, position, ligne)


def redater_les_semaines(conn, block_id: str, dates: list) -> None:
    """⚠️ Le `AND block_id` sert d'appartenance : une semaine d'un autre bloc n'est pas touchée."""
    for d in dates:
        conn.execute(text(
            "UPDATE training_weeks SET start_date = :d1, end_date = :d2 "
            "WHERE id = CAST(:w AS uuid) AND block_id = CAST(:b AS uuid)"),
            {"d1": d.startDate, "d2": d.endDate, "w": d.weekId, "b": block_id})


def objectifs_du_bloc(conn, block_id: str) -> list:
    return conn.execute(OBJECTIFS_DU_BLOC, {"b": block_id}).mappings().all()


def remplacer_les_objectifs(conn, block_id: str, objectifs: list[dict]) -> list[dict]:
    """DELETE puis INSERT : un objectif n'a pas d'identité côté client, c'est sa
    POSITION dans la liste qui le désigne. Rend l'écho de ce qui a été écrit."""
    conn.execute(text("DELETE FROM block_objectives WHERE block_id = CAST(:b AS uuid)"),
                 {"b": block_id})
    sortie = []
    for position, obj in enumerate(objectifs):
        # ⚠️ `''` → NULL sur la date : `atteint_le` est une colonne `date`, et
        # décocher une case envoie `''`, que Postgres refuse (500). Le contrat
        # (`ObjectiveIn`, `vide_en_none`) convertit déjà ; le `or None` reste
        # comme filet.
        valeurs = {col: (obj.get(cle) or None) if col == "atteint_le" else obj.get(cle)
                   for cle, col in _COLONNES_OBJECTIF.items()}
        oid = conn.execute(text(
            "INSERT INTO block_objectives (block_id, position, "
            + ", ".join(_COLONNES_OBJECTIF.values()) + ") VALUES (CAST(:b AS uuid), :p, "
            + ", ".join(f":{c}" for c in _COLONNES_OBJECTIF.values()) + ") RETURNING id"),
            {"b": block_id, "p": position, **valeurs}).scalar()
        # ⚠️ L'écho rend ce qui a été ÉCRIT pour la date, pas ce qui a été reçu :
        # sinon il dirait `''` d'un champ qui vaut NULL en base, et la prochaine
        # lecture le contredirait. Les autres champs sont réémis tels quels
        # (cf. `ObjectifEcrit`).
        sortie.append({"id": str(oid),
                       **{k: valeurs[col] if col == "atteint_le" else obj.get(k)
                          for k, col in _COLONNES_OBJECTIF.items()}})
    return sortie


def seances_de_la_semaine(conn, week_id) -> int:
    """Le compte qui garde FRE-84 : on ne remplit qu'une semaine à ZÉRO séance."""
    return conn.execute(
        text("SELECT count(*) FROM training_sessions WHERE week_id = :w"),
        {"w": week_id},
    ).scalar()


def ecrire_l_instantane_athlete(conn, week_id: str, instantane: dict) -> None:
    conn.execute(text(
        "UPDATE training_weeks SET athlete_weight_kg = :w, athlete_height_cm = :h "
        "WHERE id = CAST(:id AS uuid)"),
        {"w": instantane.get("weight") or None,
         "h": instantane.get("height") or None, "id": week_id})


def vider_la_semaine(conn, week_id) -> None:
    conn.execute(text("DELETE FROM training_sessions WHERE week_id = :w"), {"w": week_id})


def marquer_la_seance_relue(conn, session_id, uid: str) -> None:
    conn.execute(RELIRE_SQL, {"sid": session_id, "uid": uid})


def retirer_la_relecture_de(conn, session_id) -> None:
    conn.execute(DERELIRE_SQL, {"sid": session_id})


def premiere_semaine_du_bloc(conn, block_id: str):
    return conn.execute(text(
        "SELECT id, number FROM training_weeks WHERE block_id = CAST(:b AS uuid) "
        "ORDER BY number LIMIT 1"), {"b": block_id}).mappings().first()


def inserer_la_semaine(conn, block_id: str, numero: int, semaine: dict):
    return conn.execute(text(
        "INSERT INTO training_weeks (block_id, legacy_id, number, name, hidden, "
        "start_date, end_date) VALUES (:b, gen_random_uuid()::text, :n, '', false, "
        ":d, :f) RETURNING id"),
        {"b": block_id, "n": numero,
         "d": date_ou_none(semaine["startDate"]),
         "f": date_ou_none(semaine["endDate"])}).scalar()


def dater_la_semaine(conn, week_id, semaine: dict) -> None:
    conn.execute(text(
        "UPDATE training_weeks SET start_date = :d, end_date = :f "
        "WHERE id = :w"),
        {"d": date_ou_none(semaine["startDate"]),
         "f": date_ou_none(semaine["endDate"]), "w": week_id})


def poser_une_ligne_vide(conn, session_id: str) -> None:
    """⚠️ `NULL` et non `''` (FRE-123) : le nom référence la bibliothèque, où aucune
    entrée ne s'appelle `''`. La lecture reconvertit `NULL → ''` pour le front."""
    conn.execute(text(
        "INSERT INTO training_exercises (session_id, position, name) "
        "VALUES (CAST(:s AS uuid), 0, NULL)"), {"s": session_id})


def ajouter_une_seance(conn, week_id, payload) -> str:
    position = conn.execute(text(
        "SELECT coalesce(max(position) + 1, 0) FROM training_sessions WHERE week_id = :w"),
        {"w": week_id}).scalar()
    session_id = conn.execute(text(
        "INSERT INTO training_sessions (id, week_id, legacy_id, position, name, "
        "session_date, form_of_the_day) "
        "VALUES (coalesce(CAST(:id AS uuid), gen_random_uuid()), :w, gen_random_uuid()::text, "
        ":p, :name, :d, :f) ON CONFLICT (id) DO NOTHING RETURNING id"),
        {"id": str(payload.id) if payload.id else None,
         "w": week_id, "p": position, "name": payload.name,
         "d": payload.sessionDate, "f": payload.formOfTheDay}).scalar()
    if session_id is None:
        return retrouver(conn, "training_sessions", "week_id", week_id, payload.id)
    return str(session_id)


def repositionner_les_seances(conn, week_id) -> None:
    """0..n-1 sans trou. La contrainte d'unicité est DEFERRABLE : les positions
    peuvent se croiser le temps de la transaction."""
    conn.execute(text(
        "UPDATE training_sessions s SET position = t.rang - 1 FROM ("
        "  SELECT id, row_number() OVER (ORDER BY position) AS rang "
        "  FROM training_sessions WHERE week_id = :w) t "
        "WHERE s.id = t.id AND s.position <> t.rang - 1"), {"w": week_id})


def ids_des_seances(conn, week_id) -> set[str]:
    return {str(r[0]) for r in conn.execute(text(
        "SELECT id FROM training_sessions WHERE week_id = :w"), {"w": week_id}).all()}


def poser_l_ordre_des_seances(conn, ids: list[str]) -> None:
    for position, sid in enumerate(ids):
        conn.execute(text("UPDATE training_sessions SET position = :p "
                          "WHERE id = CAST(:id AS uuid)"), {"p": position, "id": sid})
