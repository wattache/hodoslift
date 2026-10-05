-- L'INCRÉMENT MANQUANT DU DIPS D'ANTHONY — signalé le 09/09.
--
-- Signalement : « son dips du mardi ne s'incrémente pas, alors que l'incrément
-- existe ». Il existe en effet — dans la BASE. Pas dans les lignes de semaine.
--
-- ⚠️ CE N'EST PAS UNE FAUTE DE SAISIE, ET CE N'EST PAS UN DÉFAUT DE LA
--    GÉNÉRATION. Les deux ont été écartés par la mesure :
--      · la génération rejouée sur SA BASE actuelle produit `increment='5'` sur
--        cette ligne — elle copie bien le champ ;
--      · la comparaison champ par champ des cinq lignes du mardi entre la BASE et
--        la semaine 1 ne montre qu'UN seul écart, celui-ci.
--    La ligne est donc née AVANT que l'incrément ne soit posé dans la trame, et
--    la trame ne redescend jamais dans une semaine déjà générée.
--
-- ⚠️ ET IL NE POUVAIT PAS LE VOIR NI LE CORRIGER. L'incrément n'existe QUE dans
--    l'éditeur de BASE : la table de séance ne l'affiche pas et n'offre aucun
--    champ pour l'écrire (vérifié — deux sites d'écriture dans tout le front,
--    tous deux dans `block-base-editor.tsx`). Le champ qui pilote la progression
--    est invisible exactement là où il agit.
--
-- ⚠️ CE QUI TRANSFORME L'OUBLI EN DISPARITION : sans incrément, la semaine
--    suivante EFFACE la charge au lieu de la recopier
--    (`semaine_suivante.py`, « quand aucun incrément ne la prend en charge »).
--    D'où la S3 sans aucune charge prescrite, trois semaines après l'oubli.
--
-- ⚠️ LA VALEUR N'EST PAS DEVINÉE : elle est LUE dans la ligne de BASE
--    correspondante, retrouvée par `_meme_ligne` — le même appariement que celui
--    qui sert déjà à hériter le RPE. Mesuré sur les trois semaines du bloc :
--    15 lignes sur 15 retrouvent leur ligne de BASE, et 14 portaient déjà le bon
--    incrément. Seule celle-ci ne l'avait pas.
--
-- ⚠️ TRENTE AUTRES LIGNES SONT DANS LE MÊME CAS AILLEURS, chez 7 autres athlètes
--    (33 au total, mesuré sur les 12 694 lignes appariées de la production).
--    Elles ne sont PAS reprises ici : ce fichier répare ce qui a été signalé.
--    Le correctif de fond — relire l'incrément depuis la BASE à chaque semaine
--    suivante, décision de William le 09/09 — rendra la reprise inutile pour les
--    semaines À VENIR ; les semaines déjà écrites, elles, demanderont ce même
--    geste, et il sera généré plutôt que tapé.
--
-- ⚠️ LA CHARGE DE LA S3 N'EST PAS REPOSÉE ICI, et c'est délibéré. Restaurer
--    l'incrément ne recalcule rien rétroactivement : la S3 reste sans charge, et
--    la valeur qu'elle devrait porter (60 kg, soit les 55 tenus en S2 + 5) est
--    une décision de programmation, pas une déduction. Elle revient au coach.

BEGIN;

UPDATE training_exercises
   SET increment = '5', increment_unit = 'kg'
 WHERE id IN (
   -- ANTHONY GARNIER · macro 1 · bloc 2 · mardi · DIPS 1×5 (la série lourde)
   '635fbcdd-0e77-40ab-bebb-a6210cde104d',   -- S1, @50
   '37d1c6b3-c75c-4135-84ba-1e57ae2feb86',   -- S2, @55
   '9cc54add-9ae8-4d98-9cbd-10891a9fc442'    -- S3, sans charge
 )
   -- ⚠️ LA GARDE EST LA CONDITION DU DIAGNOSTIC, pas une précaution de style :
   --    si l'une de ces lignes porte déjà un incrément, c'est que quelqu'un est
   --    passé entre la mesure et l'exécution — et il ne faut pas l'écraser.
   AND coalesce(increment, '') = '';

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-09_l_increment_manquant_du_dips_d_anthony.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;


-- VÉRIFICATION, après le COMMIT :
--
--   SELECT w.number, e.weight, e.increment
--     FROM training_exercises e
--     JOIN training_sessions s ON s.id = e.session_id
--     JOIN training_weeks    w ON w.id = s.week_id
--    WHERE e.id IN ('635fbcdd-0e77-40ab-bebb-a6210cde104d',
--                   '37d1c6b3-c75c-4135-84ba-1e57ae2feb86',
--                   '9cc54add-9ae8-4d98-9cbd-10891a9fc442')
--    ORDER BY w.number;
--
--   → trois lignes à `increment = 5`. La S3 reste sans charge : c'est au coach
--     de la poser, et la semaine 4 progressera alors toute seule.
