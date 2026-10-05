-- LE DEADLIFT DEVIENT UN LIFT DE COMPÉTITION, ET LE BARÈME SE BORNE (FRE-147).
--
-- Demande de William : afficher `DEADLIFT` et `BENCH` dans la Table RM, puis en
-- tirer deux totaux — le street (avec le choix pull up / chin up, comme
-- aujourd'hui) et le SBD. Explicitement : « on veut pas créer SBD comme sport ».
-- Il n'y a donc AUCUNE modélisation de discipline ici, et il ne doit pas y en
-- avoir : la composition des deux totaux vit dans le front, seul à les afficher.
--
-- Ce fichier ne contient que ce que la BASE doit apprendre. Le contrat (sept
-- clés dans `current_one_rm`) est du code, et il se déploie avec.
--
-- ⚠️ AUCUNE MIGRATION DE COLONNE POUR LES 1RM : `athletes.current_one_rm` est du
--    jsonb. Deux clés de plus ne demandent rien à la base — seulement à
--    `OneRMPatch`, à `UnRM`, à `_ONE_RM_KEYS` et à l'invariant
--    `cles_de_1rm_inattendues`, qui aurait échoué à la PREMIÈRE écriture.
--
-- MESURÉ EN PRODUCTION AVANT D'ÉCRIRE (07/09, lecture seule) :
--   · `BENCH` est DÉJÀ `competition = true`, `DEADLIFT` non — le seul écart.
--     ⚠️ CORRIGÉ LE LENDEMAIN : c'est `BENCH PRESS` qu'on garde, et les deux
--        entrées coexistaient. Cf. `2026-09-07_bench_rejoint_bench_press.sql`,
--        qui fusionne et déplace le drapeau.
--   · 8 compétitions, TOUTES en `MUSCLE UP + PULL UP + DIPS + SQUAT`. Zéro
--     compétition dispute un mouvement hors du barème street.
--   · `current_one_rm` ne porte que les cinq clés attendues, sur 70 athlètes.
--   · Zéro record manuel sur bench ou deadlift (`athlete_prs`) — la table les
--     refusait, faute du drapeau.
--   · Et pourtant 110 lignes d'entraînement portent `DEADLIFT`, 164 `BENCH` :
--     les deux mouvements sont travaillés depuis toujours, seul leur maximum
--     n'était notable nulle part.

BEGIN;

-- --------------------------------------------------------------------------- #
-- 1. LE DRAPEAU
--
-- C'est LUI, et rien d'autre, qui ouvre le deadlift aux records manuels
-- (`prs.py` lit `competition = true`) et aux mouvements disputés
-- (`competition_movements`, qui valide sur la même colonne). Aucun code à
-- changer : les deux chemins sont pilotés par la donnée.
-- --------------------------------------------------------------------------- #

UPDATE library_entries SET competition = true
 WHERE category = 'exercices' AND name = 'DEADLIFT';


-- --------------------------------------------------------------------------- #
-- 2. LE BARÈME NE S'APPLIQUE QU'À CE QU'IL SAIT NOTER
--
-- ⚠️ C'EST LA SEULE CONSÉQUENCE DU POINT 1, ET ELLE N'EST PAS ÉVIDENTE. Le
--    SCORE d'une épreuve additionne TOUS les mouvements disputés : une street à
--    quatre et une SBD à trois donnent chacune leur total, sans liste en dur —
--    rien à faire de ce côté. Mais `total_bareme_kg` est le total du BARÈME
--    STREET (quatre places, `app/scoring.py`), et il est écrit en dur. Une
--    compétition SBD (SQUAT + BENCH + DEADLIFT) y entrerait avec LE SQUAT SEUL,
--    et `_RIS_CANDIDATS_SQL` la retiendrait, puisqu'il ne filtre que sur
--    `total_bareme_kg > 0`. Un RIS calculé sur un tiers d'un total, présenté
--    comme un RIS.
--
-- ⚠️ LA RÈGLE EST POSITIVE, PAS SOUSTRACTIVE : « le barème s'applique quand la
--    compétition dispute ce que le barème note », et non « quand elle ne
--    dispute rien d'autre ». La formulation négative aurait effacé le RIS d'une
--    street qui ajoute un mouvement en bonus — alors que le barème sait très
--    bien l'ignorer, c'est même sa définition.
--
-- ⚠️ ET ÇA SE CORRIGE DANS LA VUE, PAS DANS LES DEUX APPELANTS. `athletes.py`
--    (le RIS de l'annuaire) et `competitions.py` (le classement de l'écran du
--    jour) lisent la MÊME colonne : borner chez eux, c'est deux définitions du
--    barème qui divergeront le jour où l'une bouge.
--
-- MESURÉ : les 8 compétitions existantes disputent toutes MU + DIPS + SQUAT et
-- au moins un tirage. Aucune ne change de total — vérification (c) plus bas.
-- --------------------------------------------------------------------------- #

CREATE OR REPLACE VIEW competition_scores AS
WITH meilleurs AS (
    -- Le meilleur essai RÉUSSI, par participant et par mouvement.
    SELECT a.participant_id,
           upper(m.movement) AS movement,
           max(a.weight_kg)  AS weight_kg
    FROM competition_attempts a
    JOIN competition_movements m ON m.id = a.movement_id
    WHERE a.result = 'rep'
    GROUP BY a.participant_id, upper(m.movement)
)
SELECT p.id             AS participant_id,
       p.competition_id,
       -- Inchangé : le SCORE de l'épreuve additionne TOUS les mouvements
       -- disputés, quels qu'ils soient.
       COALESCE(SUM(b.weight_kg), 0) AS score,

       -- ── Ajouts FRE-92, en fin de liste pour ne pas déplacer l'existant ──
       p.athlete_id,

       -- ⚠️ LE TOTAL DU BARÈME N'EST PAS LE SCORE. Quatre places, pas tous les
       -- mouvements — et le pull up et le chin up S'EN DISPUTENT UNE, on retient
       -- le plus lourd. Le front l'ignore : il écarte purement le chin up, ce qui
       -- sous-estime le total de ONZE athlètes mesurés le 21/08.
       -- (Onze par la TABLE DES 1RM, que le RIS ne lit plus ; en compétition,
       -- aucun chin up n'a encore été disputé — la règle attend la première.)
       --
       -- ⚠️ ET IL VAUT ZÉRO QUAND LE BARÈME NE S'APPLIQUE PAS (FRE-147) : une
       -- compétition qui ne dispute pas les quatre places n'a pas de total au
       -- barème, elle en a un qui serait FAUX. Zéro, parce que c'est ce que
       -- `_RIS_CANDIDATS_SQL` sait déjà écarter.
       -- ⚠️ `DISTINCT upper(...)`, PAS `count(*)` : `competition_movements` est
       -- unique sur le TEXTE du mouvement, donc « SQUAT » et « Squat » peuvent
       -- y coexister et faire compter quatre places là où il y en a trois. Le
       -- reste de la vue compare déjà sans la casse ; celle-ci aussi.
       CASE WHEN (SELECT count(DISTINCT upper(cm.movement)) FROM competition_movements cm
                   WHERE cm.competition_id = p.competition_id
                     AND upper(cm.movement) IN ('MUSCLE UP', 'DIPS', 'SQUAT')) = 3
             AND EXISTS (SELECT 1 FROM competition_movements cm
                          WHERE cm.competition_id = p.competition_id
                            AND upper(cm.movement) IN ('PULL UP', 'CHIN UP'))
            THEN COALESCE(SUM(b.weight_kg) FILTER (
                     WHERE b.movement IN ('MUSCLE UP', 'DIPS', 'SQUAT')), 0)
                 + COALESCE(MAX(b.weight_kg) FILTER (
                     WHERE b.movement IN ('PULL UP', 'CHIN UP')), 0)
            ELSE 0
       END AS total_bareme_kg,

       -- Les deux entrées du barème, figées le jour de la compétition. C'est ce
       -- couple qui rend le RIS honnête, et c'est la ligne qui le garantit.
       p.bodyweight_kg,
       p.gender
FROM competition_participants p
LEFT JOIN meilleurs b ON b.participant_id = p.id
-- `p.id` est clé primaire : Postgres autorise à projeter les autres colonnes de
-- `p` sans les grouper (dépendance fonctionnelle).
GROUP BY p.id, p.competition_id;

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) les six lifts de compétition deviennent sept :
--    SELECT name FROM library_entries
--     WHERE category = 'exercices' AND competition ORDER BY 1;
--    -- → BENCH, CHIN UP, DEADLIFT, DIPS, MUSCLE UP, PULL UP, SQUAT
--
-- b) aucun total du barème n'a bougé (la raison d'être de la règle positive) :
--    SELECT count(*) FROM competition_scores WHERE total_bareme_kg > 0;
--    -- → le même nombre qu'avant la migration
--
-- c) LA RÈGLE VUE À L'ŒUVRE, dans une transaction ANNULÉE : on retire le muscle
--    up d'une compétition, son barème doit tomber à zéro sans toucher au score.
--
--    BEGIN;
--      SELECT sum(score), sum(total_bareme_kg) FROM competition_scores;
--      DELETE FROM competition_movements
--       WHERE upper(movement) = 'MUSCLE UP'
--         AND competition_id = (SELECT id FROM competitions ORDER BY start_date LIMIT 1);
--      SELECT sum(score), sum(total_bareme_kg) FROM competition_scores;
--      -- → le barème de cette compétition tombe à 0 ; le score, lui, ne perd
--      --   que les essais du mouvement retiré.
--    ROLLBACK;
