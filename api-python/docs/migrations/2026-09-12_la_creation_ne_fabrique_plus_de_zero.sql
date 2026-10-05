-- LA CRÉATION FABRIQUAIT ENCORE DES ZÉROS — FRE-137, la moitié manquante du lot 5.
--
-- ⚠️ TROUVÉ PAR `make invariants` SUR LA PRODUCTION, TROIS HEURES APRÈS LE
--    DÉPLOIEMENT QUI PRÉTENDAIT CLORE LE SUJET. `pas_de_mesure_a_zero` est
--    ressorti ROMPU — 4 violations, une seule fiche.
--
-- Le lot 5 (2026-09-11_un_zero_n_est_pas_une_mesure.sql) a retiré les 122 clés
-- de 1RM à zéro et fermé le robinet du PATCH (`_mesure_ou_absence`). Mais
-- `athletes.py — _CREATE_ATHLETE_SQL` écrivait un GABARIT des cinq clés à `0` à
-- chaque création de fiche. La règle était appliquée à la modification et pas à
-- la création : la demi-règle que CLAUDE.md nomme, rejouée telle quelle.
--
-- AVANT (relevé du 12/09, lecture seule, sur 70 fiches) :
--    LOAN (02qMY5rbvenEHS7824ku, créé le 12/09 à 09:26)
--      {"dip": 0, "squat": 0, "chinUp": 0, "pullUp": 0, "muscleUp": 20.0}
--    Aucune autre fiche : les 69 autres sont restées propres depuis le lot 5.
--
-- ⚠️ ET UN PATCH PARTIEL NE LES EFFACE JAMAIS. `muscleUp` est passé à 20 parce
--    que le coach l'a saisi ; les quatre autres clés n'étaient pas dans le
--    corps du PATCH, donc le robinet ne les a jamais vues. Un défaut posé à la
--    création survit à tous les gestes qui suivent — c'est ce qui le rend plus
--    grave qu'un défaut d'écriture, pas moins.
--
-- Le gabarit est remplacé par `'{}'` dans le même commit, et
-- `test_creation_UNE_FICHE_NEUVE_N_A_AUCUN_1RM` le garde. Vu ROUGE avant :
--    AssertionError: une fiche neuve part avec des 1RM à zéro :
--    {'dip': 0, 'squat': 0, 'chinUp': 0, 'pullUp': 0, 'muscleUp': 0}
--
-- APRÈS : `pas_de_mesure_a_zero` doit rendre 0.
--
-- ⚠️ LA CLÉ EST RETIRÉE, PAS MISE À `null` — même raison qu'au lot 5 : un `null`
--    JSON se relit comme une valeur. `-` sur un jsonb la fait disparaître.

BEGIN;

UPDATE athletes
   SET current_one_rm = (
         SELECT coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
           FROM jsonb_each(current_one_rm) AS e(k, v)
          WHERE (e.v #>> '{}')::numeric > 0
       )
 WHERE current_one_rm IS NOT NULL
   AND EXISTS (SELECT 1 FROM jsonb_each(current_one_rm) AS e(k, v)
                WHERE (e.v #>> '{}')::numeric <= 0);

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-12_la_creation_ne_fabrique_plus_de_zero.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION :
--   SELECT count(*) FROM athletes, jsonb_each(current_one_rm) AS e(k, v)
--    WHERE (v #>> '{}')::numeric <= 0;                      -- attendu : 0
--   ou `make invariants` : pas_de_mesure_a_zero doit redevenir vert.
