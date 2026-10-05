-- UNE CLÉ ÉTRANGÈRE EN CASCADE SANS INDEX (FRE-90).
--
-- `training_sets.exercise_id` référence `training_exercises` en ON DELETE
-- CASCADE, mais n'est pas indexée. Postgres n'a donc aucun moyen de trouver les
-- lignes filles autrement qu'en BALAYANT la table à chaque suppression d'une
-- ligne d'exercice — c'est-à-dire à chaque fois qu'un coach retire un exercice
-- de sa programmation, geste on ne peut plus courant.
--
-- ⚠️ POSTGRES N'INDEXE PAS LES FK AUTOMATIQUEMENT, contrairement à MySQL. Il crée
-- l'index d'une clé PRIMAIRE et d'une contrainte UNIQUE, jamais celui d'une clé
-- étrangère. C'est l'oubli classique, et il ne se voit pas : rien n'échoue, tout
-- ralentit.
--
-- ⚠️ ET LE COÛT EST DU CÔTÉ QUI SUPPRIME, pas de celui qui lit. La table n'est
-- pourtant pas interrogée par `exercise_id` — l'index n'existe que pour la
-- cascade. C'est pour ça qu'il a manqué : personne n'écrit de requête qui le
-- réclamerait.
--
-- Mesure au moment de la migration : ~10 000 lignes dans `training_sets`. Assez
-- pour que le balayage se sente, pas assez pour que `CREATE INDEX` bloque plus
-- de quelques millisecondes — d'où la forme simple plutôt que CONCURRENTLY.

BEGIN;

CREATE INDEX IF NOT EXISTS training_sets_exercise_id ON training_sets (exercise_id);

COMMIT;

-- Vérification :
--
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'training_sets_exercise_id';
--
-- ⚠️ ET PAS UN `EXPLAIN` DU DELETE, comme je l'avais d'abord écrit : les
-- déclencheurs de cascade ne figurent pas dans le plan. Un `EXPLAIN DELETE FROM
-- training_exercises` ne montre que la recherche de la ligne PARENTE — le
-- balayage de la table fille, celui que cet index supprime, y est invisible.
-- Seul `EXPLAIN ANALYZE` en révèle le coût, et encore : agrégé dans une ligne
-- « Trigger for constraint … », sans dire par quel chemin il est passé.
