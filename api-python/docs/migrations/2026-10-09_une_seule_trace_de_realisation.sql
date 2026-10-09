-- « RÉALISÉ » N'A PLUS QU'UNE DÉFINITION (FRE-216) : `ff_tracee`. Un RPE
-- ressenti — global ou par série, FAIL compris — et rien d'autre : c'est la
-- seule preuve qu'une série a eu lieu (FRE-71). Elle s'écrivait en trois
-- dialectes : sur l'arbre (`cardinality(felt_rpe_by_set) > 0`), sur la
-- projection (`rpe_by_set IS NOT NULL`, qui perd un tableau `['FAIL']` parce
-- que `ff_rpe_by_set` écarte ce qui n'est pas un nombre), et une troisième
-- fois en ligne, qui comptait `{}` comme une trace.
--
-- `training_sets` porte désormais le tableau BRUT, et `tracee` s'en déduit
-- par la même fonction que l'arbre — une colonne engendrée, qui ne peut pas
-- diverger. Mesuré avant : sur 21 964 lignes, aucune où les dialectes
-- rendaient autre chose ; la divergence était latente.

BEGIN;

CREATE FUNCTION ff_tracee(felt_rpe text, felt_rpe_by_set text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT coalesce(btrim(felt_rpe), '') <> ''
        OR cardinality(coalesce(felt_rpe_by_set, '{}')) > 0
$$;

ALTER TABLE training_sets ADD COLUMN felt_rpe_by_set_raw text[];

UPDATE training_sets ts
   SET felt_rpe_by_set_raw = e.felt_rpe_by_set
  FROM training_exercises e
 WHERE e.id = ts.exercise_id;

ALTER TABLE training_sets
    ADD COLUMN tracee boolean GENERATED ALWAYS AS (ff_tracee(felt_rpe_raw, felt_rpe_by_set_raw)) STORED;

-- Les lignes RÉALISÉES : une trace, et pas dans le futur. Sans date, c'est de
-- l'historique dont ni la séance ni la semaine ne sont datées, pas du futur.
CREATE VIEW series_realisees AS
SELECT * FROM training_sets
 WHERE tracee AND (session_date IS NULL OR session_date <= current_date);

-- Les lignes de TRAVAIL : réalisées, et de l'entraînement — ni échauffement ni
-- rééducation (FRE-10). NULL = entraînement (les lignes d'avant le champ).
CREATE VIEW series_de_travail AS
SELECT * FROM series_realisees
 WHERE kind IS DISTINCT FROM 'warmup' AND kind IS DISTINCT FROM 'rehab';

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-09_une_seule_trace_de_realisation.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
