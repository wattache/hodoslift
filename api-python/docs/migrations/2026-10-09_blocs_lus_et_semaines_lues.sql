-- CE QU'UN BLOC ET UNE SEMAINE DISENT D'EUX-MÊMES À LA LECTURE (FRE-219) :
-- les bornes d'un bloc (de sa première semaine datée à sa dernière, masquées
-- comprises), s'il a une trame, s'il a encore quelque chose à montrer à
-- l'athlète ; le compte de séances d'une semaine. L'arbre et la charpente les
-- recalculaient chacun de leur côté, en Python, par deux requêtes de plus.
--
-- ⚠️ `training_blocks.start_date` et `end_date` TOMBENT : rien ne les lisait
-- — la période d'un bloc se DÉDUIT de ses semaines, une seule définition —
-- mais la création et le PATCH les écrivaient encore. Cinq blocs sur 229 en
-- portaient ; le front n'en envoie jamais.

BEGIN;

ALTER TABLE training_blocks
    DROP COLUMN start_date,
    DROP COLUMN end_date;

CREATE VIEW blocs_lus AS
SELECT b.id, b.macro_id, b.legacy_id, b.number, b.name,
       b.day_split, b.selected_principals, b.granularity,
       b.s1_start_date, b.s1_end_date,
       m.program_id,
       (SELECT min(w.start_date) FROM training_weeks w WHERE w.block_id = b.id) AS debut,
       (SELECT max(w.end_date)   FROM training_weeks w WHERE w.block_id = b.id) AS fin,
       EXISTS (SELECT 1 FROM training_weeks w WHERE w.block_id = b.id AND NOT w.hidden)
           AS visible_a_l_athlete,
       (b.day_split IS NOT NULL AND jsonb_array_length(b.day_split) > 0)
    OR (b.selected_principals IS NOT NULL AND cardinality(b.selected_principals) > 0)
    OR EXISTS (SELECT 1 FROM training_base_principles  x WHERE x.block_id = b.id)
    OR EXISTS (SELECT 1 FROM training_base_accessories x WHERE x.block_id = b.id)
           AS a_une_base
  FROM training_blocks b
  JOIN training_macros m ON m.id = b.macro_id;

CREATE VIEW semaines_lues AS
SELECT w.id, w.block_id, w.legacy_id, w.number, w.name, w.hidden,
       w.start_date, w.end_date, w.athlete_weight_kg, w.athlete_height_cm,
       (SELECT count(*) FROM training_sessions s WHERE s.week_id = w.id)::int AS session_count
  FROM training_weeks w;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-09_blocs_lus_et_semaines_lues.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
