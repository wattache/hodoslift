"""Projection ANALYTICS : l'arbre d'entraînement Postgres → table plate `training_sets`.

Ce n'est PAS un ETL de migration (aucun domaine ne bascule ici) : c'est une
PROJECTION DÉRIVÉE, reconstruite intégralement à chaque exécution. La source de
vérité reste l'arbre relationnel ; rien n'est perdu si la table est vidée. D'où
l'absence de garde-fou `_cutover` : réécrire cette table n'écrase aucune donnée
vivante.

⚠️ CE SCRIPT NE FAIT PLUS DE PYTHON, ET C'EST TOUT LE PROPOS. Il lisait Firestore
et parcourait l'arbre document par document — 421 lignes d'extraction et de
parsing. Depuis FRE-12 la source est dans LA MÊME BASE que la cible : il ne reste
donc rien à transporter, et un `INSERT … SELECT` remplace le tout. Le parsing
vit désormais dans les fonctions `ff_*` (migration 2026-08-17), au plus près de
la donnée.

Si vous vous surprenez à vouloir remettre du Python entre les deux, demandez-vous
d'abord ce qu'il transporterait : lire une table Postgres pour réécrire dans une
autre table de la même base, c'est une copie, pas un transport.

GRAIN : une ligne par EXERCICE d'une séance d'une semaine (pas par série) — dans
la source, sets/reps/weight sont portés par la ligne d'exercice ; seul le RPE
existe par série (`felt_rpe_by_set`, gardé en tableau). Exploser en lignes-séries
fabriquerait de la donnée qui n'existe pas.

Rejoué automatiquement par le Cloud Run Job `training-analytics-refresh`
(nidavellir/analytics.tf). Reste lançable à la main pour un rafraîchissement
immédiat.

Usage :
    DATABASE_URL=postgresql://… uv run python -m scripts.etl_training_sets
    #                                                    … --apply pour écrire
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import text

# --------------------------------------------------------------------------- #
# LA PROJECTION — une seule requête.
#
# Deux niveaux : `prescription` parse une fois, la couche du dessus dérive le
# tonnage. Sans ce découpage, `tonnage_kg` réévaluerait quatre expressions
# rationnelles déjà calculées.
# --------------------------------------------------------------------------- #

_PROJECTION = """
WITH prescription AS (
    SELECT
        a.legacy_id AS athlete_id,
        p.id        AS program_id,
        m.number    AS macro_number,
        b.number    AS block_number,
        w.number    AS week_number,
        s.position  AS session_index,
        nullif(btrim(s.name), '') AS session_name,
        -- Date de séance si l'athlète l'a lancée, sinon début de semaine.
        coalesce(s.session_date, w.start_date) AS session_date,
        (s.session_date IS NOT NULL)           AS date_exact,
        e.position    AS exercise_index,
        -- ⚠️ PLUS DE `upper()` DEPUIS FRE-123, ET C'EST LA CONTRAINTE QUI LE
        -- PERMET. La normalisation existait parce que la source pouvait porter
        -- n'importe quelle casse ; `training_exercises.name` référence désormais
        -- `library_entries`, donc elle porte EXACTEMENT l'orthographe de la
        -- bibliothèque.
        --
        -- Et la garder serait devenu DANGEREUX : `training_sets.exercise` a sa
        -- propre clé étrangère. Le jour où une entrée s'appellerait « Pec deck »,
        -- `upper()` en ferait « PEC DECK » — un nom que la bibliothèque ne porte
        -- pas — et le rebuild nocturne ENTIER échouerait. Les 101 entrées sont
        -- majuscules aujourd'hui ; c'est un état de fait, pas une garantie.
        e.name AS exercise,
        e.id          AS exercise_id,
        -- ⚠️ `nullif(btrim(…), '')` SUR TOUTE COLONNE DE TEXTE RECOPIÉE, et pas
        -- seulement sur celles qu'on parse. Le front écrit `''` là où il n'y a
        -- rien ; une table de faits veut NULL, sinon `count()` compte les vides
        -- et `GROUP BY` fabrique une catégorie « chaîne vide ». C'est ce que
        -- faisait `_text()` dans l'ancien ETL, sur CHAQUE champ texte.
        --
        -- Le laisser passer ici est passé sous le radar de la preuve par `raw` :
        -- elle comparait les colonnes PARSÉES, pas celles recopiées telles
        -- quelles. C'est un test qui l'a rattrapé — d'où sa présence explicite
        -- dans `test_etl_training_sets.py`.
        --
        -- `variant` : `{}` n'est pas « une variante vide », c'est pas de
        -- variante (FRE-50 — et l'ancien ETL rendait NULL sur les listes).
        nullif(e.variant, '{}')             AS variant,
        nullif(btrim(e.assistance), '')     AS assistance,
        nullif(btrim(e.tempo), '')          AS tempo,
        nullif(btrim(e.format), '')         AS format,
        e.tier,
        nullif(btrim(e.group_id), '')       AS superset_group,
        -- ⚠️ LES SÉRIES TENUES, PAS LES SÉRIES PRESCRITES (FRE-110). Un `FAIL`
        -- par série dit qu'une série n'a pas eu lieu : la compter chargerait le
        -- tonnage d'un travail qui n'a pas été fait. Mesuré sur la production
        -- avant de changer : 81 lignes concernées, 36 731 kg comptés pour
        -- 9 093 réellement tenus — dont 51 lignes qui tombent à zéro.
        --
        -- La règle est LA MÊME que celle des records (`app/entrainement/records.py`), écrite
        -- dans l'autre dialecte : on COMPTE les séries notées hors échec, sans
        -- regarder où l'échec se trouve. Deux formules ont été écartées, et
        -- `test_etl_training_sets.py` les tient toutes deux :
        --
        --   * « avant le premier FAIL » suppose qu'on s'arrête au premier
        --     échec — 9 lignes de production portent des valeurs APRÈS ;
        --   * « sets moins le nombre de FAIL » INVENTE : sur `sets = 3` noté
        --     `['FAIL']`, elle affirme deux séries dont rien ne porte la trace.
        --
        -- ⚠️ « SI RIEN N'EST REMPLI, ALORS RIEN N'EST FAIT » (William, 01/09).
        -- Ces lignes-là sont 31 et pèsent 12 t sur les 27,6 de correction : la
        -- tentation de lire une case unique comme « la dernière série » est donc
        -- chiffrée, et refusée. Elle ferait coexister deux lectures du même
        -- tableau — `['7','7.5','FAIL']` se lit position par position, donc
        -- `['FAIL']` est la série 1.
        --
        -- ⚠️ ET CE N'EST PAS UN FILTRE : la ligne reste, avec zéro série. Elle
        -- garde sa charge, son RPE, sa trace d'échec — c'est le tonnage qui
        -- vaut zéro, pas la séance qui disparaît.
        -- ⚠️ LA RÈGLE A DÉMÉNAGÉ DANS `ff_series_tenues` (07/09, FRE-148), et le
        -- déménagement est le sujet : la LECTURE VIVANTE du suivi la calcule
        -- désormais elle aussi. Deux appelants, une définition — la recopier
        -- ici, c'est deux définitions d'une même notion qui divergeront.
        ff_series_tenues(e.sets, e.felt_rpe_by_set) AS sets,
        -- ⚠️ LES SÉRIES PRESCRITES, GARDÉES — et gardées EN COLONNE, pas
        -- seulement comme calcul intermédiaire. Sans elles, une semaine où
        -- l'athlète a échoué ressemble à une semaine où il n'est pas venu.
        --
        -- Elles servent DEUX repères, et c'est ce qui a décidé de la colonne :
        -- le graphe bascule entre tonnage et RÉPÉTITIONS, et le volume en reps
        -- (`sum(sets * reps)`) baisse exactement comme le tonnage. Un repère
        -- posé sur le seul tonnage aurait laissé l'autre moitié du graphe
        -- inexpliquée — le défaut même qu'on répare.
        round(ff_num(e.sets))::int AS sets_prevus,
        ff_reps_low(e.reps)  AS reps,
        ff_reps_high(e.reps) AS reps_high,
        ff_num(e.reps_done)  AS reps_done,
        e.reps_unit,   -- vocabulaire clos côté source (CHECK) : jamais ''
        -- NULL = entraînement (FRE-10) : les lignes d'avant le champ n'en ont
        -- pas. C'est l'agrégation (tracking.py) qui écarte warmup/rehab, pas
        -- cette projection — un échauffement chargé déplace un poids réel.
        e.kind,
        ff_bodyweight(e.weight)  AS bodyweight,
        ff_charge(e.weight)      AS weight_kg,
        ff_charge(e.weight_done) AS weight_done_kg,
        ff_num(e.aimed_rpe)      AS aimed_rpe,
        ff_rpe(e.felt_rpe)       AS felt_rpe,
        nullif(btrim(e.felt_rpe), '')         AS felt_rpe_raw,
        ff_rpe_by_set(e.felt_rpe_by_set)      AS rpe_by_set,
        ff_reps_by_set(e.reps_done_by_set)     AS reps_by_set,
        ff_charge_by_set(e.weight_done_by_set) AS weight_by_set,
        ff_num(e.rest)                        AS rest_s,
        nullif(btrim(e.athlete_feedback), '') AS athlete_feedback,
        nullif(btrim(e.coach_note), '')       AS coach_note,
        -- ⚠️ LE TONNAGE A DÉMÉNAGÉ DANS `ff_tonnage` (12/09, le guichet), pour la
        -- même raison que `ff_series_tenues` cinq jours plus tôt : une LECTURE
        -- VIVANTE en a besoin. Cette table est reconstruite à 03:30 — la séance
        -- finie aujourd'hui n'y est pas, et c'est celle que la file du coach
        -- sert. Deux appelants, une définition : la formule et son histoire
        -- (somme de produits, `0` contre NULL, isométrie) vivent dans la
        -- fonction, `docs/postgres-schema.sql`. `test_etl_training_sets.py`
        -- tient toujours les résultats — c'est lui qui prouve que rien n'a bougé.
        ff_tonnage(e.sets, e.reps, e.reps_done, e.reps_unit, e.weight, e.weight_done,
                   e.felt_rpe_by_set, e.reps_done_by_set, e.weight_done_by_set) AS tonnage_kg
    FROM training_exercises e
    JOIN training_sessions  s ON s.id = e.session_id
    JOIN training_weeks     w ON w.id = s.week_id
    JOIN training_blocks    b ON b.id = w.block_id
    JOIN training_macros    m ON m.id = b.macro_id
    JOIN programs           p ON p.id = m.program_id
    JOIN athletes           a ON a.id = p.athlete_id
    -- L'éditeur laisse des lignes vierges ; le chargement en masse les écarte
    -- déjà côté serveur, la projection applique la même règle.
    WHERE btrim(e.name) <> ''
)
SELECT prescription.*,
       -- Tonnage = séries × reps EFFECTIVES × charge EFFECTIVE (le réalisé s'il
       -- est saisi, sinon le prescrit ; borne basse pour une fourchette).
       -- ⚠️ CALCULÉ DANS LA CTE PAR `ff_tonnage` DEPUIS LE 12/09 — ce qui suit
       -- est l'HISTOIRE de la formule, gardée parce qu'elle explique ce que la
       -- fonction fait et pourquoi. La formule elle-même n'est plus ici.
       --
       -- SAUF EN ISOMÉTRIE (FRE-20) : « CHINESE PLANK, 3 × 60 s @ 40 kg » n'est
       -- pas 7 200 kg — rien n'est déplacé, et `reps` porte alors des SECONDES.
       -- NULL et non 0 : dans une table de faits, « non applicable » n'est pas
       -- « zéro ». `sum()` ignore les NULL, un 0 se serait fondu dans les moyennes.
       -- ⚠️ UNE SOMME DE PRODUITS, PLUS UN RECTANGLE (06/09). Les reps et la
       -- charge se saisissent maintenant SÉRIE PAR SÉRIE, et le produit des
       -- moyennes n'est pas la somme des produits dès que la charge varie :
       --
       --     2 séries : 10 reps @ 100 kg, puis 5 @ 50 kg
       --     somme des produits   10×100 + 5×50 = 1 250 kg   ← le vrai
       --     produit des moyennes  2 × 7,5 × 75 = 1 125 kg   ← faux de 10 %
       --
       -- Les moyennes restent AFFICHÉES (« on affiche toujours les moyennes »),
       -- elles ne servent simplement plus à calculer. L'erreur qu'on évite est
       -- de celles qui ne se voient pas : les moyennes ont l'air justes et le
       -- total est bas.
       --
       -- ⚠️ ELLE DÉGÉNÈRE EXACTEMENT EN L'ANCIENNE quand les tableaux sont
       -- vides : `coalesce` retombe alors sur les scalaires à CHAQUE position,
       -- et la somme de `sets` fois le même produit vaut `sets × reps × charge`.
       -- Aucune ligne existante ne bouge — c'est ce que vérifie
       -- `test_etl_training_sets.py`, et c'est ce qui permet de livrer sans
       -- reprise du passé (décision de William : « les gens se débrouillent »).
       --
       -- ⚠️ `sets` EST DÉJÀ LE NOMBRE DE SÉRIES TENUES (FRE-110), calculé plus
       -- haut : une série en échec n'ouvre donc aucune position, et son poids
       -- n'entre pas dans la somme. La règle des échecs n'est pas réécrite ici.
       --
       -- ⚠️ `sets = 0` REND 0, MAIS UNE LIGNE SANS CHARGE REND NULL — et
       -- confondre les deux a coûté 2 915 lignes le 06/09. Un `coalesce(…, 0)`
       -- posé autour de la somme les traitait pareil : `generate_series(1, 0)`
       -- est vide, donc `sum()` rend NULL et le coalesce écrivait 0 — mais un
       -- produit NULL (charge non saisie) tombait dans le même filet.
       --
       -- Les deux cas n'ont pourtant rien à voir :
       --   * `sets = 0` — toutes les séries ont échoué : ZÉRO kilo déplacé,
       --     c'est une mesure, et elle doit peser dans les moyennes ;
       --   * charge inconnue — on ne sait pas ce qui a été déplacé : NULL, et
       --     `sum()` l'ignore au lieu de le compter comme un effort nul.
       --
       -- Les SOMMES ne bougeaient pas (`sum()` ignore les NULL), donc rien
       -- n'alertait ; ce sont les MOYENNES qui se faisaient tirer vers le bas
       -- par 2 915 zéros. C'est le [[vide_contre_null]] du projet, sous sa forme
       -- la plus discrète : un défaut qui ne change aucun total.
       -- ⚠️ LE REPÈRE, PAS LA MESURE (FRE-110). Le même calcul avec les séries
       -- PRESCRITES : ce que le tonnage aurait valu si toutes avaient tenu.
       --
       -- Il existe parce que la correction ci-dessus crée un trou visible — 51
       -- lignes tombent à zéro, et une courbe qui plonge se lit « il n'est pas
       -- venu » alors qu'il était là, sous une barre trop lourde. Avec les deux,
       -- l'ÉCART devient l'information, comme `2' → 1'45"` sur le repos.
       --
       -- Égal à `tonnage_kg` partout où rien n'a échoué : c'est la différence
       -- qui se dessine, donc l'affichage n'a rien à filtrer.
       CASE WHEN reps_unit IS DISTINCT FROM 'sec'
            THEN sets_prevus * coalesce(reps_done, reps)
                             * coalesce(weight_done_kg, weight_kg)
       END AS tonnage_prevu_kg,
       -- MÉCANOTRANSDUCTION (FRE-103) : le temps sous tension d'une série, en
       -- secondes. La définition vit dans `ff_mechano` — la MÊME fonction sert
       -- la lecture de l'arbre (`GET /training`), pour qu'il n'existe pas deux
       -- formules qui divergent en silence.
       --
       -- ⚠️ CALCULÉ POUR TOUTES LES LIGNES, comme le tonnage, alors que la
       -- métrique ne concerne QUE le travail kiné. Même raison qu'en FRE-10 :
       -- c'est l'AGRÉGATION qui filtre, pas la projection. Un `kind = 'rehab'`
       -- posé ici rendrait la colonne inexploitable le jour où quelqu'un voudra
       -- comparer — et la donnée manquante ne se rattrape pas d'un WHERE.
       --
       -- ⚠️ ET L'AGRÉGAT DEVRA INVERSER LE FILTRE HABITUEL : `tracking.py` écarte
       -- warmup/rehab des stats. Une courbe de MT écrite par réflexe sur ce
       -- filtre-là rendrait invariablement zéro, sans la moindre erreur.
       --
       -- ⚠️ `coalesce(reps_done, reps)` — LE MÊME QUE LE TONNAGE, ET C'EST UNE
       -- CORRECTION. J'avais d'abord écrit `nullif(reps_done, 0)` pour coller à
       -- `effectiveReps` côté front, où `0 || x` retombe sur la prescription.
       -- William a tranché : une série rapportée à ZÉRO répétition a un temps
       -- sous tension NUL — `0 × quelque chose = 0`. Retomber sur le prescrit
       -- aurait crédité un travail qui n'a pas eu lieu, et l'aurait fait
       -- silencieusement, sur la seule métrique dont le kiné se sert.
       ff_mechano(tempo, coalesce(reps_done, reps), reps_unit) AS mechano
FROM prescription
"""

_COLONNES = (
    "athlete_id, program_id, macro_number, block_number, week_number, "
    "session_index, session_name, session_date, date_exact, exercise_index, "
    "exercise, exercise_id, variant, assistance, tempo, format, tier, "
    "superset_group, sets, reps, reps_high, reps_done, reps_unit, kind, "
    "bodyweight, weight_kg, weight_done_kg, aimed_rpe, felt_rpe, felt_rpe_raw, "
    "rpe_by_set, reps_by_set, weight_by_set, rest_s, sets_prevus, tonnage_kg, tonnage_prevu_kg, mechano, athlete_feedback, coach_note"
)

_INSERT = text(f"INSERT INTO training_sets ({_COLONNES}) SELECT {_COLONNES} FROM ({_PROJECTION}) src")

# Le dry-run mesure exactement ce que l'écriture produirait, sur la MÊME requête —
# un compte calculé autrement ne prouverait rien de celle qui écrit.
_RESUME = text(f"""
    SELECT count(*) AS lignes,
           count(DISTINCT athlete_id)  AS athletes,
           count(weight_kg)            AS avec_charge,
           count(felt_rpe)             AS avec_rpe,
           count(session_date)         AS datees,
           count(*) FILTER (WHERE date_exact AND session_date IS NOT NULL) AS date_reelle,
           count(*) FILTER (WHERE variant IS NOT NULL AND cardinality(variant) > 0) AS avec_variante,
           max(session_date)           AS derniere_seance
    FROM ({_PROJECTION}) src
""")


def apply(conn) -> int:
    """Rebuild complet dans UNE transaction. Rend le nombre de lignes écrites.

    DELETE et non TRUNCATE : TRUNCATE prend un verrou ACCESS EXCLUSIVE qui
    BLOQUERAIT toute lecture pendant le rebuild — un coach ouvrant l'onglet
    Tracking au mauvais moment resterait suspendu. Avec DELETE, le MVCC laisse
    les lecteurs voir l'ancienne version jusqu'au commit.

    NE FAIT QUE le rebuild : la projection des 1RM coachs (FRE-30) tourne dans sa
    PROPRE transaction, après le commit de celle-ci — cf. `refresh_coach_one_rm`.

    ⚠️ LE JOB LÈVE LUI-MÊME LA BORNE DE 15 s (FRE-155). Le rôle `brokkr` porte
    `statement_timeout = 15s`, écrit pour une requête d'écran ; ce rebuild prend
    une douzaine de secondes sur une table qui grossit chaque semaine. Il ne
    tournait que parce que le job vise le POOLER, qui ne propage pas les défauts
    de rôle — un accident de configuration : l'« aligner » sur l'endpoint direct
    du service lui aurait posé la borne, et le Tracking se serait figé une nuit.
    Levée ICI, le job ne dépend plus du chemin par lequel il se connecte.

    `SET LOCAL` : la portée est cette transaction, pas la connexion rendue au
    pool. `lock_timeout` reste borné — un `DELETE` qui attendrait un verrou est
    une anomalie, pas un rebuild long. Même raisonnement que `scripts/migrer.py`."""
    conn.execute(text("SET LOCAL statement_timeout = 0"))
    conn.execute(text("DELETE FROM training_sets"))
    return conn.execute(_INSERT).rowcount


# --------------------------------------------------------------------------- #
# FRE-30 — projection des 1RM vers coach_profiles, greffée sur ce job nocturne.
#
# GREFFÉE SUR LE JOB, PAS SUR LA TRANSACTION DU REBUILD. Les deux n'ont aucune
# raison de partager un sort : cette projection alimente une page vitrine (1RM qui
# bougent deux fois par an), le rebuild alimente tout le Tracking. Dans la même
# transaction, un incident sur `coach_profiles` annulait le rebuild entier et
# laissait `training_sets` silencieusement périmée jusqu'à la nuit suivante.
# --------------------------------------------------------------------------- #

# Cible NON aliasée (portable Postgres ET SQLite pour les tests) : SQLite n'aime
# pas l'alias sur la table d'un UPDATE ... FROM.
_COACH_ONE_RM_SQL = text(
    "UPDATE coach_profiles SET one_rm = a.current_one_rm "
    "FROM athletes a WHERE a.user_uid = coach_profiles.coach_uid"
)


def refresh_coach_one_rm(conn) -> int:
    """Recopie athletes.current_one_rm → coach_profiles.one_rm (le coach est un
    athlète via user_uid). PROJECTION, pas jointure à la lecture : la route publique
    lit une colonne, ne touche jamais `athletes`. Un 1RM bouge deux fois par an →
    un rafraîchissement par nuit suffit. Renvoie le nombre de profils touchés."""
    return conn.execute(_COACH_ONE_RM_SQL).rowcount


def format_summary(row, *, applied: bool) -> str:
    verbe = "CHARGÉ" if applied else "À charger (dry-run)"
    n = max(row.lignes, 1)
    return (
        f"=== Projection training_sets — {verbe} ===\n"
        f"  lignes d'exercice  : {row.lignes}  |  athlètes : {row.athletes}\n"
        f"  avec charge (kg)   : {row.avec_charge} ({100 * row.avec_charge // n} %)\n"
        f"  avec RPE ressenti  : {row.avec_rpe} ({100 * row.avec_rpe // n} %)\n"
        f"  avec variante      : {row.avec_variante}\n"
        f"  datées             : {row.datees} (dont {row.date_reelle} à la date de séance réelle)\n"
        f"  dernière séance    : {row.derniere_seance}"
    )


# ⚠️ CE JOB TOURNE SANS PERSONNE POUR LE REGARDER (FRE-81). Cloud Scheduler le
# déclenche à 3 h 30 ; s'il échoue, ou s'il ne part pas du tout, RIEN ne le dit.
# Sentry voit les erreurs que le code lui remonte — encore faut-il que le code
# tourne. L'absence de signal, elle, n'a jamais alerté personne.
#
# ⚠️ D'OÙ UN CHECK-IN, ET PAS UN `capture_exception`. Un monitor Sentry connaît
# l'HORAIRE attendu : il alerte sur le check-in qui n'arrive pas, ce qu'aucune
# remontée d'erreur ne saura jamais faire — un job mort n'envoie rien.
#
# ⚠️ ET LE MONITOR SE DÉCLARE ICI, pas dans l'interface Sentry. `monitor_config`
# le crée (upsert) au premier check-in : la planification vit donc à côté du code
# qu'elle surveille, et personne n'a à se souvenir d'aller cliquer quelque part.
# La contrepartie est qu'il faut le tenir en phase avec `nidavellir/analytics.tf`
# — d'où l'horaire répété en toutes lettres juste en dessous.
_MONITOR = "training-analytics-refresh"
_MONITOR_CONFIG = {
    # Doit refléter `google_cloud_scheduler_job.training_analytics_refresh`.
    "schedule": {"type": "crontab", "value": "30 3 * * *"},
    "timezone": "Europe/Paris",
    # Le job prend ~12 s ; 5 min de marge avant de crier au retard, 15 min avant
    # de le déclarer perdu. Large à dessein : une alerte qui se déclenche sur un
    # pic de latence se fait couper au bout de trois fois.
    "checkin_margin": 5,
    "max_runtime": 15,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Projection analytics : arbre d'entraînement Postgres → training_sets."
    )
    parser.add_argument(
        "--apply", action="store_true", help="écrit réellement (rebuild complet)."
    )
    args = parser.parse_args(argv)
    # Pas de guard_apply ici : projection DÉRIVÉE, rebuild non destructif.

    # ⚠️ SEULEMENT SUR `--apply`. Un dry-run lancé à la main depuis un poste ne
    # doit pas compter comme l'exécution planifiée du soir : il masquerait un job
    # qui, lui, n'a pas tourné.
    if not args.apply:
        return _executer(args)

    from app.socle import observabilite

    observabilite.installer()   # sans DSN : ne fait rien, et le check-in non plus
    from sentry_sdk.crons import monitor

    with monitor(monitor_slug=_MONITOR, monitor_config=_MONITOR_CONFIG):
        code = _executer(args)
        # ⚠️ DANS LE CONTEXTE, ET C'EST TOUT LE POINT. Le monitor ne voit que les
        # EXCEPTIONS : une sortie non nulle (la projection 1RM qui échoue) le
        # traverserait en « ok », et le job serait ROUGE côté Cloud Run et VERT
        # côté Sentry — pire que pas de monitor, puisqu'on croirait la chaîne
        # saine. Levée APRÈS le `with`, comme je l'avais écrite d'abord, elle
        # arrivait trop tard : la spec l'a dit tout de suite.
        if code != 0:
            raise SystemExit(code)
    return 0


def _executer(args: argparse.Namespace) -> int:

    from app.socle.db import get_session

    with get_session() as conn:
        resume = conn.execute(_RESUME).one()
        if not args.apply:
            print(format_summary(resume, applied=False))
            print("  projection 1RM coachs : non exécutée (dry-run)")
            print("\n(dry-run — relancer avec --apply pour écrire)")
            return 0
        ecrites = apply(conn)

    # Sortie du `with` = rebuild COMMITÉ. La projection FRE-30 ouvre SA transaction :
    # son échec ne peut plus annuler les lignes ci-dessus. On imprime le résumé
    # AVANT de la lancer, pour qu'il reste lisible même si elle lève.
    print(format_summary(resume, applied=True))
    if ecrites != resume.lignes:
        # Ne peut arriver que si l'arbre a bougé entre le compte et l'écriture.
        # Bénin — mais silencieux, donc dit.
        print(f"  ⚠️ {ecrites} lignes écrites pour {resume.lignes} comptées "
              "(l'arbre a bougé pendant le rebuild)")
    try:
        with get_session() as conn:
            touched = refresh_coach_one_rm(conn)
    except Exception as exc:  # sortie non nulle → job Cloud Run en échec, donc visible
        print(
            f"  projection 1RM coachs : ÉCHEC ({exc.__class__.__name__}: {exc})\n"
            "  → training_sets EST à jour ; seule la page vitrine garde des 1RM périmés.",
            file=sys.stderr,
        )
        return 1
    print(f"  projection 1RM coachs : {touched} profil(s) rafraîchi(s)")

    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
