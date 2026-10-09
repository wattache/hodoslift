"""Les requêtes du suivi, et les règles qui décident de ce qu'il montre.

⚠️ Le suivi n'affiche que ce qui porte une TRACE de réalisation (`TRACE`) : un
RPE ressenti. Ni la date ni la prescription ne prouvent qu'une série a eu lieu.

Les courbes lisent la projection `training_sets` (reconstruite chaque nuit) ; ce
qui se demande AU PRÉSENT — les séries par lift, la forme du jour — lit les
tables vivantes. Aucun gestionnaire HTTP ici : `routes_tracking.py` les porte.
"""

from sqlalchemy import text


# --------------------------------------------------------------------------- #
# LE SUIVI NE MONTRE QUE CE QUI A ÉTÉ FAIT — pas ce qui est prévu.
#
# Le critère n'est pas QUAND, c'est SI ÇA A EU LIEU. `session_date` vaut la date
# de séance si l'athlète l'a lancée, SINON le début de la semaine (repli). La date
# seule ne suffit donc pas : le lundi, tout le programme de la semaine à venir
# passe `<= current_date`, avec sa PRESCRIPTION.
#
# ⚠️ La seule trace est le RPE RESSENTI : c'est une sensation, personne ne peut
# la donner à la place de celui qui a poussé. Les autres candidats ne prouvent
# rien :
#
#  · `date_exact` est un signal de SÉANCE, pas de ligne : il vaut vrai dès le
#    LANCEMENT. Ouvrir l'app, noter sa forme et repartir ferait compter TOUTES
#    les lignes de la séance, avec leur charge prescrite. Et il manque à tout
#    l'historique d'avant la fonctionnalité, pourtant bel et bien entraîné ;
#  · `athlete_feedback` est du texte libre, qui dit aussi bien « pas fait » ;
#  · `weight_done_kg` et `reps_done` peuvent être pré-remplis ou corrigés par le
#    coach, là où un RPE ne le peut pas.
#
# La date reste en garde-fou (`REALISE`) : une ligne datée demain n'a pas eu
# lieu, quoi qu'elle porte par ailleurs.
# La trace est `training_sets.tracee`, engendrée par `ff_tracee` — la même
# fonction que l'arbre (FRE-216). Les requêtes d'ici ne la recopient pas : elles
# lisent les vues `series_realisees` (une trace, pas dans le futur) et
# `series_de_travail` (idem, sans échauffement ni rééducation — FRE-10).
#
# ⚠️ La trace est PARTAGÉE, la politique de date ne l'est pas : les agrégats
# exigent une date pour ranger la ligne dans une semaine, le sélecteur garde les
# lignes sans date — la vue les garde, chaque agrégat ajoute
# `session_date IS NOT NULL`.

# Les mouvements de l'athlète, les plus travaillés d'abord, pour le sélecteur du
# front. Un mouvement seulement PRÉVU n'y figure pas.
#
# ⚠️ Ici on GARDE les lignes sans date, contrairement aux agrégats : une ligne
# sans `session_date` n'est pas du futur, c'est de l'historique dont ni la séance
# ni la semaine ne sont datées. Les écarter ferait disparaître du sélecteur des
# mouvements réellement travaillés.
EXERCISES_SQL = text(
    "SELECT exercise, count(*) AS n FROM series_realisees "
    "WHERE athlete_id = :legacy "
    "GROUP BY exercise ORDER BY n DESC, exercise"
)

# L'agrégat hebdomadaire d'UN mouvement. `charge_max` est la charge EFFECTIVE —
# réalisée si saisie, sinon prescrite (FRE-18) : « charge max » désigne ce qui a
# été SOULEVÉ. Calculée en fenêtre, pour filtrer ensuite les lignes qui SONT au
# max (tonnage, format et échecs du top set).
WEEKS_SQL = text(
    """
    WITH base AS (
        SELECT date_trunc('week', session_date)::date AS semaine,
               coalesce(weight_done_kg, weight_kg) AS charge_eff,
               tonnage_kg, tonnage_prevu_kg, sets, sets_prevus, reps, reps_done, felt_rpe, aimed_rpe,
               felt_rpe_raw, reps_unit,
               macro_number, block_number, week_number, session_index,
               max(coalesce(weight_done_kg, weight_kg))
                   OVER (PARTITION BY date_trunc('week', session_date))
                   AS charge_max_kg
        -- FRE-10 : seul l'ENTRAÎNEMENT compte (tonnage, volume, charge max,
        -- records) — c'est ce que `series_de_travail` écarte.
        FROM series_de_travail
        WHERE athlete_id = :legacy AND exercise = :exercise
          AND session_date IS NOT NULL
    )
    SELECT semaine,
           max(charge_max_kg) AS charge_max_kg,
           sum(tonnage_kg) FILTER (WHERE charge_eff = charge_max_kg) AS tonnage_at_max_kg,
           -- Format du TOP SET (« 3×2 ») : ce qui distingue un single d'un vrai
           -- travail lourd à charge égale. Plusieurs formats à la même charge
           -- (deux séances différentes) → « 3×2 + 1×3 ». trim_scale enlève les
           -- décimales inutiles (3.0 → 3). Reps RÉALISÉES si saisies.
           string_agg(
               DISTINCT trim_scale(sets)::text || '×'
                        || trim_scale(coalesce(reps_done, reps))::text,
               ' + '
           ) FILTER (WHERE charge_eff = charge_max_kg) AS top_set_format,
           sum(tonnage_kg) AS tonnage_total_kg,
           -- ⚠️ LE REPÈRE DU PRESCRIT (FRE-110) : le tonnage qu'aurait donné la
           -- semaine si aucune série n'avait échoué. `sets` compte les séries
           -- TENUES, donc une séance toute en échecs tombe à zéro — sans
           -- ce second point, la courbe plonge et se lit « il n'est pas venu »
           -- alors qu'il était là, sous une barre trop lourde.
           --
           -- Égal au tonnage tenu partout où rien n'a échoué : le graphe compare
           -- les deux et ne dessine le repère que s'ils diffèrent. Rien à
           -- filtrer ici.
           sum(tonnage_prevu_kg) AS tonnage_prevu_total_kg,
           -- Les isométries sont EXCLUES du volume (FRE-20) : « 3 × 60 s »
           -- comptait pour 180 répétitions, soit 11,8 % du volume total, alors
           -- qu'aucune n'a été exécutée. `reps` y porte des secondes. Le
           -- tonnage, lui, s'auto-corrige : l'ETL le laisse NULL et `sum()` les
           -- ignore. IS DISTINCT FROM pour couvrir les lignes sans unité d'une
           -- projection antérieure à la migration "" → "count".
           sum(sets * coalesce(reps_done, reps))
               FILTER (WHERE reps_unit IS DISTINCT FROM 'sec') AS reps_total,
           -- Le repère du volume en reps (FRE-110), pendant de `tonnage_prevu` :
           -- `sets` compte les séries TENUES, donc ce total baisse exactement
           -- comme le tonnage. Même règle, même raison, même égalité quand rien
           -- n'a échoué.
           sum(sets_prevus * coalesce(reps_done, reps))
               FILTER (WHERE reps_unit IS DISTINCT FROM 'sec') AS reps_prevu_total,
           avg(felt_rpe) AS felt_rpe,
           avg(aimed_rpe) AS aimed_rpe,
           count(DISTINCT (week_number, session_index)) AS sessions,
           -- ÉCHECS : saisis en toutes lettres dans le RPE ressenti (« FAIL »),
           -- donc invisibles dans la moyenne numérique. Ceux qui tombent SUR la
           -- charge max sont les plus parlants : la prescription a dépassé.
           count(*) FILTER (WHERE upper(trim(felt_rpe_raw)) = 'FAIL') AS fails,
           count(*) FILTER (WHERE upper(trim(felt_rpe_raw)) = 'FAIL'
                              AND charge_eff = charge_max_kg) AS fails_at_max,
           min(macro_number) AS macro_number,
           min(block_number) AS block_number
    FROM base
    GROUP BY semaine
    ORDER BY semaine
    """
)

# UNE COURBE PAR COMBINAISON — (variante, tempo, format) — pour le mouvement
# choisi (FRE-182).
#
# ⚠️ Un seul nom porte plusieurs échelles de charge, et c'est la variante qui
# les distingue (FRE-11) : haltères et barre de compétition sous le même nom
# donneraient une courbe qui ne dit rien.
#
# ⚠️ Les variantes sont TRIÉES avant de regrouper : `{PAUSE, BARBELL}` et
# `{BARBELL, PAUSE}` sont le même geste, saisi dans deux ordres. `''` et NULL
# sont confondus en « rien » pour la même raison — une combinaison « sans tempo »
# ne se coupe pas en deux selon l'encodage.
#
# Les métriques sont un sous-ensemble de celles de `WEEKS_SQL` : charge max,
# format du top set, tonnage, séances, échecs. Même filtre de réalisé, même
# exclusion échauffement/kiné.
COURBES_SQL = text(
    """
    WITH base AS (
        SELECT date_trunc('week', session_date)::date AS semaine,
               (SELECT coalesce(array_agg(v ORDER BY v), '{}')
                  FROM unnest(coalesce(variant, '{}')) v
                 WHERE btrim(v) <> '') AS variantes,
               coalesce(nullif(btrim(tempo), ''), '') AS tempo_cle,
               coalesce(nullif(btrim(format), ''), '') AS format_cle,
               coalesce(weight_done_kg, weight_kg) AS charge_eff,
               tonnage_kg, sets, reps, reps_done, felt_rpe_raw,
               week_number, session_index
        FROM series_de_travail
        WHERE athlete_id = :legacy AND exercise = :exercise
          AND session_date IS NOT NULL
    ), fenetre AS (
        SELECT *,
               max(charge_eff) OVER (PARTITION BY variantes, tempo_cle, format_cle, semaine) AS charge_max_kg,
               count(*) OVER (PARTITION BY variantes, tempo_cle, format_cle) AS series_de_la_courbe
        FROM base
    )
    SELECT variantes, tempo_cle, format_cle, semaine,
           max(series_de_la_courbe) AS series,
           max(charge_max_kg) AS charge_max_kg,
           string_agg(
               DISTINCT trim_scale(sets)::text || '×'
                        || trim_scale(coalesce(reps_done, reps))::text,
               ' + '
           ) FILTER (WHERE charge_eff = charge_max_kg) AS top_set_format,
           sum(tonnage_kg) AS tonnage_total_kg,
           count(DISTINCT (week_number, session_index)) AS sessions,
           count(*) FILTER (WHERE upper(trim(felt_rpe_raw)) = 'FAIL') AS fails
    FROM fenetre
    GROUP BY variantes, tempo_cle, format_cle, semaine
    ORDER BY series DESC, variantes, tempo_cle, format_cle, semaine
    """
)


# Le RPE hebdomadaire de l'ATHLÈTE, tous mouvements confondus, indépendant du
# mouvement sélectionné. Le ressenti se saisit largement sur le renfo : filtré
# sur un seul mouvement, il fait paraître l'athlète plus frais qu'il ne l'est.
# C'est la charge vécue de la semaine qui compte, pas celle d'un exercice.
ATHLETE_WEEKS_SQL = text(
    """
    SELECT date_trunc('week', session_date)::date AS semaine,
           avg(felt_rpe) AS felt_rpe,
           avg(aimed_rpe) AS aimed_rpe,
           count(DISTINCT (week_number, session_index)) AS sessions,
           -- Repères de phase, pour tracer les mêmes bandes que le graphe du
           -- dessus (un pic de RPE se lit autrement s'il ouvre un bloc).
           min(macro_number) AS macro_number,
           min(block_number) AS block_number
    FROM series_realisees
    WHERE athlete_id = :legacy AND session_date IS NOT NULL
    GROUP BY semaine
    ORDER BY semaine
    """
)

# Le calibrage RPE PAR BLOC, tous mouvements confondus : un bloc où le ressenti
# dépasse durablement le prescrit était plus dur que prévu. Un bloc sans aucun
# RPE cible est exclu — mieux vaut une barre absente qu'un écart calculé sur du
# vide.
RPE_BLOCKS_SQL = text(
    """
    SELECT macro_number, block_number,
           min(session_date) AS from_date,
           max(session_date) AS to_date,
           count(DISTINCT week_number) AS weeks,
           -- Les trois moyennes portent sur les MÊMES lignes (celles qui ont
           -- ressenti ET cible), sinon « ressenti − cible » ne retomberait pas
           -- sur l'écart affiché.
           avg(felt_rpe) FILTER (WHERE aimed_rpe IS NOT NULL) AS felt_rpe,
           avg(aimed_rpe) FILTER (WHERE felt_rpe IS NOT NULL) AS aimed_rpe,
           avg(felt_rpe - aimed_rpe) AS gap,
           count(*) FILTER (WHERE aimed_rpe IS NOT NULL AND felt_rpe IS NOT NULL) AS rated
    FROM series_realisees
    WHERE athlete_id = :legacy AND session_date IS NOT NULL
      AND macro_number IS NOT NULL AND block_number IS NOT NULL
    GROUP BY macro_number, block_number
    HAVING count(*) FILTER (WHERE aimed_rpe IS NOT NULL AND felt_rpe IS NOT NULL) > 0
    ORDER BY min(session_date)
    """
)

# LES SÉRIES PAR SEMAINE, SUR LES MOUVEMENTS DE COMPÉTITION (FRE-148).
#
# « Combien de séries de squat cette semaine, contre le muscle up ? » — TOUS les
# lifts côte à côte, une seule métrique, à l'inverse de `WEEKS_SQL` qui creuse UN
# mouvement sur toutes ses métriques.
#
# ⚠️ SUR LES TABLES VIVANTES, PAS SUR LA PROJECTION. `training_sets` a une nuit
#    de retard, et « où en est le volume » se pose au présent : sur la
#    projection, l'athlète qui vient de s'entraîner lit 0. Même critère que pour
#    les RECORDS. Le graphe voisin garde la projection : il agrège tout
#    l'historique, une nuit n'y change rien.
#
# ⚠️ Les séries TENUES (FRE-110) ne sont pas une colonne de l'arbre mais une
#    dérivation : quand une série porte `FAIL`, on compte les séries notées qui
#    n'en sont pas. Elle vit dans `ff_series_tenues`, appelée ICI et par l'ETL :
#    deux appelants, UNE définition. Ne pas la recopier.
#
# ⚠️ LA LISTE DES LIFTS SE LIT, ELLE NE S'ÉCRIT PAS : c'est la jointure sur
#    `library_entries.competition` (FRE-147). Ajouter un lift à la bibliothèque
#    suffit ; les énumérer ici en ferait une copie de plus. Sensible à la CASSE,
#    et c'est sûr : `training_exercises.name` porte une clé étrangère vers
#    `library_entries` (FRE-123).
#
# ⚠️ LE FILTRE DE TRACE NE PORTE QUE SUR LE FAIT, JAMAIS SUR LE PRESCRIT.
#    L'appliquer aux deux rendrait 0/0 sur toute semaine où l'athlète n'est pas
#    venu. C'est le couple qui distingue les trois situations :
#
#      0 fait / 0 prescrit → rien n'était prévu ce mouvement-là
#      0 fait / 7 prescrit → prévu, pas fait
#      6 fait / 7 prescrit → fait, une série est tombée (FRE-110)
#
#    Une semaine EN COURS s'affiche comme les autres : 0 fait n'y est pas un
#    mensonge, c'est en cours.
#
# ⚠️ MAIS LA BORNE DU FUTUR RESTE. Les trames à venir sont déjà dans l'arbre :
#    sans elle, le programme du mois prochain s'afficherait comme un manquement.
#    La date est celle que l'athlète a posée en lançant, sinon le début de
#    semaine : le MÊME repli que l'ETL.
#
# ⚠️ ET LES ISOMÉTRIES COMPTENT ICI, contrairement aux répétitions. `reps_total`
#    exclut `reps_unit = 'sec'` (FRE-20), mais une SÉRIE reste une série quelle
#    que soit son unité : un gainage 3 × 60 s, c'est trois séries. Ne pas
#    recopier ce filtre par symétrie.
SERIES_PAR_LIFT_SQL = text(
    """
    WITH lignes AS (
        SELECT coalesce(s.session_date, w.start_date) AS jour,
               e.name AS mouvement,
               ff_series_tenues(e.sets, e.felt_rpe_by_set) AS tenues,
               round(ff_num(e.sets))::int AS prescrites,
               -- La MÊME trace que les agrégats du suivi : un RPE ressenti ne
               -- peut pas exister sans que la série ait eu lieu. Ici sur les
               -- colonnes de l'ARBRE, dont l'ETL tire `felt_rpe_raw` et
               -- `rpe_by_set` — mêmes champs, avant projection.
               ff_tracee(e.felt_rpe, e.felt_rpe_by_set) AS faite
        FROM training_exercises e
        JOIN training_sessions  s ON s.id = e.session_id
        JOIN training_weeks     w ON w.id = s.week_id
        JOIN training_blocks    b ON b.id = w.block_id
        JOIN training_macros    m ON m.id = b.macro_id
        JOIN programs           p ON p.id = m.program_id
        JOIN athletes           a ON a.id = p.athlete_id
        JOIN library_entries   le ON le.category = 'exercices'
                                 AND le.name = e.name AND le.competition
                                 -- la bibliothèque DE SA STRUCTURE (FRE-13)
                                 AND le.structure = e.structure
        WHERE a.legacy_id = :legacy
          -- FRE-10 : seul l'ENTRAÎNEMENT compte. `IS DISTINCT FROM` et non
          -- `<>` : une ligne sans `kind` vaut NULL et serait exclue à tort,
          -- soit tout l'historique d'avant le champ.
          AND e.kind IS DISTINCT FROM 'warmup'
          AND e.kind IS DISTINCT FROM 'rehab'
    )
    SELECT date_trunc('week', jour)::date AS semaine,
           mouvement,
           -- `coalesce(…, 0)` DÉLIBÉRÉ : une somme de séries non faites vaut
           -- ZÉRO séries, ce qui est un
           -- fait. C'est sur une MOYENNE que le zéro mentirait.
           coalesce(sum(tenues) FILTER (WHERE faite), 0) AS sets_faits,
           coalesce(sum(prescrites), 0) AS sets_prescrits
    FROM lignes
    WHERE jour IS NOT NULL AND jour <= current_date
    GROUP BY semaine, mouvement
    ORDER BY semaine, mouvement
    """
)

LAST_SESSION_SQL = text(
    "SELECT max(session_date) FROM series_realisees WHERE athlete_id = :legacy"
)

ONE_RM_SQL = text(
    "SELECT (current_one_rm->>:key)::numeric FROM athletes WHERE legacy_id = :legacy"
)

# ⚠️ La règle de date de la forme du jour vit ICI, pas au front (FRE-119) :
# `coalesce(session_date, week.start_date)`. Le repli n'est pas cosmétique — une
# forme notée sur une séance SANS date, dans une semaine datée, disparaîtrait
# sans lui.
#
# L'approximation est assumée : plusieurs séances d'une même semaine non datée
# retombent au même jour. Un repli plus fin — début de semaine + `position` —
# serait FAUX : `position` ordonne les séances existantes et ne dit pas le jour.
FORME_DU_JOUR = text("""
    SELECT coalesce(s.session_date, w.start_date) AS jour,
           s.form_of_the_day                      AS forme
    FROM training_sessions s
    JOIN training_weeks w   ON w.id = s.week_id
    JOIN training_blocks b  ON b.id = w.block_id
    JOIN training_macros m  ON m.id = b.macro_id
    JOIN programs p         ON p.id = m.program_id
    JOIN athletes a         ON a.id = p.athlete_id
    WHERE a.legacy_id = :legacy
      AND s.form_of_the_day IS NOT NULL
      AND coalesce(s.session_date, w.start_date) >= CAST(:depuis AS date)
    ORDER BY 1
""")


def courbes_par_combinaison(rows) -> list[dict]:
    """Regroupe les semaines de `COURBES_SQL` par combinaison.

    L'ordre du SQL est conservé : la plus travaillée d'abord — c'est elle que
    l'écran allume par défaut.
    """
    courbes: dict[tuple, dict] = {}
    for r in rows:
        cle = (tuple(r.variantes), r.tempo_cle, r.format_cle)
        courbe = courbes.setdefault(cle, {
            "variant": list(r.variantes),
            # `None` et pas `''` : « pas de tempo » est une absence (FRE-137).
            "tempo": r.tempo_cle or None,
            "format": r.format_cle or None,
            "series": r.series,
            "weeks": [],
        })
        courbe["weeks"].append({
            "week": r.semaine.isoformat(),
            "chargeMaxKg": num(r.charge_max_kg),
            "topSetFormat": r.top_set_format,
            "tonnageTotalKg": num(r.tonnage_total_kg),
            "sessions": r.sessions,
            "fails": r.fails,
        })
    return list(courbes.values())

# Le 1RM de PROGRAMMATION (`athletes.current_one_rm`), ligne de référence du
# graphe : les charges s'y lisent en % du max. Même unité que `weight_kg` — le
# LEST seul, poids de corps exclu.
_ONE_RM_KEYS = {
    "SQUAT": "squat",
    "DIPS": "dip",
    "DIP": "dip",
    "PULL UP": "pullUp",
    "MUSCLE UP": "muscleUp",
    "CHIN UP": "chinUp",
    # FRE-147 : la Table RM les porte, donc le graphe aussi. Les graphies sont
    # celles de la bibliothèque, à la lettre — la clé étrangère de FRE-123
    # garantit qu'aucune autre n'existe dans l'arbre.
    "BENCH PRESS": "benchPress",
    "DEADLIFT": "deadlift",
}


def one_rm_key(exercise: str) -> str | None:
    """Rend la clé 1RM d'un mouvement, `None` s'il n'a pas de 1RM de programmation."""
    return _ONE_RM_KEYS.get(exercise.strip().upper())


def num(value) -> float | None:
    """Convertit un `Decimal` (numeric Postgres) en float sérialisable en JSON."""
    return float(value) if value is not None else None


def pick_exercise(exercises: list[dict], requested: str | None) -> str | None:
    """Choisit le mouvement à afficher : celui demandé s'il existe, sinon le principal.

    `exercises` est trié par volume décroissant. Un mouvement inconnu retombe sur
    le principal plutôt que de produire une page vide.
    """
    if not exercises:
        return None
    if requested and any(e["name"] == requested for e in exercises):
        return requested
    return exercises[0]["name"]


# --------------------------------------------------------------------------- #
# Les requêtes, une fonction chacune — ce que les gestionnaires appellent
# --------------------------------------------------------------------------- #


def weeks(session, *, legacy, exercise):
    return session.execute(WEEKS_SQL, {"legacy": legacy, "exercise": exercise}).all()


def last_session(session, *, legacy):
    return session.execute(LAST_SESSION_SQL, {"legacy": legacy}).scalar()


def athlete_weeks(session, *, legacy):
    return session.execute(ATHLETE_WEEKS_SQL, {"legacy": legacy}).all()


def rpe_blocks(session, *, legacy):
    return session.execute(RPE_BLOCKS_SQL, {"legacy": legacy}).all()


def series_par_lift(session, *, legacy):
    return session.execute(SERIES_PAR_LIFT_SQL, {"legacy": legacy}).all()


def courbes(session, *, legacy, exercise):
    return session.execute(COURBES_SQL, {"legacy": legacy, "exercise": exercise}).all()


def one_rm(session, *, key, legacy):
    return session.execute(ONE_RM_SQL, {"key": key, "legacy": legacy}).scalar()


def exercises(session, *, legacy):
    return session.execute(EXERCISES_SQL, {"legacy": legacy}).all()


def forme_du_jour(session, *, legacy, depuis):
    return session.execute(FORME_DU_JOUR, {"legacy": legacy, "depuis": depuis}).mappings().all()


def programme_de_l_athlete(session, legacy: str):
    return session.execute(text(
        "SELECT id FROM programs WHERE athlete_id = "
        "(SELECT id FROM athletes WHERE legacy_id = :legacy)"),
        {"legacy": legacy}).scalar()
