-- FRE-36 — les groupes EXISTANTS disent qu'ils sont des bi-sets.
--
-- ⚠️ POURQUOI CETTE SECONDE MIGRATION, ALORS QUE `NULL` VALAIT DÉJÀ « BI-SET ».
--    Parce que le front écrit `'biset'` explicitement à chaque nouveau liage :
--    sans cette reprise, la base porte DEUX encodages de la même chose — `NULL`
--    pour les anciens, `'biset'` pour les neufs. C'est la famille de défaut que
--    ce projet répète, et la convention de lecture aurait fini par être la seule
--    chose qui les réconcilie.
--
-- ⚠️ ET LA PREMIÈRE JUSTIFICATION ÉTAIT FAUSSE. Elle invoquait la « réécriture
--    massive » qu'on évite avec `kind` sur la ligne — mais `kind` concerne 9 147
--    lignes, et ceci en concerne 246 : 226 lignes de séance et 20 accessoires de
--    trame. L'analogie ne tenait pas ; la mesure l'a montré.
--
-- ⚠️ ON NE TOUCHE QUE LES LIGNES GROUPÉES. Une ligne sans `group_id` n'a pas de
--    nature : lui en poser une ne voudrait rien dire aujourd'hui, et déciderait
--    de tout le jour où on la lie — en silence.
--
-- Vérifié avant : zéro groupe orphelin en production (aucun `group_id` réduit à
-- un seul membre dans sa séance), donc chaque ligne touchée appartient bien à un
-- groupe réel.
--
-- Idempotent : le `IS NULL` fait que la rejouer ne réécrit rien.

BEGIN;

UPDATE training_exercises
   SET group_kind = 'biset'
 WHERE coalesce(group_id, '') <> ''
   AND group_kind IS NULL;

UPDATE training_base_accessories
   SET group_kind = 'biset'
 WHERE coalesce(group_id, '') <> ''
   AND group_kind IS NULL;

COMMIT;

-- Contrôle : plus aucune ligne groupée sans nature, et aucune ligne libre qui en
-- porterait une.
--
--   SELECT count(*) FILTER (WHERE coalesce(group_id,'') <> '' AND group_kind IS NULL) AS groupees_sans_nature,
--          count(*) FILTER (WHERE coalesce(group_id,'') =  '' AND group_kind IS NOT NULL) AS libres_avec_nature
--     FROM training_exercises;
