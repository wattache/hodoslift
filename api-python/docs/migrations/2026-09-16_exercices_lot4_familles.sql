-- LOT 4 — LES FAMILLES (FRE-11) : 10 noms réunis en 3.
--
-- Quatrième des cinq lots. Mesuré en production le 16/09 : ~865 séances et
-- ~200 lignes de trame.
--
--   DEV EPAULES (282)             → SHOULDER PRESS
--   DEV MILITAIRE (168)           → SHOULDER PRESS {MILITAIRE}
--   DEV MILITAIRE DB (40)         → SHOULDER PRESS {MILITAIRE, HALTERE}
--   DEV EPAULES (MILITAIRE) (11)  → SHOULDER PRESS {MILITAIRE}
--   DEV MILITAIRE BB (4)          → SHOULDER PRESS {MILITAIRE, BARRE}
--   DEV COUCHE (191)              → BENCH PRESS
--   BENCH BARRE (128)             → BENCH PRESS {BARRE}
--   BENCH HALTERE (22)            → BENCH PRESS {HALTERE}
--   DEV INCLINÉ (5)               → BENCH PRESS {INCLINÉ}
--   CURL MARTEAU (12)             → CURL {MARTEAU}
--
-- ⚠️ DEUX EXERCICES, PAS PLUS — ET C'EST UN RENVERSEMENT ASSUMÉ (William, 16/09 :
--    « les exercices c'est SHOULDER PRESS et BENCH PRESS »). Le plan du 04/09
--    gardait un nom à l'haltère au couché, au motif de l'ÉCHELLE DE CHARGE :
--    30,5 kg de moyenne contre 81,5 à la barre, et le suivi agrège par exercice
--    SEUL (`GROUP BY exercise`). Ce motif reste vrai : les courbes de BENCH PRESS
--    mêleront désormais barre, haltère et incliné. L'équipement et l'inclinaison
--    deviennent des VARIANTES, et c'est au suivi de savoir les séparer s'il le
--    faut — pas au nom de l'exercice.
--
-- ⚠️ `BENCH PRESS` EST UN MOUVEMENT DE COMPÉTITION en bibliothèque. Les records
--    se lisent au MAXIMUM : l'haltère et l'incliné, plus légers, n'en déplacent
--    aucun. Les MOYENNES, elles, baisseront.
--
-- ⚠️ LES VARIANTES AJOUTÉES SONT CELLES QUI EXISTENT, EN FRANÇAIS. Le plan du
--    04/09 ajoutait `MILITARY`, `BARBELL`, `DUMBBELL` et `HAMMER` à côté de
--    `MILITAIRE`, `BARRE`, `HALTERE` et `MARTEAU`, qui existent déjà et servent
--    — d'où un dédoublonnage croisé des deux langues, et des lignes mélangées
--    le temps du lot 5. On ajoute donc le mot DÉJÀ EN USAGE : le lot 5 traduira
--    les 76 variantes d'un seul geste, et aucune ligne ne porte deux langues
--    entre-temps. Seule `INCLINÉ` est créée : aucune variante ne le disait.
--
-- ⚠️ `GAINAGE` N'EST PAS DANS CE LOT (William, 16/09 : « on ne touche pas »).
--
-- ⚠️ AUCUNE LIGNE NE DÉPASSE TROIS VARIANTES, plafond de l'interface — mesuré le
--    16/09 sur les quatre tables : 863 séances, maximum atteint 3. La garde
--    plus bas le revérifie AU MOMENT de l'application.
--
-- ⚠️ LE NOM EST UNE RÉFÉRENCE DEPUIS FRE-123 (`ON UPDATE CASCADE` sur les huit
--    tables), mais une FUSION ne se fait pas en renommant : la cible existe
--    déjà, et `(category, name)` est unique. On repointe donc chaque colonne,
--    PUIS on supprime les entrées vidées — la clé étrangère refuserait l'inverse.
--
-- Rejouable : chaque UPDATE est borné par un nom source qui n'existe plus après
-- coup. Un second passage ne touche rien.

BEGIN;

CREATE TEMP TABLE carte (
  source text PRIMARY KEY,
  cible  text NOT NULL,
  ajouts text[] NOT NULL DEFAULT '{}'
) ON COMMIT DROP;

INSERT INTO carte (source, cible, ajouts) VALUES
  ('DEV EPAULES',             'SHOULDER PRESS', '{}'),
  ('DEV MILITAIRE',           'SHOULDER PRESS', '{MILITAIRE}'),
  ('DEV EPAULES (MILITAIRE)', 'SHOULDER PRESS', '{MILITAIRE}'),
  ('DEV MILITAIRE BB',        'SHOULDER PRESS', '{MILITAIRE,BARRE}'),
  ('DEV MILITAIRE DB',        'SHOULDER PRESS', '{MILITAIRE,HALTERE}'),
  ('DEV COUCHE',              'BENCH PRESS',    '{}'),
  ('BENCH BARRE',             'BENCH PRESS',    '{BARRE}'),
  ('BENCH HALTERE',           'BENCH PRESS',    '{HALTERE}'),
  ('DEV INCLINÉ',             'BENCH PRESS',    '{INCLINÉ}'),
  ('CURL MARTEAU',            'CURL',           '{MARTEAU}');

-- ⚠️ GARDE-FOU : ce lot ne fait QUE fusionner. Une cible absente serait une faute
--    de frappe, et le lot créerait un exercice fantôme en emportant l'historique.
DO $$
DECLARE fantome text;
BEGIN
  SELECT string_agg(DISTINCT c.cible, ', ') INTO fantome
    FROM carte c
   WHERE NOT EXISTS (SELECT 1 FROM library_entries le
                      WHERE le.category = 'exercices' AND le.name = c.cible);
  IF fantome IS NOT NULL THEN
    RAISE EXCEPTION 'Cible(s) absentes de la bibliothèque : % — ce lot ne crée aucun exercice.', fantome;
  END IF;
END $$;

-- Et le pendant : une source déjà absente rend le lot silencieusement vide.
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

-- ⚠️ LE PLAFOND DE TROIS VARIANTES, revérifié au moment d'écrire : une ligne qui
--    le dépasserait ne serait plus éditable à l'écran sans perdre une variante.
DO $$
DECLARE trop int;
BEGIN
  SELECT count(*) INTO trop FROM (
    SELECT (SELECT count(DISTINCT v) FROM unnest(coalesce(x.variant, '{}') || c.ajouts) v) AS n
      FROM training_exercises x JOIN carte c ON c.source = x.name
    UNION ALL
    SELECT (SELECT count(DISTINCT v) FROM unnest(coalesce(x.variant, '{}') || c.ajouts) v)
      FROM training_base_principles x JOIN carte c ON c.source = x.name
    UNION ALL
    SELECT (SELECT count(DISTINCT v) FROM unnest(coalesce(x.variant, '{}') || c.ajouts) v)
      FROM training_base_accessories x JOIN carte c ON c.source = x.name
  ) s WHERE n > 3;
  IF trop > 0 THEN
    RAISE EXCEPTION '% ligne(s) dépasseraient trois variantes — à trancher avant ce lot.', trop;
  END IF;
END $$;


-- 0. La seule variante neuve.
INSERT INTO library_entries (category, name)
SELECT 'variantes', 'INCLINÉ'
 WHERE NOT EXISTS (SELECT 1 FROM library_entries WHERE category = 'variantes' AND name = 'INCLINÉ');


-- 1. LES VARIANTES D'ABORD, tant que le nom source identifie encore les lignes.
--
-- ⚠️ L'ORDRE DE SAISIE DU COACH EST CONSERVÉ : les variantes existantes gardent
--    leur rang, les ajoutées se posent à la suite, sans doublon. `array_agg`
--    sans `ORDER BY` rendrait un ordre arbitraire.
CREATE OR REPLACE FUNCTION pg_temp.ajouter_variantes(existantes text[], ajouts text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(v ORDER BY rang), '{}')
    FROM (
      SELECT v, ord AS rang FROM unnest(coalesce(existantes, '{}')) WITH ORDINALITY AS a(v, ord)
      UNION ALL
      SELECT aj, 1000 + ord FROM unnest(ajouts) WITH ORDINALITY AS b(aj, ord)
       WHERE NOT (aj = ANY(coalesce(existantes, '{}')))
    ) s
$$;

UPDATE training_exercises        t SET variant = pg_temp.ajouter_variantes(t.variant, c.ajouts)
  FROM carte c WHERE t.name     = c.source AND cardinality(c.ajouts) > 0;
UPDATE training_sets             t SET variant = pg_temp.ajouter_variantes(t.variant, c.ajouts)
  FROM carte c WHERE t.exercise = c.source AND cardinality(c.ajouts) > 0;
UPDATE training_base_principles  t SET variant = pg_temp.ajouter_variantes(t.variant, c.ajouts)
  FROM carte c WHERE t.name     = c.source AND cardinality(c.ajouts) > 0;
UPDATE training_base_accessories t SET variant = pg_temp.ajouter_variantes(t.variant, c.ajouts)
  FROM carte c WHERE t.name     = c.source AND cardinality(c.ajouts) > 0;


-- 2. Les noms, sur les huit colonnes. Aucune n'est facultative : les trames de
--    bloc reproduiraient l'ancien nom à chaque semaine générée si on les oubliait.
UPDATE training_exercises        t SET name      = c.cible FROM carte c WHERE t.name      = c.source;
UPDATE training_sets             t SET exercise  = c.cible FROM carte c WHERE t.exercise  = c.source;
UPDATE training_base_principles  t SET name      = c.cible FROM carte c WHERE t.name      = c.source;
UPDATE training_base_accessories t SET name      = c.cible FROM carte c WHERE t.name      = c.source;
UPDATE athlete_goals             t SET exercise  = c.cible FROM carte c WHERE t.exercise  = c.source;
UPDATE athlete_prs               t SET movement  = c.cible FROM carte c WHERE t.movement  = c.source;
UPDATE block_objectives          t SET exercise  = c.cible FROM carte c WHERE t.exercise  = c.source;
UPDATE objectifs_techniques      t SET mouvement = c.cible FROM carte c WHERE t.mouvement = c.source;


-- 3. Ce que les sources SOUTENAIENT passe à la cible, plutôt que de disparaître
--    avec elles : `DEV MILITAIRE BB` soutenait MU et DIP, `DEV MILITAIRE DB` DIP.
--    ⚠️ NULL reste NULL quand aucune source ne disait rien (FRE-157) : un `[]`
--    ne se lirait pas autrement, et la contrainte le refuserait.
UPDATE library_entries cible SET supports = (
  SELECT array_agg(DISTINCT s ORDER BY s)
    FROM (SELECT unnest(coalesce(cible.supports, '{}')) AS s
          UNION
          SELECT unnest(le.supports) FROM library_entries le JOIN carte c
                ON le.category = 'exercices' AND le.name = c.source AND c.cible = cible.name
           WHERE le.supports IS NOT NULL) tout)
 WHERE cible.category = 'exercices'
   AND EXISTS (SELECT 1 FROM library_entries le JOIN carte c
                ON le.category = 'exercices' AND le.name = c.source AND c.cible = cible.name
               WHERE le.supports IS NOT NULL);


-- 4. Les entrées vidées disparaissent — APRÈS le repointage, la clé étrangère
--    refuserait l'inverse. ⚠️ BORNÉ À `exercices` : `MARTEAU` existe aussi en
--    variante, et elle sert.
DELETE FROM library_entries le
 USING carte c
 WHERE le.category = 'exercices' AND le.name = c.source;

-- L'EXERCICE `MARTEAU`, jamais utilisé une fois (mesuré le 16/09 : zéro ligne sur
-- les huit tables) : la variante du même nom, elle, reste.
DELETE FROM library_entries le
 WHERE le.category = 'exercices' AND le.name = 'MARTEAU'
   AND NOT EXISTS (SELECT 1 FROM training_exercises WHERE name = 'MARTEAU')
   AND NOT EXISTS (SELECT 1 FROM training_base_accessories WHERE name = 'MARTEAU')
   AND NOT EXISTS (SELECT 1 FROM training_base_principles WHERE name = 'MARTEAU');

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-16_exercices_lot4_familles.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) les dix sources et l'exercice MARTEAU ont disparu :
--    SELECT count(*) FROM library_entries WHERE category = 'exercices' AND name IN
--      ('DEV EPAULES','DEV MILITAIRE','DEV EPAULES (MILITAIRE)','DEV MILITAIRE BB',
--       'DEV MILITAIRE DB','DEV COUCHE','BENCH BARRE','BENCH HALTERE','DEV INCLINÉ',
--       'CURL MARTEAU','MARTEAU');                                   -- → 0
--
-- b) aucune ligne ne porte plus un ancien nom (la clé étrangère le garantit, mais
--    le compte le montre) : même liste sur training_exercises.name      -- → 0
--
-- c) le suivi n'a pas perdu de tonnage :
--    SELECT sum(tonnage_kg) FROM training_sets;                    -- inchangé
--
-- d) aucune ligne au-delà de trois variantes :
--    SELECT count(*) FROM training_exercises WHERE cardinality(variant) > 3;  -- → 0
