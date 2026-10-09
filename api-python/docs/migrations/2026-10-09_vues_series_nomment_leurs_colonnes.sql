-- `series_realisees` NOMME SES COLONNES. Créée en `SELECT *`, la vue avait
-- déplié les colonnes de `training_sets` dans l'ordre PHYSIQUE de la base —
-- celui des migrations, où `mechano`, `categorie` ou `tracee` sont venues
-- s'ajouter en queue — et le bac à sable, construit depuis le fichier de
-- schéma, les dépliait dans le sien. Deux vues au même nom, deux ordres :
-- `schema-verifier` les tenait pour différentes, et avait raison. Une liste
-- écrite est la même des deux côtés, quel que soit l'ordre des colonnes.
--
-- ⚠️ Une colonne ajoutée à `training_sets` s'ajoute ICI aussi, sinon la vue ne
-- la rend pas.
--
-- ⚠️ LE NOM EST L'ORDRE : celui-ci se range APRÈS `…_une_seule_trace_…`, où les
-- deux vues naissent. Un nom qui passerait avant tombe sur un DROP de ce qui
-- n'existe pas encore — sur toute base neuve, bac à sable ou restauration.

BEGIN;

DROP VIEW series_de_travail;
DROP VIEW series_realisees;

CREATE VIEW series_realisees AS
SELECT id, athlete_id, program_id, macro_number, block_number, week_number,
       session_index, session_name, session_date, date_exact, exercise_index,
       exercise, exercise_id, variant, assistance, tempo, format, tier,
       superset_group, kind, sets, reps, reps_high, reps_done, reps_unit,
       bodyweight, weight_kg, weight_done_kg, aimed_rpe, felt_rpe, felt_rpe_raw,
       rpe_by_set, reps_by_set, weight_by_set, rest_s, tonnage_kg,
       tonnage_prevu_kg, sets_prevus, mechano, athlete_feedback, coach_note,
       categorie, structure, felt_rpe_by_set_raw, tracee
  FROM training_sets
 WHERE tracee AND (session_date IS NULL OR session_date <= current_date);

CREATE VIEW series_de_travail AS
SELECT * FROM series_realisees
 WHERE kind IS DISTINCT FROM 'warmup' AND kind IS DISTINCT FROM 'rehab';

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-09_vues_series_nomment_leurs_colonnes.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
