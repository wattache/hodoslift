-- LOT 5 — LES VARIANTES PASSENT EN ANGLAIS (FRE-11).
--
-- Dernier des cinq lots. Mesuré en production le 16/09 puis remesuré le 17/09 : 83
-- variantes en bibliothèque, aucune orpheline, aucune cible anglaise déjà prise ;
-- les colonnes `variant` en TEXTE (`athlete_prs`, `block_objectives`) n'en portent
-- aucune. Aucune n'est citée dans `eitri/src` ni `brokkr/app`.
--
-- Attendu le 16/09 (« laissons les gens un peu s'habituer » au lot 4), validé le
-- 17/09 avec les cinq mots qui restaient ouverts (voir la carte plus bas).
--
-- ⚠️ ON NE TRADUIT QUE LE FRANÇAIS. La majorité est déjà dans le vocabulaire de
--    salle (`COMP`, `DS`, `HIGH BAR`, `NO DIPS`, `FULL STIFF SLEEVES`…) ou un
--    sigle (`FFE` = front foot elevated, `SSB`, `ISO`) : ils ne bougent pas.
--
-- ⚠️ AUCUNE CLÉ NE GARDE LES VARIANTES — elles vivent en `text[]`, et Postgres ne
--    référence pas un élément de tableau (cf. FRE-123 dans `postgres-schema.sql`).
--    Renommer l'entrée de bibliothèque seule laisserait les séances sur l'ancien
--    mot, sans rien qui proteste. D'où les quatre tableaux pilotés un par un.
--
-- ⚠️ BORNÉ À `category = 'variantes'` : `EXCENTRIQUE UNIQUEMENT` existe aussi en
--    exercice, `DS` et `PAUSE` en tempo. Ceux-là ne bougent pas.
--
-- ⚠️ UNE FUSION EST POSSIBLE (`NO DIP` → `NO DIPS`) : une ligne qui porterait les
--    deux ne doit pas sortir en `{NO DIPS, NO DIPS}`. Le remappage dédoublonne en
--    gardant le PREMIER rang, donc l'ordre de saisie du coach.
--
-- Rejouable : chaque UPDATE est borné par un mot source qui n'existe plus après
-- coup. Un second passage ne touche rien.

BEGIN;

CREATE TEMP TABLE carte (
  source text PRIMARY KEY,
  cible  text NOT NULL
) ON COMMIT DROP;

INSERT INTO carte (source, cible) VALUES
  -- Traductions sèches.
  ('HALTERE',                'DUMBBELL'),
  ('BARRE',                  'BARBELL'),
  ('NEUTRE',                 'NEUTRAL'),
  ('NEUTRE SERREE',          'CLOSE NEUTRAL'),
  ('POULIE',                 'CABLE'),
  ('MILITAIRE',              'MILITARY'),
  ('LESTE',                  'WEIGHTED'),
  ('GOBELET',                'GOBLET'),
  ('ANNEAUX',                'RINGS'),
  ('MARTEAU',                'HAMMER'),
  ('EXCENTRIQUE UNIQUEMENT', 'ECCENTRIC ONLY'),
  ('LARGE',                  'WIDE'),
  ('POIGNET',                'WRIST'),
  ('ASSIS',                  'SEATED'),
  ('INCLINÉ',                'INCLINE'),
  ('BANC',                   'BENCH'),
  ('ALLONGE',                'LYING'),             -- LEG CURL
  ('PLANCHE',                'PLANK'),             -- GAINAGE
  ('BUSTE BLOQUE',           'CHEST SUPPORTED'),   -- ROWING
  ('PAUSE TIBIAS',           'SHIN PAUSE'),        -- DEADLIFT
  -- `REVERSE` existe déjà et sert au PEC DECK : « à l'envers » sur WALK est une
  -- MARCHE ARRIÈRE, pas le même geste.
  ('A L''ENVERS',            'BACKWARD'),
  -- Tranchés par William le 17/09.
  -- « Libre » n'est PAS « sans lest » : l'athlète choisit sa façon — dead stop,
  -- contrôlé, ou one shot (William, 17/09).
  ('LIBRE',                  'FREE'),              -- PULL UP, MUSCLE UP, DIPS
  ('TIRAGE MU',              'MU PULL'),           -- PULL UP, MUSCLE UP
  ('POIDS DEVANT',           'FRONT WEIGHT'),      -- MUSCLE UP
  ('PRONO-SUPINATION',       'ZOTTMAN'),           -- CURL BICEPS
  ('NO DIP',                 'NO DIPS');           -- fusion : MUSCLE UP des deux côtés

-- ⚠️ GARDE-FOU : une cible qui existe déjà en variante n'est acceptée que si elle
--    est AUSSI une cible de la carte ou une fusion voulue. Sinon, une traduction
--    tomberait en silence sur un mot vivant d'un autre sens (le cas `REVERSE`).
DO $$
DECLARE collision text;
BEGIN
  SELECT string_agg(c.source || ' → ' || c.cible, ', ') INTO collision
    FROM carte c
   WHERE c.cible NOT IN ('NO DIPS')
     -- une source déjà traduite n'est plus une collision : le rejeu passe
     AND EXISTS (SELECT 1 FROM library_entries le
                  WHERE le.category = 'variantes' AND le.name = c.source)
     AND EXISTS (SELECT 1 FROM library_entries le
                  WHERE le.category = 'variantes' AND le.name = c.cible);
  IF collision IS NOT NULL THEN
    RAISE EXCEPTION 'Cible(s) déjà en bibliothèque, fusion non prévue : %', collision;
  END IF;
END $$;

-- Et le pendant : une source déjà absente rend la ligne silencieusement vide.
DO $$
DECLARE absente text;
BEGIN
  SELECT string_agg(c.source, ', ') INTO absente
    FROM carte c
   WHERE NOT EXISTS (SELECT 1 FROM library_entries le
                      WHERE le.category = 'variantes' AND le.name = c.source);
  IF absente IS NOT NULL THEN
    RAISE WARNING 'Source(s) déjà absentes, rien à traduire pour : %', absente;
  END IF;
END $$;

-- ⚠️ LES COLONNES TEXTE, mesurées vides de ces mots : si ça change d'ici
--    l'application, on s'arrête plutôt que de les oublier.
DO $$
DECLARE n int;
BEGIN
  SELECT (SELECT count(*) FROM athlete_prs      WHERE variant IN (SELECT source FROM carte))
       + (SELECT count(*) FROM block_objectives WHERE variant IN (SELECT source FROM carte))
    INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION '% ligne(s) portent une variante source en texte (athlete_prs, block_objectives) — non prévu.', n;
  END IF;
END $$;


-- 1. Les tableaux. Chaque mot est remappé à son rang ; un doublon né d'une
--    fusion garde le premier. `array_agg` sans `ORDER BY` rendrait un ordre
--    arbitraire. NULL reste NULL.
CREATE OR REPLACE FUNCTION pg_temp.traduire(variantes text[]) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN variantes IS NULL THEN NULL ELSE (
    SELECT coalesce(array_agg(v ORDER BY rang), '{}')
      FROM (SELECT DISTINCT ON (v) v, rang
              FROM (SELECT coalesce(c.cible, a.v) AS v, a.ord AS rang
                      FROM unnest(variantes) WITH ORDINALITY AS a(v, ord)
                      LEFT JOIN carte c ON c.source = a.v) m
             ORDER BY v, rang) d
  ) END
$$;

UPDATE training_exercises        SET variant = pg_temp.traduire(variant) WHERE variant && (SELECT array_agg(source) FROM carte);
UPDATE training_sets             SET variant = pg_temp.traduire(variant) WHERE variant && (SELECT array_agg(source) FROM carte);
UPDATE training_base_principles  SET variant = pg_temp.traduire(variant) WHERE variant && (SELECT array_agg(source) FROM carte);
UPDATE training_base_accessories SET variant = pg_temp.traduire(variant) WHERE variant && (SELECT array_agg(source) FROM carte);


-- 2. La bibliothèque. Une fusion supprime la source (la cible existe) ; sinon on
--    renomme. ⚠️ BORNÉ À `variantes`.
DELETE FROM library_entries le
 USING carte c
 WHERE le.category = 'variantes' AND le.name = c.source
   AND EXISTS (SELECT 1 FROM library_entries x WHERE x.category = 'variantes' AND x.name = c.cible);

UPDATE library_entries le SET name = c.cible
  FROM carte c
 WHERE le.category = 'variantes' AND le.name = c.source;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-17_exercices_lot5_variantes.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) aucune variante source ne subsiste, ni en bibliothèque ni dans une ligne :
--    SELECT count(*) FROM library_entries WHERE category = 'variantes' AND name IN
--      ('HALTERE','BARRE','NEUTRE','NEUTRE SERREE','POULIE','MILITAIRE','LESTE',
--       'GOBELET','ANNEAUX','MARTEAU','EXCENTRIQUE UNIQUEMENT','LARGE','POIGNET',
--       'ASSIS','INCLINÉ','BANC','ALLONGE','PLANCHE','BUSTE BLOQUE','PAUSE TIBIAS',
--       'A L''ENVERS','LIBRE','TIRAGE MU','POIDS DEVANT','PRONO-SUPINATION','NO DIP');  -- → 0
--
-- b) aucune variante utilisée n'est absente de la bibliothèque :
--    SELECT DISTINCT v FROM training_exercises, unnest(variant) v
--     WHERE NOT EXISTS (SELECT 1 FROM library_entries
--                        WHERE category = 'variantes' AND name = v);        -- → 0 ligne
--
-- c) le nombre de lignes et le tonnage n'ont pas bougé :
--    SELECT count(*), sum(tonnage_kg) FROM training_sets;               -- inchangés
--
-- d) aucune ligne au-delà de trois variantes :
--    SELECT count(*) FROM training_exercises WHERE cardinality(variant) > 3;  -- → 0
