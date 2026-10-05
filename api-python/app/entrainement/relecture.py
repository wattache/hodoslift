"""La relecture d'une séance par le coach, et ce qui la remet dans la file (guichet).

Sur `training_sessions` : `relue_le/par` (la coche) et `modifiee_le/par` (CHAQUE
écriture de ligne). La règle d'inclusion, `A_RELIRE_SQL`, n'est écrite qu'ICI.

⚠️ `modifiee_par` n'est pas décoratif : sans lui, le coach qui réordonne la séance
qu'il vient de relire la remet dans sa propre file.
⚠️ UNE fonction pour TOUS les chemins d'écriture (`routes_training_lines.py`, le
remplacement en bloc de `routes_training_structure.py`) : en oublier un seul — le
DELETE, le réordonnancement — fait une demi-règle.
"""

from datetime import date

from sqlalchemy import text

# ⚠️ La borne de MISE EN SERVICE. `relue_le` part vide : sans borne, tout
# l'historique tracé serait « non lu », sur un écran dont zéro ligne est la
# réussite.
#
# Une constante et pas un paramètre de requête : deux coachs voient la MÊME file.
# Et pas un `UPDATE` massif de `relue_le` sur l'existant : il affirmerait une
# relecture qui n'a pas eu lieu.
#
# ⚠️ Elle se compare au MARQUEUR `modifiee_le`, pas à une date de semaine
# (FRE-179) : `session_date` est NULL sur une semaine générée, et un repli sur le
# début de semaine exclurait à jamais les séances d'une semaine à cheval sur la
# borne. Le marqueur dit le FAIT : la trace a été écrite après la mise en
# service, ou non.
MISE_EN_SERVICE = date(2026, 9, 12)

# La règle d'inclusion, comme fragment SQL. Préfixe `s` = `training_sessions`.
#
# ⚠️ `IS DISTINCT FROM` et non `<>` : `modifiee_par` est NULL sur l'historique, et
# `NULL <> 'uid'` vaut NULL, donc faux — une séance de l'historique modifiée par
# l'athlète ne reviendrait JAMAIS. `test_guichet.py` le garde.
A_RELIRE_SQL = """
    (s.relue_le IS NULL
     OR (s.modifiee_le > s.relue_le
         AND s.modifiee_par IS DISTINCT FROM s.relue_par))
"""

# ⚠️ `clock_timestamp()` et non `now()`, qui est l'instant du DÉBUT de la
# transaction. Ce qu'on note est l'instant de l'ÉCRITURE ; et dans la suite de
# tests, où chaque test tient dans UNE transaction, `modifiee_le > relue_le` ne
# serait jamais vrai. Même choix pour la coche (`metier_training_structure.py`),
# le signalement (`routes_daily_logs.py`) et le défaut de `signalement_vu.vu_le`.
_MARQUER_SQL = text(
    "UPDATE training_sessions SET modifiee_le = clock_timestamp(), modifiee_par = :uid "
    "WHERE id = CAST(:sid AS uuid)"
)

_MARQUER_SEMAINE_SQL = text(
    "UPDATE training_sessions SET modifiee_le = clock_timestamp(), modifiee_par = :uid "
    "WHERE week_id = CAST(:wid AS uuid)"
)


def marquer_modifiee(conn, session_id, uid: str) -> None:
    """Note que la séance vient d'être écrite par `uid`.

    S'appelle DANS la transaction de l'écriture, après elle : si l'écriture
    échoue, l'horodatage tombe avec. `session_id` accepte l'uuid tel que les
    requêtes d'appartenance le rendent (objet UUID ou texte).
    """
    conn.execute(_MARQUER_SQL, {"sid": str(session_id), "uid": uid})


def marquer_semaine_modifiee(conn, week_id, uid: str) -> None:
    """Note l'écriture sur TOUTES les séances d'une semaine — pour le remplacement en bloc."""
    conn.execute(_MARQUER_SEMAINE_SQL, {"wid": str(week_id), "uid": uid})
