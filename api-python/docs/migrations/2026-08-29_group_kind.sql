-- FRE-36 — la NATURE d'un groupe de lignes liées : bi-set ou dropset.
--
-- ⚠️ À JOUER AVANT DE DÉPLOYER brokkr. Sans la colonne, toute création de ligne
--    répond 500 (UndefinedColumn) : c'est ce qui est arrivé sur le bac à sable
--    en écrivant les tests, et c'est le chemin le plus emprunté du produit.
--
-- ⚠️ CETTE MIGRATION N'ÉCRIT AUCUNE VALEUR : elle ne fait qu'ouvrir la colonne.
--    La reprise des groupes existants est la SUIVANTE
--    (`2026-08-29_group_kind_biset.sql`), et elle est nécessaire : le front écrit
--    « biset » à chaque nouveau liage, donc s'en passer laisserait deux encodages
--    de la même chose dans la base.
--
-- Sans DEFAULT, sans NOT NULL, sans index : la colonne ne se lit qu'à travers
-- des lignes déjà filtrées par session ou par bloc.

BEGIN;

ALTER TABLE training_exercises
  ADD COLUMN group_kind text
  CONSTRAINT training_exercises_group_kind_check CHECK (group_kind IN ('biset', 'dropset'));

ALTER TABLE training_base_accessories
  ADD COLUMN group_kind text
  CONSTRAINT training_base_accessories_group_kind_check CHECK (group_kind IN ('biset', 'dropset'));

COMMIT;
