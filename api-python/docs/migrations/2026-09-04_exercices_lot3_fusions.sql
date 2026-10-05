-- LOT 3 — LES FUSIONS DE VOCABULAIRE (FRE-11) : 6 noms, 1 201 lignes.
--
-- Troisième des cinq lots. Deux mots pour un mouvement, chacun déjà utilisé de
-- son côté : les réunir mélange deux historiques, définitivement.
--
--   TRACTIONS (27)       → PULL UP (1 398)
--   POMPES (227)         → PUSH UPS (3)
--   ECARTES (184)        → PECTORAL FLY (82)
--   FENTES BULGARE (108) → BULGARIAN SPLIT SQUAT (122)
--   OISEAUX (12)         → REAR DELT FLY (70)
--   PEC DEC (1)          → PEC DECK (61)
--
-- ⚠️ `GAINAGE` A ÉTÉ RETIRÉ DE CE LOT, ET C'EST LA DONNÉE QUI L'A DIT. Il
--    devait rejoindre `PLANK`. Or 12 de ses 25 lignes portent DÉJÀ la variante
--    `PLANCHE` : quand c'était une planche, le coach l'a écrit. Les 13 autres ne
--    le disent pas, et `CHINESE PLANK` (114 séances), `HOLLOW BODY` (163),
--    `COPENHAGEN PLANK` et `X-PLANK` existent séparément. « Gainage » est le mot
--    GÉNÉRIQUE du travail de tronc, pas le nom d'un exercice — le verser dans
--    `PLANK` (2 séances) affirmerait que « gainage + BRING SALLY UP » est une
--    planche. Question rendue aux coachs ; traité au lot 4 ou plus tard.
--
-- ⚠️ `ECARTES → PECTORAL FLY` A ÉTÉ VÉRIFIÉ AVANT D'ÊTRE GARDÉ. Le doute portait
--    sur l'équipement — écartés haltères contre machine — c'est-à-dire sur la
--    règle de l'échelle de charge. Les deux noms portent les MÊMES variantes
--    (`POULIE` 55/14, `HALTERE` 28/8) et des charges comparables : 27,1 kg de
--    moyenne contre 30,0. Même mouvement, deux mots.
--
-- ⚠️ `TRACTIONS → PULL UP` TOUCHE UN MOUVEMENT DE COMPÉTITION, mais sans risque
--    pour les records : `athlete_prs.movement` et `competition_movements.movement`
--    ne portent aucun de ces six noms (vérifié). Le total RIS et le tableau des
--    PR sont calculés sur `PULL UP`, qui ne change pas de nom ; il gagne 27
--    séances d'historique et rien d'autre.
--
-- ⚠️ IL N'Y A AUCUNE CLÉ ÉTRANGÈRE SUR LE NOM D'EXERCICE (cf. lot 1) : chaque
--    colonne est pilotée explicitement. Les trames de bloc en portent 108, et
--    ce sont elles qui reproduiraient l'ancien nom à chaque semaine générée si
--    on les oubliait.
--
-- Rejouable : chaque UPDATE est borné par un nom source qui n'existe plus après
-- coup. Un second passage ne touche rien.

BEGIN;

CREATE TEMP TABLE carte (source text PRIMARY KEY, cible text NOT NULL) ON COMMIT DROP;

INSERT INTO carte (source, cible) VALUES
  ('TRACTIONS',      'PULL UP'),
  ('POMPES',         'PUSH UPS'),
  ('ECARTES',        'PECTORAL FLY'),
  ('FENTES BULGARE', 'BULGARIAN SPLIT SQUAT'),
  ('OISEAUX',        'REAR DELT FLY'),
  ('PEC DEC',        'PEC DECK');

-- ⚠️ GARDE-FOU : ce lot ne fait QUE fusionner. Chaque cible doit exister en
--    bibliothèque — une cible absente serait une faute de frappe, et le lot
--    créerait un exercice fantôme en emportant l'historique avec lui.
--    Contrairement au lot 2, aucune cible neuve n'est admise ici.
DO $$
DECLARE fantome text;
BEGIN
  SELECT string_agg(DISTINCT c.cible, ', ') INTO fantome
    FROM carte c
   WHERE NOT EXISTS (SELECT 1 FROM library_entries le
                      WHERE le.category = 'exercices' AND le.name = c.cible);
  IF fantome IS NOT NULL THEN
    RAISE EXCEPTION 'Cible(s) absentes de la bibliothèque : % — ce lot ne crée aucun nom.', fantome;
  END IF;
END $$;

-- ⚠️ ET LE PENDANT : une source qui n'existe plus (lot déjà joué, ou nom corrigé
--    entre-temps par un coach) rend le lot silencieusement vide. On le DIT,
--    plutôt que de laisser croire à une application réussie.
DO $$
DECLARE absente text;
BEGIN
  SELECT string_agg(c.source, ', ') INTO absente
    FROM carte c
   WHERE NOT EXISTS (SELECT 1 FROM library_entries le
                      WHERE le.category = 'exercices' AND le.name = c.source);
  IF absente IS NOT NULL THEN
    RAISE WARNING 'Source(s) déjà absentes, rien à fusionner pour : %', absente;
  END IF;
END $$;


-- 1. Les données. Aucune colonne n'est facultative.
UPDATE training_exercises        t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE training_sets             t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;
UPDATE training_base_principles  t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE training_base_accessories t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE athlete_goals             t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;
UPDATE athlete_prs               t SET movement = c.cible FROM carte c WHERE t.movement = c.source;
UPDATE block_objectives          t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;


-- 2. Les six entrées absorbées disparaissent.
--
-- ⚠️ BORNÉ À `category = 'exercices'`. Aucun de ces six mots n'est aujourd'hui
--    une variante, mais la borne reste : `MARTEAU` et `EXCENTRIQUE UNIQUEMENT`
--    ont montré que la bibliothèque accepte le même nom dans deux catégories,
--    et un lot qui l'oublierait supprimerait une variante vivante.
DELETE FROM library_entries le
 USING carte c
 WHERE le.category = 'exercices' AND le.name = c.source;

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) aucune séance orpheline :
--    SELECT te.name, count(*) FROM training_exercises te
--      LEFT JOIN library_entries le
--             ON le.category = 'exercices' AND le.name = te.name
--     WHERE le.id IS NULL AND coalesce(btrim(te.name), '') <> ''
--     GROUP BY te.name;                                        -- → vide
--
-- b) les six sources ont disparu :
--    SELECT count(*) FROM library_entries
--     WHERE category = 'exercices'
--       AND name IN ('TRACTIONS','POMPES','ECARTES','FENTES BULGARE','OISEAUX','PEC DEC');
--                                                              -- → 0
--
-- c) les totaux fusionnés :
--    SELECT name, count(*) FROM training_exercises
--     WHERE name IN ('PULL UP','PUSH UPS','PECTORAL FLY','BULGARIAN SPLIT SQUAT',
--                    'REAR DELT FLY','PEC DECK')
--     GROUP BY name ORDER BY 2 DESC;
--    → attendu : PULL UP 1 425, PECTORAL FLY 266, BULGARIAN SPLIT SQUAT 230,
--                PUSH UPS 230, REAR DELT FLY 82, PEC DECK 62
--      (aux séances saisies depuis la mesure du 04/09 près)
--
-- d) le suivi n'a pas perdu de tonnage :
--    SELECT sum(tonnage_kg) FROM training_sets;                 -- inchangé
--
-- e) la bibliothèque perd exactement 6 entrées :
--    SELECT count(*) FROM library_entries WHERE category = 'exercices';  -- 107 → 101
--
-- f) les records de compétition n'ont pas bougé :
--    SELECT count(*) FROM athlete_prs WHERE movement = 'PULL UP';  -- inchangé
