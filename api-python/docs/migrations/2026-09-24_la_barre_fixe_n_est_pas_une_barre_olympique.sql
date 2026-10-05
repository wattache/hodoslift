-- LA BARRE FIXE N'EST PAS UNE BARRE OLYMPIQUE (FRE-183).
--
-- Le lot 5 (FRE-11) a traduit la variante `BARRE` en `BARBELL` sur tous les
-- exercices. Juste sur un développé ou un RDL ; contresens sur un mouvement au
-- poids du corps, où `BARRE` disait la barre fixe ou la barre droite.
--
-- Tranché par William le 24/09 :
--   · DIPS + BARBELL était l'EXERCICE « DIPS BAR », qui existe en bibliothèque et
--     que les coachs distinguent vraiment des DIPS : la ligne change d'exercice
--     et perd la variante ;
--   · MUSCLE UP, HOLLOW BODY, LEG RAISE + BARBELL : la variante devient `BAR`.
--
-- Borné à ces quatre mouvements, sur les trois tables de lignes ET la projection
-- `training_sets`, qui se reconstruit la nuit mais que le Tracker lit d'ici là.
-- Aucune autre ligne portant `BARBELL` ne bouge. Rejouable : le mot source
-- n'existe plus après coup sur ces mouvements.
--
-- Relevé en production le 24/09 : 31 lignes (24 de séance, 4 d'accessoires de
-- BASE, 3 de principes de BASE), 24 dans la projection.

BEGIN;

DO $$
DECLARE manquantes text;
BEGIN
  -- Les cibles doivent exister dans CHAQUE structure : la clé étrangère
  -- (structure, catégorie, nom) refuserait sinon, en plein milieu.
  SELECT string_agg(s.slug || ' : ' || c.nom, ', ') INTO manquantes
    FROM structures s CROSS JOIN (VALUES ('exercices', 'DIPS BAR'), ('variantes', 'BAR')) AS c(categorie, nom)
   WHERE NOT EXISTS (SELECT 1 FROM library_entries le WHERE le.structure = s.slug AND le.category = c.categorie::library_category AND le.name = c.nom);
  IF manquantes IS NOT NULL THEN
    RAISE EXCEPTION 'Cible(s) absente(s) de la bibliothèque : % — migration annulée.', manquantes;
  END IF;
END $$;

-- 1. DIPS + BARBELL → l'exercice DIPS BAR, sans la variante. Un tableau vidé
--    devient NULL, la forme majoritaire des lignes sans variante.
UPDATE training_exercises       SET name = 'DIPS BAR', variant = nullif(array_remove(variant, 'BARBELL'), '{}') WHERE name = 'DIPS' AND 'BARBELL' = ANY(variant);
UPDATE training_base_accessories SET name = 'DIPS BAR', variant = nullif(array_remove(variant, 'BARBELL'), '{}') WHERE name = 'DIPS' AND 'BARBELL' = ANY(variant);
UPDATE training_base_principles  SET name = 'DIPS BAR', variant = nullif(array_remove(variant, 'BARBELL'), '{}') WHERE name = 'DIPS' AND 'BARBELL' = ANY(variant);
UPDATE training_sets             SET exercise = 'DIPS BAR', variant = nullif(array_remove(variant, 'BARBELL'), '{}') WHERE exercise = 'DIPS' AND 'BARBELL' = ANY(variant);

-- 2. Barre fixe : la variante BAR.
UPDATE training_exercises        SET variant = array_replace(variant, 'BARBELL', 'BAR') WHERE name IN ('MUSCLE UP', 'HOLLOW BODY', 'LEG RAISE') AND 'BARBELL' = ANY(variant);
UPDATE training_base_accessories SET variant = array_replace(variant, 'BARBELL', 'BAR') WHERE name IN ('MUSCLE UP', 'HOLLOW BODY', 'LEG RAISE') AND 'BARBELL' = ANY(variant);
UPDATE training_base_principles  SET variant = array_replace(variant, 'BARBELL', 'BAR') WHERE name IN ('MUSCLE UP', 'HOLLOW BODY', 'LEG RAISE') AND 'BARBELL' = ANY(variant);
UPDATE training_sets             SET variant = array_replace(variant, 'BARBELL', 'BAR') WHERE exercise IN ('MUSCLE UP', 'HOLLOW BODY', 'LEG RAISE') AND 'BARBELL' = ANY(variant);

-- Après coup : plus aucun BARBELL sur les quatre mouvements, nulle part.
DO $$
DECLARE restantes integer;
BEGIN
  SELECT (SELECT count(*) FROM training_exercises        WHERE name IN ('DIPS','MUSCLE UP','HOLLOW BODY','LEG RAISE') AND 'BARBELL' = ANY(variant))
       + (SELECT count(*) FROM training_base_accessories WHERE name IN ('DIPS','MUSCLE UP','HOLLOW BODY','LEG RAISE') AND 'BARBELL' = ANY(variant))
       + (SELECT count(*) FROM training_base_principles  WHERE name IN ('DIPS','MUSCLE UP','HOLLOW BODY','LEG RAISE') AND 'BARBELL' = ANY(variant))
       + (SELECT count(*) FROM training_sets             WHERE exercise IN ('DIPS','MUSCLE UP','HOLLOW BODY','LEG RAISE') AND 'BARBELL' = ANY(variant))
    INTO restantes;
  IF restantes > 0 THEN
    RAISE EXCEPTION '% ligne(s) portent encore BARBELL sur un mouvement à la barre fixe — migration annulée.', restantes;
  END IF;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-24_la_barre_fixe_n_est_pas_une_barre_olympique.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
