-- LE REPOS LIBRE N'A QU'UNE ÉCRITURE (FRE-169).
--
-- « Le coach ne fixe pas de durée, l'athlète gère » s'écrivait de TROIS façons
-- dans les trois tables de lignes : `''` (devenu NULL au lot chaud de FRE-137),
-- `Free`, et `-1`. Même famille que `''` contre `NULL`, avec un chiffre à la
-- place — et ce chiffre, le SQL le prend pour un nombre :
--
--     ff_num('-1')   = -1      ← un repos de moins une seconde
--     ff_num('Free') = NULL
--
-- L'ETL fait `ff_num(e.rest) AS rest_s` : `training_sets.rest_s` portait 8 751
-- valeurs à −1 sur 15 503 lignes (56 %), et toute moyenne dessus est fausse —
-- 51,3 s tel quel, 149,8 s sur les repos réels. Personne ne lit `rest_s`
-- aujourd'hui : c'est une mine posée, pas un défaut actif. Le premier écran qui
-- voudra dire « tu te reposes en moyenne tant » sortirait faux sans que rien ne
-- rougisse.
--
-- Le front savait (`isFreeRest` traite les trois formes) ; la base, non. Une
-- distinction qu'un seul fichier connaît est une divergence en attente.
--
-- ⚠️ LE ROBINET EST FERMÉ AVANT D'ÉPONGER : `prescription.vide_vaut_absence`
-- rend NULL sur `-1` et `Free` depuis ce commit, sur les trois chemins
-- d'écriture. Sans ça, la colonne se re-salit à la première génération de
-- semaine — c'est la leçon du lot 1 de FRE-137.
--
-- AVANT (relevé du 12/09, lecture seule) :
--
--                              total      -1    Free    NULL   durée
--   training_exercises        15 575   8 814     127   1 951   4 683
--   training_base_principles   2 058   1 625       0     401      32
--   training_base_accessories  2 140     977       0      68   1 095
--
--   soit 11 543 cases.
--
-- ⚠️ LE CHECK ACCEPTE `0`, PAS SEULEMENT `> 0`. Dix-neuf lignes portent
--    `rest = '0'` (13 exercices, 6 accessoires de base) : un repos NUL, réel —
--    celui d'un dropset ou d'un enchaînement. Ce n'est pas une sentinelle, et
--    un CHECK à `> 0` aurait refusé la migration sur une donnée juste. La
--    sentinelle, c'est le négatif.
--
-- ⚠️ ET IL LAISSE PASSER LE TEXTE. 4 683 durées d'`training_exercises` sont
--    parfois du texte (`1'30`, `30sec`, `BISET`) que `ff_num` rend NULL : le
--    coach s'en sert, le CHECK ne juge pas ça. `ff_num` est IMMUTABLE (vérifié
--    dans `pg_proc.provolatile = 'i'`), condition pour qu'un CHECK l'appelle.
--
-- ⚠️ LA PROJECTION EST ÉPONGÉE AUSSI, sans être reconstruite : `training_sets`
--    se refait chaque nuit à 03:30 depuis ces tables et rendrait la même chose
--    demain — mais d'ici là `make invariants` (`pas_de_sentinelle_de_repos`)
--    rougirait sur 8 751 lignes pour une journée. `rest_s = NULL` là où c'était
--    −1 est exactement ce que le job écrira.

BEGIN;

UPDATE training_exercises        SET rest = NULL WHERE rest IN ('-1', 'Free');
UPDATE training_base_principles  SET rest = NULL WHERE rest IN ('-1', 'Free');
UPDATE training_base_accessories SET rest = NULL WHERE rest IN ('-1', 'Free');
UPDATE training_sets             SET rest_s = NULL WHERE rest_s < 0;

ALTER TABLE training_exercises
    ADD CONSTRAINT rest_sans_sentinelle
    CHECK (rest IS NULL OR ff_num(rest) IS NULL OR ff_num(rest) >= 0);
ALTER TABLE training_base_principles
    ADD CONSTRAINT rest_sans_sentinelle
    CHECK (rest IS NULL OR ff_num(rest) IS NULL OR ff_num(rest) >= 0);
ALTER TABLE training_base_accessories
    ADD CONSTRAINT rest_sans_sentinelle
    CHECK (rest IS NULL OR ff_num(rest) IS NULL OR ff_num(rest) >= 0);

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-12_le_repos_libre_n_a_qu_une_ecriture.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION :
--   SELECT (SELECT count(*) FROM training_exercises        WHERE rest IN ('-1','Free'))
--        + (SELECT count(*) FROM training_base_principles  WHERE rest IN ('-1','Free'))
--        + (SELECT count(*) FROM training_base_accessories WHERE rest IN ('-1','Free'));
--                                                                  -- attendu : 0
--   SELECT count(*) FROM training_exercises WHERE rest IS NULL;    -- attendu : 10 892
--   SELECT count(*) FROM training_exercises WHERE rest = '0';      -- attendu : 13 (intact)
--   SELECT count(*) FROM training_sets WHERE rest_s < 0;           -- attendu : 0
