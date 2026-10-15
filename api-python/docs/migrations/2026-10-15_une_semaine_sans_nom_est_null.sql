-- Une semaine sans nom est NULL, jamais `''` (FRE-230).
--
-- La génération et la semaine suivante écrivaient `''`, la création à la main
-- NULL : deux façons de dire « pas de nom ». Les semaines vides passent à NULL,
-- puis la contrainte rend `''` impossible.
BEGIN;

UPDATE training_weeks SET name = NULL WHERE btrim(name) = '';

ALTER TABLE training_weeks
  ADD CONSTRAINT training_weeks_nom_non_vide CHECK (name IS NULL OR btrim(name) <> '');

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-15_une_semaine_sans_nom_est_null.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
