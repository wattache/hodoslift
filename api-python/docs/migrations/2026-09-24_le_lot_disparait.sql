-- LE NUMÉRO DE LOT DISPARAÎT (FRE-204).
--
-- Aucun numéro de lot n'est tiré sur les plateaux : à charge égale dans un
-- tour, c'est l'essai précédent qui départage. La colonne n'a jamais été
-- remplie.

BEGIN;

ALTER TABLE competition_participants DROP COLUMN lot;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-24_le_lot_disparait.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
