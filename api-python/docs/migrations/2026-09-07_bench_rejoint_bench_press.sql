-- `BENCH` REJOINT `BENCH PRESS` (FRE-147) : 372 lignes.
--
-- Correction de William, le 07/09 : « c'est BENCH PRESS qu'on garde ». La
-- migration de la veille avait ouvert `BENCH` à la compétition ; c'est le mauvais
-- des deux noms.
--
-- ⚠️ CE N'EST PAS UN RENOMMAGE, C'EST UNE FUSION, et la donnée l'a dit. Les DEUX
--    entrées existent depuis toujours, et la cible en porte PLUS que la source :
--
--      BENCH        164 séances ·  42 principes de trame ·  2 accessoires
--      BENCH PRESS  212 séances ·  25 principes de trame · 29 accessoires
--
--    Un `UPDATE library_entries SET name = 'BENCH PRESS'` aurait donc violé
--    l'unicité `(category, name)` — la cascade de FRE-123 ne sait pas fusionner,
--    elle sait suivre. Il faut repointer chaque colonne, puis supprimer la
--    source : la mécanique des lots de FRE-11, réemployée telle quelle.
--
-- ⚠️ ET LE DRAPEAU DE COMPÉTITION CHANGE DE PORTEUR. `BENCH` est
--    `competition = true` depuis hier, `BENCH PRESS` est à `false`. Supprimer la
--    source sans passer le drapeau à la cible retirerait le développé couché des
--    lifts de compétition en silence — c'est-à-dire annulerait FRE-147 pour ce
--    mouvement, sans qu'aucune erreur ne le dise.
--
-- MESURÉ AVANT D'ÉCRIRE (07/09, lecture seule) :
--   · 372 lignes à repointer, réparties sur QUATRE colonnes ; zéro dans
--     `athlete_goals`, `athlete_prs` et `block_objectives`.
--   · AUCUNE compétition ne dispute `BENCH` — le drapeau n'a pas encore servi.
--   · AUCUNE variante ne porte ce mot : rien n'échappe aux clés étrangères.
--
-- ⚠️ CE QUE CE LOT NE TOUCHE PAS, ET C'EST VOULU. `BENCH BARRE` (122 séances) et
--    `BENCH HALTERE` (19) restent séparés. Ce sont des noms qui portent leur
--    ÉQUIPEMENT, donc la question de FRE-11 lot 4/5 — « une famille et une
--    variante, ou deux exercices ? » — et elle se tranche avec les coachs, pas
--    au détour d'un correctif de vocabulaire.
--
-- Rejouable : chaque UPDATE est borné par un nom source qui n'existe plus après
-- coup. Un second passage ne touche rien.

BEGIN;

CREATE TEMP TABLE carte (source text PRIMARY KEY, cible text NOT NULL) ON COMMIT DROP;

INSERT INTO carte (source, cible) VALUES
  ('BENCH', 'BENCH PRESS');

-- ⚠️ GARDE-FOU : la cible doit EXISTER. Une faute de frappe créerait un exercice
--    fantôme en emportant 372 lignes d'historique avec lui.
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

-- ⚠️ ET LE PENDANT : une source déjà absente rend le lot silencieusement vide.
--    On le DIT, plutôt que de laisser croire à une application réussie.
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

-- ⚠️ ET CELUI QUI COMPTE VRAIMENT ICI : une compétition qui disputerait `BENCH`
--    perdrait son mouvement. Mesuré à zéro le 07/09, mais c'est exactement le
--    genre de fait qui devient faux entre la mesure et l'exécution.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM competition_movements cm
   JOIN carte c ON upper(cm.movement) = upper(c.source);
  IF n > 0 THEN
    RAISE EXCEPTION '% compétition(s) disputent un nom source — fusion refusée.', n;
  END IF;
END $$;


-- 1. LE DRAPEAU PASSE À LA CIBLE, AVANT que la source ne disparaisse.
UPDATE library_entries le SET competition = true
  FROM carte c
 WHERE le.category = 'exercices' AND le.name = c.cible
   AND EXISTS (SELECT 1 FROM library_entries src
                WHERE src.category = 'exercices' AND src.name = c.source
                  AND src.competition);


-- 2. Les données. Aucune colonne n'est facultative — les trames de bloc en
--    portent 42, et ce sont elles qui reproduiraient l'ancien nom à chaque
--    semaine générée si on les oubliait.
UPDATE training_exercises        t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE training_sets             t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;
UPDATE training_base_principles  t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE training_base_accessories t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE athlete_goals             t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;
UPDATE athlete_prs               t SET movement = c.cible FROM carte c WHERE t.movement = c.source;
UPDATE block_objectives          t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;


-- 3. L'entrée absorbée disparaît.
--
-- ⚠️ BORNÉ À `category = 'exercices'` : la bibliothèque accepte le même nom dans
--    deux catégories, et un lot qui l'oublierait supprimerait une variante
--    vivante. (Aucune ne s'appelle `BENCH` aujourd'hui — la borne reste.)
--
-- ⚠️ ET SI UNE LIGNE AVAIT ÉTÉ OUBLIÉE, CE DELETE ÉCHOUERAIT. Les sept clés
--    étrangères de FRE-123 sont en `NO ACTION` : Postgres refuse d'effacer une
--    entrée encore référencée. C'est le filet, et il vaut mieux que la
--    vérification (a) plus bas, parce qu'il s'exécute DANS la transaction.
DELETE FROM library_entries le
 USING carte c
 WHERE le.category = 'exercices' AND le.name = c.source;

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) `BENCH` a disparu, `BENCH PRESS` dispute :
--    SELECT name, competition FROM library_entries
--     WHERE category = 'exercices' AND upper(name) LIKE 'BENCH%' ORDER BY 1;
--    → BENCH BARRE false · BENCH HALTERE false · BENCH PRESS TRUE
--
-- b) les sept lifts de compétition sont au complet :
--    SELECT name FROM library_entries
--     WHERE category = 'exercices' AND competition ORDER BY 1;
--    → BENCH PRESS, CHIN UP, DEADLIFT, DIPS, MUSCLE UP, PULL UP, SQUAT
--
-- c) l'historique a fusionné, sans en perdre :
--    SELECT count(*) FROM training_exercises WHERE name = 'BENCH PRESS';  -- → 376
--    SELECT count(*) FROM training_base_principles WHERE name = 'BENCH PRESS';  -- → 67
--    (aux séances saisies depuis la mesure du 07/09 près)
--
-- d) le suivi n'a pas perdu de tonnage :
--    SELECT sum(tonnage_kg) FROM training_sets;                 -- inchangé
--
-- e) aucune séance orpheline :
--    SELECT te.name, count(*) FROM training_exercises te
--      LEFT JOIN library_entries le
--             ON le.category = 'exercices' AND le.name = te.name
--     WHERE le.id IS NULL AND te.name IS NOT NULL
--     GROUP BY te.name;                                         -- → vide
