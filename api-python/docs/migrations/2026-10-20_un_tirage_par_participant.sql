-- Pull up OU chin up, au choix de chaque athlète, sur l'emplacement « PULL UP »
-- d'une compétition.
--
-- Théo a toujours disputé le chin up ; ses essais s'écrivaient en pull up, et sa
-- table 1RM portait une charge de chin up au pull up (signalé le 20/10). Ses
-- participations passent en CHIN UP — par sa FICHE, pas par son nom.
BEGIN;

ALTER TABLE competition_participants
  ADD COLUMN tirage text NOT NULL DEFAULT 'PULL UP'
  CONSTRAINT competition_participants_tirage CHECK (tirage IN ('PULL UP', 'CHIN UP'));

UPDATE competition_participants SET tirage = 'CHIN UP'
 WHERE athlete_id = (SELECT id FROM athletes WHERE legacy_id = 'IE6LcTiEwqBpYYfAdf9w');

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-20_un_tirage_par_participant.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
