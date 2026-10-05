-- QUATRE SUFFIXES DEVIENNENT DES VARIANTES (FRE-17, l'arbitrage laissé aux coachs).
--
-- Quatre exercices portaient une variante dans leur nom : CURL PRONATION,
-- BACK EXTENSION ISO, ROWING HELMSROW, SQUAT HIGH BAR. La règle de William
-- (04/09) : ce qui change l'échelle de charge garde son nom, la technique
-- devient variante. Tranché le 24/09 : les quatre se décomposent. Le Tracker
-- filtre par variante (FRE-182), les courbes restent séparables.
--
-- Les sept colonnes qui portent un nom d'exercice sont pilotées une à une ; la
-- variante s'ajoute SANS doublon (83 BACK EXTENSION ISO portent déjà `ISO`) et
-- sans écraser celles qui sont là (CABLE, BARBELL, DUMBBELL). Les entrées de
-- bibliothèque des quatre noms partent en dernier, quand plus rien ne les
-- référence.
--
-- Relevé en production le 24/09 : 446 lignes de séance, 444 de projection,
-- 117 d'accessoires de BASE ; rien dans les principes, les objectifs, les
-- records ni les objectifs techniques.

BEGIN;

CREATE TEMP TABLE carte (ancien text PRIMARY KEY, exercice text NOT NULL, variante text NOT NULL) ON COMMIT DROP;
INSERT INTO carte VALUES
  ('CURL PRONATION',     'CURL',           'PRONATION'),
  ('BACK EXTENSION ISO', 'BACK EXTENSION', 'ISO'),
  ('ROWING HELMSROW',    'ROWING',         'HELMSROW'),
  ('SQUAT HIGH BAR',     'SQUAT',          'HIGH BAR');

DO $$
DECLARE manquantes text;
BEGIN
  SELECT string_agg(s.slug || ' : ' || c.categorie || ' ' || c.nom, ', ') INTO manquantes
    FROM structures s CROSS JOIN (
      SELECT 'exercices' AS categorie, exercice AS nom FROM carte
      UNION SELECT 'variantes', variante FROM carte) c
   WHERE NOT EXISTS (SELECT 1 FROM library_entries le
                      WHERE le.structure = s.slug AND le.category = c.categorie::library_category AND le.name = c.nom);
  IF manquantes IS NOT NULL THEN
    RAISE EXCEPTION 'Cible(s) absente(s) de la bibliothèque : % — migration annulée.', manquantes;
  END IF;
END $$;

CREATE FUNCTION pg_temp.avec(variant text[], v text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v = ANY(coalesce(variant, '{}')) THEN variant ELSE array_append(coalesce(variant, '{}'), v) END
$$;

UPDATE training_exercises e        SET name = c.exercice, variant = pg_temp.avec(e.variant, c.variante) FROM carte c WHERE e.name = c.ancien;
UPDATE training_base_principles e  SET name = c.exercice, variant = pg_temp.avec(e.variant, c.variante) FROM carte c WHERE e.name = c.ancien;
UPDATE training_base_accessories e SET name = c.exercice, variant = pg_temp.avec(e.variant, c.variante) FROM carte c WHERE e.name = c.ancien;
UPDATE training_sets t             SET exercise = c.exercice, variant = pg_temp.avec(t.variant, c.variante) FROM carte c WHERE t.exercise = c.ancien;
-- Les trois colonnes en TEXTE n'ont pas de tableau de variantes : le nom seul.
UPDATE athlete_goals g             SET exercise = c.exercice FROM carte c WHERE g.exercise = c.ancien;
UPDATE athlete_prs p               SET movement = c.exercice FROM carte c WHERE p.movement = c.ancien;
UPDATE block_objectives o          SET exercise = c.exercice FROM carte c WHERE o.exercise = c.ancien;
UPDATE objectifs_techniques o      SET mouvement = c.exercice FROM carte c WHERE o.mouvement = c.ancien;

DELETE FROM library_entries WHERE category = 'exercices' AND name IN (SELECT ancien FROM carte);

DO $$
DECLARE restantes integer;
BEGIN
  SELECT (SELECT count(*) FROM training_exercises WHERE name IN (SELECT ancien FROM carte))
       + (SELECT count(*) FROM training_base_principles WHERE name IN (SELECT ancien FROM carte))
       + (SELECT count(*) FROM training_base_accessories WHERE name IN (SELECT ancien FROM carte))
       + (SELECT count(*) FROM training_sets WHERE exercise IN (SELECT ancien FROM carte))
       + (SELECT count(*) FROM library_entries WHERE name IN (SELECT ancien FROM carte)) INTO restantes;
  IF restantes > 0 THEN
    RAISE EXCEPTION '% trace(s) des anciens noms subsistent — migration annulée.', restantes;
  END IF;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-24_quatre_suffixes_deviennent_des_variantes.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
