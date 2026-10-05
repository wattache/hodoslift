-- La NATURE d'une ligne de BASE (FRE-10), oubliée au portage de l'arbre.
--
-- L'éditeur de BASE permet de marquer un principe ou un accessoire
-- « échauffement » ou « kiné », et la génération d'une semaine propage cette
-- nature dans chaque ligne produite. Les deux tables de BASE n'avaient pas la
-- colonne : le PUT répondait 200, la nature disparaissait au resync suivant, et
-- toutes les semaines générées ensuite la perdaient. Silencieusement.
--
-- Même CHECK que `training_exercises.kind`, et pour la même raison : un CHECK
-- plutôt qu'un ENUM, pour qu'ajouter une nature ne demande pas de migration de
-- type. NULL = entraînement, la valeur qui se déduit et ne s'écrit pas.
--
-- L'ETL n'a rien à faire ici : aucune BASE réelle ne porte encore de `kind`
-- (la fonctionnalité n'a jamais pu être persistée).
--
-- À APPLIQUER AVEC `psql -v ON_ERROR_STOP=1` — sans ce drapeau, psql sort en
-- code 0 même après un ROLLBACK, et la suite du runbook s'enchaînerait sur une
-- migration qui n'a pas pris.

BEGIN;

ALTER TABLE training_base_principles
    ADD COLUMN kind text CHECK (kind IN ('training', 'warmup', 'rehab'));

ALTER TABLE training_base_accessories
    ADD COLUMN kind text CHECK (kind IN ('training', 'warmup', 'rehab'));

COMMIT;
