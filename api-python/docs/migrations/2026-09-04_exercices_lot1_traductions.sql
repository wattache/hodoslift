-- LOT 1 — LES TRADUCTIONS SÈCHES (FRE-11) : 19 noms, 3 535 lignes.
--
-- Premier des cinq lots du passage des exercices en anglais. Celui-ci ne
-- contient QUE des renommages dont la cible anglaise est libre : aucune fusion,
-- aucun historique qui se mélange, aucune variante touchée. C'est le plus gros
-- volume pour le plus petit risque — si un mot déplaît à l'usage, on renomme
-- encore, et rien n'a été perdu entre-temps.
--
-- ⚠️ IL N'Y A AUCUNE CLÉ ÉTRANGÈRE SUR LE NOM D'EXERCICE, et c'est le piège de
--    toute cette série. Seule `objectifs_techniques` référence
--    `library_entries (category, name)` avec ON UPDATE CASCADE ; partout
--    ailleurs — séances, trames de bloc, objectifs d'athlète, projection de
--    suivi — le nom est du TEXTE LIBRE. Renommer l'entrée de bibliothèque seule
--    laisserait 1 598 séances sur l'ancien nom, invisibles depuis la
--    bibliothèque et comptées à part par le Tracking. D'où une carte unique qui
--    pilote CHAQUE colonne explicitement.
--
-- ⚠️ `training_sets` EST LA PROJECTION DU SUIVI, reconstruite chaque nuit. On la
--    réécrit quand même : sans ça le Tracking afficherait les anciens noms
--    jusqu'au prochain job, c'est-à-dire pendant la journée où le coach vérifie
--    justement que rien n'a bougé. Elle porte moins de lignes que
--    `training_exercises` (1 536 contre 1 598) parce qu'elle n'accueille que ce
--    qui porte une TRACE de réalisation — c'est normal, pas un écart.
--
-- ⚠️ `HORIZONTAL ROW` ET NON `SEATED CABLE ROW` (Théo, Maxime et Obin, 04/09) :
--    « ça devrait changer juste en Horizontal Row, et après tu décides si c'est
--    assis ou au câble ». Le nom dit le MOUVEMENT ; l'assise et la poulie sont
--    des variantes, et `POULIE` en est déjà une (320 usages).
--
-- ⚠️ AUCUN DE CES NOMS N'EST DANS DU CODE. Les quatre occurrences trouvées dans
--    `eitri/src` et `brokkr/app` sont des COMMENTAIRES ; le reste vit dans des
--    fixtures de test et le mock, qui ne lisent pas la production. Ce lot ne
--    demande donc aucun déploiement, ni avant ni après.
--
-- Rejouable : chaque UPDATE est borné par un nom source qui n'existe plus après
-- coup. Un second passage ne touche rien.
--
-- Après application, l'invariant de toute la série doit tenir :
--    SELECT count(*) FROM training_exercises te
--      LEFT JOIN library_entries le
--             ON le.category = 'exercices' AND le.name = te.name
--     WHERE le.id IS NULL AND coalesce(btrim(te.name), '') <> '';
--    → 0. (La ligne au nom VIDE préexiste et n'est pas de notre fait.)

BEGIN;

CREATE TEMP TABLE carte (source text PRIMARY KEY, cible text NOT NULL) ON COMMIT DROP;

INSERT INTO carte (source, cible) VALUES
  ('EXTENSION TRICEPS',    'TRICEPS EXTENSION'),
  ('TIRAGE VERTICAL',      'LAT PULLDOWN'),
  ('TIRAGE HORIZONTAL',    'HORIZONTAL ROW'),
  ('CURL POIGNET',         'WRIST CURL'),
  ('ILIAC ROW POULIE',     'CABLE ILIAC ROW'),
  ('ABDUCTEUR',            'HIP ABDUCTION'),
  ('ELEVATIONS LATERALES', 'LATERAL RAISE'),
  ('VELO',                 'BIKE'),
  ('ADDUCTEUR',            'HIP ADDUCTION'),
  ('MARCHE',               'WALK'),
  ('FENTES MARCHEES',      'WALKING LUNGE'),
  ('CHAISE',               'WALL SIT'),
  ('BURPEES COMPLET',      'BURPEE'),
  ('RAMEUR',               'ROWER'),
  ('CRUNCH POULIE',        'CABLE CRUNCH'),
  ('EXTENSION POIGNET',    'WRIST EXTENSION'),
  ('REVERSE PEC DEC',      'REVERSE PEC DECK'),
  ('REHAB EPAULES',        'SHOULDER REHAB'),
  ('ROTATION EXTERNE',     'EXTERNAL ROTATION');

-- ⚠️ GARDE-FOU : ce lot ne doit RIEN fusionner. Si une cible existait déjà en
--    bibliothèque, le renommage violerait `library_entries_category_name_key`
--    plus bas — mais il aurait DÉJÀ mélangé deux historiques dans les tables de
--    données, où rien ne l'empêche. On refuse donc avant d'écrire quoi que ce
--    soit, plutôt que de laisser l'unicité le découvrir trop tard.
DO $$
DECLARE prise text;
BEGIN
  SELECT string_agg(c.cible, ', ') INTO prise
    FROM carte c
   WHERE EXISTS (SELECT 1 FROM library_entries le
                  WHERE le.category = 'exercices' AND le.name = c.cible);
  IF prise IS NOT NULL THEN
    RAISE EXCEPTION 'Cible(s) déjà prises en bibliothèque : % — ce lot ne fusionne pas, corriger la carte.', prise;
  END IF;
END $$;


-- Les données d'abord. Aucune colonne n'est facultative : celle qu'on oublie
-- orpheline ses lignes.
UPDATE training_exercises        t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE training_sets             t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;
UPDATE training_base_principles  t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE training_base_accessories t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE athlete_goals             t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;
UPDATE athlete_prs               t SET movement = c.cible FROM carte c WHERE t.movement = c.source;
UPDATE block_objectives          t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;

-- ⚠️ BORNÉ À `category = 'exercices'` : plusieurs de ces mots existent aussi
--    comme VARIANTES (`POIGNET`, `PRONATION`, `MARTEAU`…). Sans le filtre, on
--    renommerait une variante vivante en croyant toucher un exercice.
UPDATE library_entries le SET name = c.cible
  FROM carte c
 WHERE le.category = 'exercices' AND le.name = c.source;

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) aucune séance ne pointe vers un exercice absent de la bibliothèque :
--    SELECT te.name, count(*) FROM training_exercises te
--      LEFT JOIN library_entries le
--             ON le.category = 'exercices' AND le.name = te.name
--     WHERE le.id IS NULL AND coalesce(btrim(te.name), '') <> ''
--     GROUP BY te.name;                                        -- → vide
--
-- b) les 19 noms sources ont tous disparu :
--    SELECT count(*) FROM library_entries
--     WHERE category = 'exercices'
--       AND name IN ('EXTENSION TRICEPS','TIRAGE VERTICAL','TIRAGE HORIZONTAL',
--                    'CURL POIGNET','ILIAC ROW POULIE','ABDUCTEUR','ELEVATIONS LATERALES',
--                    'VELO','ADDUCTEUR','MARCHE','FENTES MARCHEES','CHAISE','BURPEES COMPLET',
--                    'RAMEUR','CRUNCH POULIE','EXTENSION POIGNET','REVERSE PEC DEC',
--                    'REHAB EPAULES','ROTATION EXTERNE');       -- → 0
--
-- c) le suivi n'a pas perdu de tonnage :
--    SELECT sum(tonnage_kg) FROM training_sets;                 -- inchangé
--
-- d) les variantes n'ont pas bougé :
--    SELECT count(*) FROM library_entries WHERE category = 'variantes';  -- → 77
