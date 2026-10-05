-- GAINAGE REJOINT PLANK (FRE-11, le nom oublié du lot 3).
--
-- Le lot 3 fusionnait le vocabulaire français ; `GAINAGE` lui a échappé, et
-- c'est le dernier exercice de la bibliothèque qui ne parle pas anglais.
-- `PLANK` existe déjà dans les trois structures. Les sept colonnes qui portent
-- un nom d'exercice sont pilotées une à une (aucune clé ne les garde toutes) ;
-- l'entrée `GAINAGE` part ensuite, une fois que plus rien ne la référence.
--
-- Relevé en production le 24/09 : 31 lignes de séance, 31 de projection, 8
-- d'accessoires de BASE, 0 ailleurs, 3 entrées de bibliothèque.

BEGIN;

DO $$
DECLARE manquantes text;
BEGIN
  SELECT string_agg(s.slug, ', ') INTO manquantes FROM structures s
   WHERE NOT EXISTS (SELECT 1 FROM library_entries le WHERE le.structure = s.slug AND le.category = 'exercices' AND le.name = 'PLANK');
  IF manquantes IS NOT NULL THEN
    RAISE EXCEPTION 'PLANK absent de la bibliothèque : % — migration annulée.', manquantes;
  END IF;
END $$;

UPDATE training_exercises        SET name     = 'PLANK' WHERE name     = 'GAINAGE';
UPDATE training_base_principles  SET name     = 'PLANK' WHERE name     = 'GAINAGE';
UPDATE training_base_accessories SET name     = 'PLANK' WHERE name     = 'GAINAGE';
UPDATE training_sets             SET exercise = 'PLANK' WHERE exercise = 'GAINAGE';
UPDATE athlete_goals             SET exercise = 'PLANK' WHERE exercise = 'GAINAGE';
UPDATE athlete_prs               SET movement = 'PLANK' WHERE movement = 'GAINAGE';
UPDATE block_objectives          SET exercise = 'PLANK' WHERE exercise = 'GAINAGE';

DELETE FROM library_entries WHERE category = 'exercices' AND name = 'GAINAGE';

DO $$
DECLARE restantes integer;
BEGIN
  SELECT (SELECT count(*) FROM training_exercises WHERE name = 'GAINAGE')
       + (SELECT count(*) FROM training_base_principles WHERE name = 'GAINAGE')
       + (SELECT count(*) FROM training_base_accessories WHERE name = 'GAINAGE')
       + (SELECT count(*) FROM training_sets WHERE exercise = 'GAINAGE')
       + (SELECT count(*) FROM library_entries WHERE name = 'GAINAGE') INTO restantes;
  IF restantes > 0 THEN
    RAISE EXCEPTION '% trace(s) de GAINAGE subsistent — migration annulée.', restantes;
  END IF;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-24_gainage_rejoint_plank.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
