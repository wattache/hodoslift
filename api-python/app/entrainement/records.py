"""Le tableau des records (« All Time PR ») et la TRACE de réalisation, version arbre (FRE-71).

La meilleure charge de chaque mouvement principal, de 1 à 10 répétitions.

⚠️ Calculé sur les tables VIVANTES, pas sur `training_sets` : la projection ne se
reconstruit que la nuit, et un PR doit s'afficher dès que l'athlète note son RPE.

⚠️ La règle de « réalisé » est TRANSPOSÉE de `TRACE` (`app/suivi/metier_tracking.py`),
qui parle à la projection typée ; ici tout est du texte. Deux dialectes d'une
règle dérivent : `test_records.py` compare les deux formulations sur la même donnée.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

# Les cinq mouvements qui ont une colonne dans le tableau.
MOUVEMENTS = ["MUSCLE UP", "PULL UP", "CHIN UP", "DIPS", "SQUAT"]

# ⚠️ La TRACE, version arbre vivant : un RPE ressenti — global ou par série — et
# rien d'autre. C'est la seule preuve qu'une série a eu lieu : une sensation ne
# se donne pas à la place de celui qui a poussé (FRE-71).
#
# ⚠️ PUBLIQUE (FRE-130) : `metier_training_structure` (ce qu'une suppression va
# détruire) et le guichet l'empruntent. La définition de « réalisé » n'existe
# qu'ICI ; préfixe `x` = `training_exercises`.
#
# `cardinality(...) > 0` et non `IS NOT NULL` : la colonne est un `text[]` qui
# peut valoir `{}`. La projection a déjà ce `nullif(…, '{}')` (`ff_rpe_by_set`),
# le brut non.
TRACE_ARBRE = """
    (coalesce(btrim(x.felt_rpe), '') <> ''
     OR cardinality(coalesce(x.felt_rpe_by_set, '{}')) > 0)
"""


def travail_note_sans_ressenti(alias: str = "x") -> str:
    """Rend le fragment SQL « du travail NOTÉ sans aucun ressenti » (FRE-160).

    Répétitions ou charge réelles, globales ou par série, et pas de RPE : le
    travail a eu lieu, il est écrit, et le suivi l'ignore parce que la trace ne
    le voit pas — un record possible qui n'apparaît pas. C'est le seul trou de
    saisie qui vaut d'être signalé.

    ⚠️ PAS « à RPE seul » : ne remplir que le RPE est l'usage NOMINAL — le prescrit
    fait foi tant que rien ne le contredit. Le signaler ferait un compteur qu'on
    apprend à ignorer.

    Définie ICI, à côté de la trace, et paramétrée par l'alias : la lecture de
    l'arbre (`training_tree`) l'emprunte sans en recopier une seconde version.
    """
    trace = TRACE_ARBRE.replace("x.", f"{alias}.")
    return f"""
    ((coalesce(btrim({alias}.reps_done), '') <> ''
      OR coalesce(btrim({alias}.weight_done), '') <> ''
      OR cardinality(coalesce({alias}.reps_done_by_set, '{{}}')) > 0
      OR cardinality(coalesce({alias}.weight_done_by_set, '{{}}')) > 0)
     AND NOT {trace})
"""

# La ligne porte-t-elle un ÉCHEC de série (FRE-110) ?
#
# ⚠️ Égalité EXACTE sur `'FAIL'`, comme le filtre global et comme le front. Un
# `LIKE '%FAIL%'` attraperait des ressentis écrits en prose, dont on ne sait pas
# s'ils disent l'échec de la série ou un commentaire.
_A_UN_ECHEC = """
    EXISTS (SELECT 1 FROM unnest(coalesce(x.felt_rpe_by_set, '{}')) v
             WHERE upper(btrim(v)) = 'FAIL')
"""

# ⚠️ Les séries tenues se COMPTENT, elles ne se déduisent pas d'une position.
#
# Pas « tout ce qui précède le premier FAIL » : un athlète reprend après un échec.
#
#     ['7.5','8','8','8.5','8.5','8.5','FAIL','9','8.5','9']  → 9 séries, pas 6
#     ['FAIL','8','9.5']                                      → 2 séries, pas 0
#
# ⚠️ Pas non plus `sets - nombre_de_FAIL`, qui INVENTE : sur `sets = 3` noté
# `['FAIL']`, elle affirme deux séries dont rien ne porte la trace. On ne compte
# que ce qui est NOTÉ. Sous-estimer est le bon sens de l'erreur : un record se
# prouve.
#
# ⚠️ Et une case unique ne se lit PAS comme « la dernière série » : le tableau se
# lit position par position, donc `['FAIL']` est la série 1. Une notation qui
# change de sens selon le nombre de cases remplies se paie longtemps.
_SERIES_TENUES = """
    (SELECT count(*) FROM unnest(coalesce(x.felt_rpe_by_set, '{}')) v
      WHERE btrim(v) <> '' AND upper(btrim(v)) <> 'FAIL')
"""

_RECORDS_SQL = text(f"""
    WITH lignes AS (
        SELECT
            x.name AS mouvement,
            -- ⚠️ LE RÉALISÉ PRIME SUR LE PRESCRIT, SUR LES DEUX AXES. Un 6
            -- prescrit réalisé en 8 est un record À 8, pas à 6 : la charge et
            -- les répétitions suivent la même règle, sinon la cellule mélange
            -- le fait et la consigne.
            essai.reps,
            essai.charge,
            -- ⚠️ LES SÉRIES TENUES, PAS LES SÉRIES PRESCRITES (FRE-110). Un
            -- 4×4 noté `9 · 9,5 · 10 · FAIL` est un 3×4. Le nombre est DÉCORATIF
            -- ici — il n'entre que dans le libellé « 3x4 @ 9 », les clés du
            -- record étant le mouvement et les répétitions, la valeur étant la
            -- charge. C'est pour le tonnage qu'il comptera vraiment.
            CASE WHEN {_A_UN_ECHEC} THEN {_SERIES_TENUES}::text
                 ELSE x.sets END AS sets,
            x.variant, x.format, x.cluster_mode,
            -- Le RPE affiché dans la cellule : le ressenti s'il existe, la
            -- cible sinon — comme le faisait le front.
            coalesce(nullif(btrim(x.felt_rpe), ''), x.aimed_rpe, '') AS rpe,
            s.session_date,
            -- ⚠️ LE REPLI SUR LE DÉBUT DE SEMAINE sert le GARDE-FOU DE DATE, pas
            -- l'affichage : une séance jamais lancée n'a pas de date propre, et
            -- sans repli une semaine programmée pour dans un mois passerait.
            coalesce(s.session_date, w.start_date) AS date_garde,
            -- ⚠️ `nullif(…, '')` ET NON `coalesce` SEUL : brokkr rend `''` et
            -- non NULL pour un niveau sans nom. Le repli ne se déclenchait
            -- jamais côté front tant qu'il utilisait `??`, et l'emplacement
            -- s'affichait « ROAD TO 100 ·  ·  ».
            coalesce(nullif(btrim(m.name), ''), 'Macro ' || m.number) AS macro,
            coalesce(nullif(btrim(b.name), ''), 'Bloc ' || b.number) AS bloc,
            coalesce(nullif(btrim(w.name), ''), 'S' || w.number) AS semaine
        FROM training_exercises x
        -- ⚠️ UN RECORD EST UNE PROPRIÉTÉ DE SÉRIE, PAS DE LIGNE (FRE-136).
        --
        -- `reps_done` et `weight_done` sont, depuis la saisie par série, la
        -- MOYENNE des séries calculée par le navigateur. Dix puis douze
        -- répétitions à 40 kg donnaient `reps_done = '11'` : un record à 11
        -- répétitions que personne n'a faites. Deux lignes de production le
        -- portent déjà — `['8','7','7']` rendu `7.3`, `['41','42']` rendu
        -- `41.5` — et aucune n'est encore un lift de compétition. La suivante
        -- le sera.
        --
        -- Chaque SÉRIE TENUE devient donc un candidat, avec SES répétitions et
        -- SA charge. C'est la même conclusion que FRE-71 §5 sur `date_exact` :
        -- un fait de série ne se lit pas sur l'agrégat de la ligne.
        --
        -- ⚠️ ET LA PREMIÈRE BRANCHE EST L'EXPRESSION D'AVANT, MOT POUR MOT. Une
        -- ligne sans détail par série produit donc exactement le même candidat
        -- qu'hier : c'est ce qui garantit qu'aucun des records existants ne
        -- bouge. Vérifié sur la production — zéro écart sur les 184.
        CROSS JOIN LATERAL (
            SELECT coalesce(ff_reps_low(nullif(btrim(x.reps_done), '')),
                            ff_reps_low(x.reps)) AS reps,
                   coalesce(ff_charge(nullif(btrim(x.weight_done), '')),
                            ff_charge(x.weight)) AS charge
             WHERE cardinality(coalesce(x.reps_done_by_set, '{{}}')) = 0
               AND cardinality(coalesce(x.weight_done_by_set, '{{}}')) = 0
            UNION ALL
            -- ⚠️ LA SÉRIE ÉCHOUÉE NE CONCOURT PAS, et elle se lit POSITION PAR
            -- POSITION — la même lecture que `_SERIES_TENUES`, jamais « tout ce
            -- qui précède le premier FAIL ». Une case vide en face d'une série
            -- notée en reps n'est pas un échec : sans information de RPE, la
            -- série compte.
            -- ⚠️ QUI REMPLIT PAR SÉRIE N'EST PLUS LU EN GLOBAL (FRE-156) : soit
            -- l'athlète remplit au global et ces valeurs comptent, soit il remplit
            -- par série et seules les séries remplies comptent.
            --
            -- Le repli sur le scalaire ne vaut donc que si le tableau N'EXISTE
            -- PAS. Quand il existe, le scalaire est la MOYENNE que le serveur en
            -- dérive (`ff_moyenne_serie`) : le lire à une position sans valeur
            -- fabriquerait une série qui n'a pas eu lieu. Une case vide rend
            -- NULL, et le filtre extérieur
            -- (`charge > 0 AND reps BETWEEN 1 AND 10`) écarte la série.
            --
            -- ⚠️ ET LE REPLI RESTE INDISPENSABLE DANS L'AUTRE SENS : des lignes
            -- portent des charges par série SANS répétitions par série —
            -- l'athlète a fait varier la charge et noté ses répétitions une
            -- fois. Là, `reps_done` est ce qu'il a TAPÉ, pas une moyenne —
            -- le supprimer remplacerait un fait par la consigne. Les trois
            -- tableaux sont indépendants, la règle se lit donc champ par champ.
            SELECT CASE WHEN cardinality(coalesce(x.reps_done_by_set, '{{}}')) > 0
                        THEN ff_reps_low(nullif(btrim(x.reps_done_by_set[i]), ''))
                        ELSE coalesce(ff_reps_low(nullif(btrim(x.reps_done), '')),
                                      ff_reps_low(x.reps))
                   END,
                   CASE WHEN cardinality(coalesce(x.weight_done_by_set, '{{}}')) > 0
                        THEN ff_charge(nullif(btrim(x.weight_done_by_set[i]), ''))
                        ELSE coalesce(ff_charge(nullif(btrim(x.weight_done), '')),
                                      ff_charge(x.weight))
                   END
              FROM generate_series(1, greatest(
                       cardinality(coalesce(x.reps_done_by_set, '{{}}')),
                       cardinality(coalesce(x.weight_done_by_set, '{{}}')))) AS i
             WHERE upper(btrim(coalesce(x.felt_rpe_by_set[i], ''))) <> 'FAIL'
        ) essai
        JOIN training_sessions s ON s.id = x.session_id
        JOIN training_weeks w ON w.id = s.week_id
        JOIN training_blocks b ON b.id = w.block_id
        JOIN training_macros m ON m.id = b.macro_id
        WHERE m.program_id = :pid
          AND x.name = ANY(:mouvements)
          -- ⚠️ UN ÉCHEC N'ANNULE QUE LUI-MÊME (FRE-110). Sur un 4×4 noté
          -- `9 · 9,5 · 10 · FAIL`, l'athlète a tenu trois séries de 4 à cette
          -- charge : écarter la ligne entière sur un FAIL global ferait
          -- disparaître les tentatives les plus lourdes, celles qui font record.
          --
          -- La règle lit le DÉTAIL PAR SÉRIE, qui est la seule source capable de
          -- dire OÙ l'échec s'est produit :
          --
          --   * au moins une série NOTÉE hors échec → la ligne vaut pour
          --     celles-là, et pour elles seules ;
          --   * que des FAIL          → rien n'a été tenu, la ligne sort ;
          --   * FAIL global sans détail → on ne sait pas, la ligne sort.
          --
          -- ⚠️ ET LE DÉTAIL L'EMPORTE SUR LE GLOBAL, y compris quand il est plus
          -- SÉVÈRE : une ligne notée `10` en global mais `['FAIL']` en détail
          -- ne tient pas de record.
          --
          -- Le dernier cas reste écarté faute d'information : un
          -- FAIL global sans détail peut vouloir dire « rien passé » comme
          -- « échoué à la dernière », et rien ne permet de trancher.
          AND (
            CASE WHEN {_A_UN_ECHEC}
                 THEN {_SERIES_TENUES} > 0
                 ELSE upper(coalesce(btrim(x.felt_rpe), '')) <> 'FAIL' END
          )
          AND {TRACE_ARBRE}
    )
    SELECT DISTINCT ON (mouvement, reps)
           mouvement, reps, charge, sets, variant, format, cluster_mode, rpe,
           session_date, macro, bloc, semaine
    FROM lignes
    WHERE charge > 0
      AND reps BETWEEN 1 AND 10
      AND (date_garde IS NULL OR date_garde <= current_date)
    ORDER BY mouvement, reps, charge DESC
""")


def lire_records(conn, program_id: str) -> list[dict[str, Any]]:
    """Rend la meilleure charge par (mouvement, répétitions), avec son contexte.

    `DISTINCT ON` plutôt qu'un `GROUP BY` avec `max()` : la cellule montre aussi
    où, quand et sous quelle forme le record a été fait (« 3x3 [DS] @ 9 »). Un
    `max()` obligerait à une seconde requête pour retrouver LA ligne qui le porte.
    """
    lignes = conn.execute(
        _RECORDS_SQL, {"pid": program_id, "mouvements": MOUVEMENTS}
    ).mappings().all()
    return [
        {
            "movement": r["mouvement"],
            "reps": int(r["reps"]),
            "weight": float(r["charge"]),
            "sets": r["sets"] or "",
            # Le LIBELLÉ, pas les atomes : un record est une ligne d'histoire figée,
            # pas une prescription qu'on rééditera.
            "variant": " + ".join(r["variant"] or []),
            "format": r["format"] or "",
            "clusterMode": r["cluster_mode"] or "",
            "rpe": r["rpe"] or "",
            "date": r["session_date"].isoformat() if r["session_date"] else "",
            "location": f"{r['macro']} · {r['bloc']} · {r['semaine']}",
        }
        for r in lignes
    ]
