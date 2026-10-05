-- LE NOM D'EXERCICE DEVIENT UNE RÉFÉRENCE (FRE-123).
--
-- Un renommage depuis la bibliothèque fracturait l'historique en silence :
-- `PATCH /library/entries/{id}` n'écrivait que dans `library_entries`, et les
-- sept colonnes qui portent un nom d'exercice ailleurs étaient du TEXTE LIBRE.
-- Mesuré le 06/09 sur un renommage de `SQUAT` : **4 125 lignes orphelines**,
-- aucune alerte — dont les 50 records de `athlete_prs`, donc le RIS avec.
--
-- Choix de William (06/09) : « un schéma solide qui reflète le métier ». On rend
-- donc la fracture IMPOSSIBLE (`ON UPDATE CASCADE`) plutôt que CORRIGÉE par une
-- fonction Python que le prochain chemin d'écriture pourrait contourner. C'est
-- la règle de `regle_dupliquee_calcul_duplique` appliquée à l'intégrité, et
-- c'est déjà ce que `objectifs_techniques` fait depuis FRE-122 — la seule table
-- qui a survécu aux trois lots de renommage de FRE-11.
--
-- ⚠️ UNE COLONNE `categorie` CONSTANTE PAR TABLE, ET CE N'EST PAS UN OUBLI DE
--    CONCEPTION. `library_entries` est unique sur `(category, name)` ; une clé
--    étrangère doit référencer ce couple entier, et Postgres ne sait pas viser
--    un index unique PARTIEL (`UNIQUE (name) WHERE category = 'exercices'`).
--    Un `UNIQUE (name)` seul est impossible : `EXCENTRIQUE UNIQUEMENT` existe
--    légitimement en exercice ET en variante. La colonne constante est donc le
--    prix du modèle, déjà payé et documenté par FRE-122.
--
-- ⚠️ CE QU'AUCUNE CLÉ ÉTRANGÈRE NE COUVRIRA : les VARIANTES. Elles vivent dans
--    des colonnes `text[]`, et Postgres ne référence pas un ÉLÉMENT de tableau.
--    Renommer une variante restera donc à faire à la main — c'est précisément
--    le lot 5 de FRE-11, et il devra continuer de piloter chaque colonne
--    explicitement. Le dire ici pour que personne ne croie le problème clos.
--
-- ⚠️ ET LE VRAI VERROU N'ÉTAIT PAS LA CONTRAINTE, C'ÉTAIT `''`. Six colonnes sur
--    sept sont `NOT NULL` et acceptent la chaîne vide, que l'éditeur écrit pour
--    une ligne qu'on vient d'ajouter et dont le mouvement n'est pas encore
--    choisi. Une clé étrangère REFUSE `''` (aucune entrée ne s'appelle ainsi)
--    mais ACCEPTE `NULL`. Il faut donc que « pas encore choisi » cesse d'être
--    une chaîne vide pour devenir une absence — le défaut le plus récurrent du
--    projet, et ici c'est lui qui bloquait la solution propre.
--
--    Le front ne voit rien : la lecture de l'arbre convertit déjà `NULL → ''`
--    par défaut (`training_tree.py`), et `name` n'est pas dans les exceptions.
--
-- MESURÉ AVANT D'ÉCRIRE, sur les 7 colonnes : **zéro valeur orpheline**, et
-- seulement DEUX chaînes vides en tout — une ligne d'exercice vierge (séance
-- « Lundi », position 4, sans séries ni reps ni charge) et un objectif de bloc
-- entièrement vide. La contrainte passe donc sans rien détruire.
--
-- ⚠️ À JOUER AVANT DE DÉPLOYER brokkr : le code qui suit convertit `''` en NULL
--    à l'écriture. Sans les colonnes nullables, une ligne neuve serait refusée.
--
-- Après application : `make schema-verifier` doit rester vert.

BEGIN;

-- --------------------------------------------------------------------------- #
-- 1. « PAS ENCORE CHOISI » DEVIENT UNE ABSENCE, PAS UNE CHAÎNE VIDE
-- --------------------------------------------------------------------------- #

ALTER TABLE training_exercises        ALTER COLUMN name     DROP NOT NULL;
ALTER TABLE training_base_principles  ALTER COLUMN name     DROP NOT NULL;
ALTER TABLE training_base_accessories ALTER COLUMN name     DROP NOT NULL;
ALTER TABLE athlete_goals             ALTER COLUMN exercise DROP NOT NULL;
ALTER TABLE athlete_prs               ALTER COLUMN movement DROP NOT NULL;

-- ⚠️ `training_sets` GARDE SON `NOT NULL`. C'est une PROJECTION, et elle écarte
--    déjà les lignes sans nom (`WHERE btrim(e.name) <> ''` dans
--    `etl_training_sets.py`). Lui ouvrir le NULL inventerait un état que le
--    rebuild ne produit jamais.

UPDATE training_exercises        SET name     = NULL WHERE btrim(name) = '';
UPDATE training_base_principles  SET name     = NULL WHERE btrim(name) = '';
UPDATE training_base_accessories SET name     = NULL WHERE btrim(name) = '';
UPDATE athlete_goals             SET exercise = NULL WHERE btrim(exercise) = '';
UPDATE athlete_prs               SET movement = NULL WHERE btrim(movement) = '';
UPDATE block_objectives          SET exercise = NULL WHERE btrim(exercise) = '';


-- --------------------------------------------------------------------------- #
-- 2. LA CATÉGORIE VISÉE, CONSTANTE — le prix de la référence composite
-- --------------------------------------------------------------------------- #

ALTER TABLE training_exercises
  ADD COLUMN IF NOT EXISTS categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE training_sets
  ADD COLUMN IF NOT EXISTS categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE training_base_principles
  ADD COLUMN IF NOT EXISTS categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE training_base_accessories
  ADD COLUMN IF NOT EXISTS categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE athlete_goals
  ADD COLUMN IF NOT EXISTS categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE athlete_prs
  ADD COLUMN IF NOT EXISTS categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE block_objectives
  ADD COLUMN IF NOT EXISTS categorie library_category NOT NULL DEFAULT 'exercices';


-- --------------------------------------------------------------------------- #
-- 3. LES CLÉS ÉTRANGÈRES
--
-- ⚠️ DROP PUIS ADD, ET `IF EXISTS` : la migration du retrait de `%` (FRE-105) a
--    échoué en production sur un 42710 — « la contrainte existe déjà » — parce
--    qu'elle avait été écrite depuis le CODE et non depuis la base. Une
--    migration se rejoue.
--
-- ⚠️ PAS DE `ON DELETE` : la bibliothèque n'a aucune route de suppression. Le
--    défaut (`NO ACTION`) refusera d'effacer une entrée encore référencée, ce
--    qui est le comportement voulu — un historique ne part pas avec une entrée
--    de catalogue.
-- --------------------------------------------------------------------------- #

ALTER TABLE training_exercises        DROP CONSTRAINT IF EXISTS training_exercises_mouvement_fkey;
ALTER TABLE training_sets             DROP CONSTRAINT IF EXISTS training_sets_mouvement_fkey;
ALTER TABLE training_base_principles  DROP CONSTRAINT IF EXISTS training_base_principles_mouvement_fkey;
ALTER TABLE training_base_accessories DROP CONSTRAINT IF EXISTS training_base_accessories_mouvement_fkey;
ALTER TABLE athlete_goals             DROP CONSTRAINT IF EXISTS athlete_goals_mouvement_fkey;
ALTER TABLE athlete_prs               DROP CONSTRAINT IF EXISTS athlete_prs_mouvement_fkey;
ALTER TABLE block_objectives          DROP CONSTRAINT IF EXISTS block_objectives_mouvement_fkey;

ALTER TABLE training_exercises ADD CONSTRAINT training_exercises_mouvement_fkey
  FOREIGN KEY (categorie, name) REFERENCES library_entries (category, name) ON UPDATE CASCADE;

ALTER TABLE training_sets ADD CONSTRAINT training_sets_mouvement_fkey
  FOREIGN KEY (categorie, exercise) REFERENCES library_entries (category, name) ON UPDATE CASCADE;

ALTER TABLE training_base_principles ADD CONSTRAINT training_base_principles_mouvement_fkey
  FOREIGN KEY (categorie, name) REFERENCES library_entries (category, name) ON UPDATE CASCADE;

ALTER TABLE training_base_accessories ADD CONSTRAINT training_base_accessories_mouvement_fkey
  FOREIGN KEY (categorie, name) REFERENCES library_entries (category, name) ON UPDATE CASCADE;

ALTER TABLE athlete_goals ADD CONSTRAINT athlete_goals_mouvement_fkey
  FOREIGN KEY (categorie, exercise) REFERENCES library_entries (category, name) ON UPDATE CASCADE;

ALTER TABLE athlete_prs ADD CONSTRAINT athlete_prs_mouvement_fkey
  FOREIGN KEY (categorie, movement) REFERENCES library_entries (category, name) ON UPDATE CASCADE;

ALTER TABLE block_objectives ADD CONSTRAINT block_objectives_mouvement_fkey
  FOREIGN KEY (categorie, exercise) REFERENCES library_entries (category, name) ON UPDATE CASCADE;


-- ⚠️ UN INDEX SUR LA COLONNE RÉFÉRENÇANTE, SINON CHAQUE RENOMMAGE BALAIE LA
--    TABLE. `ON UPDATE CASCADE` doit retrouver les lignes à mettre à jour ;
--    sans index, c'est un seq scan de 14 922 lignes par renommage — et
--    Postgres n'en crée PAS automatiquement du côté enfant.
CREATE INDEX IF NOT EXISTS training_exercises_nom_idx        ON training_exercises (categorie, name);
CREATE INDEX IF NOT EXISTS training_sets_nom_idx             ON training_sets (categorie, exercise);
CREATE INDEX IF NOT EXISTS training_base_principles_nom_idx  ON training_base_principles (categorie, name);
CREATE INDEX IF NOT EXISTS training_base_accessories_nom_idx ON training_base_accessories (categorie, name);
CREATE INDEX IF NOT EXISTS athlete_goals_nom_idx             ON athlete_goals (categorie, exercise);
CREATE INDEX IF NOT EXISTS athlete_prs_nom_idx               ON athlete_prs (categorie, movement);
CREATE INDEX IF NOT EXISTS block_objectives_nom_idx          ON block_objectives (categorie, exercise);

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) les huit contraintes sont là (les 7 neuves + celle de FRE-122) :
--    SELECT conrelid::regclass::text AS depuis, conname FROM pg_constraint
--     WHERE contype = 'f' AND confrelid = 'library_entries'::regclass
--     ORDER BY 1;                                          -- → 8 lignes
--
-- b) plus aucune chaîne vide là où la contrainte s'applique :
--    SELECT count(*) FROM training_exercises WHERE btrim(name) = '';   -- → 0
--
-- c) LE GESTE QUI FRACTURAIT — à jouer dans une transaction ANNULÉE, pour voir
--    la cascade sans rien changer :
--
--    BEGIN;
--      UPDATE library_entries SET name = 'SQUAT_TEST'
--       WHERE category = 'exercices' AND name = 'SQUAT';
--      SELECT count(*) FROM training_exercises WHERE name = 'SQUAT_TEST';  -- → 1 788
--      SELECT count(*) FROM athlete_prs        WHERE movement = 'SQUAT_TEST';  -- → 50
--    ROLLBACK;
