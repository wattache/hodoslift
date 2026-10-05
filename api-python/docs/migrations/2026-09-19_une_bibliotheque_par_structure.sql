-- UNE BIBLIOTHÈQUE PAR STRUCTURE (FRE-13, suite). Demandé par William le 19/09.
--
-- La bibliothèque était « tout partagé, unique par nom » : une seule structure.
-- À trois, un coach SCAPPULIFT qui crée ou renomme une entrée ne doit toucher que
-- la sienne. L'existant (French Forge) est COPIÉ pour SCAPPULIFT et ElGustoLift :
-- chacune part du même référentiel, puis vit sa vie.
--
-- ⚠️ LES CLÉS ÉTRANGÈRES RESTENT, AVEC LA STRUCTURE DEDANS (FRE-123). Huit
-- colonnes portent un nom de mouvement qui référence la bibliothèque, et un
-- renommage s'y propage par `ON UPDATE CASCADE` — sans ces contraintes, un
-- renommage avait orphelin 4 125 lignes en silence. Dès que « SQUAT » existe
-- trois fois, une ligne doit dire LEQUEL : la clé devient
-- `(structure, categorie, nom)`, et chaque table porte une colonne `structure`.
-- Un renommage chez French Forge ne se propage donc qu'aux lignes French Forge.
--
-- ⚠️ CETTE COLONNE, C'EST LA BASE QUI LA POSE (`ff_pose_la_structure`), pas
-- l'application. Une vingtaine de chemins insèrent des lignes (génération,
-- duplication, recopie, projection nocturne…) : en oublier un rangerait une
-- ligne SCAPPULIFT dans la bibliothèque French Forge, et la clé étrangère
-- l'accepterait puisque les noms y sont les mêmes. Le trigger lit la structure
-- de l'ATHLÈTE, à l'insertion et quand la ligne change de parent : il n'y a pas
-- de chemin qui l'oublie. Premier trigger du projet — `verifier_schema` compare
-- désormais fonctions et triggers, sinon une base qui l'aurait perdu passerait.
--
-- ⚠️ UN ATHLÈTE QUI CHANGE DE STRUCTURE N'EST PAS PRIS EN CHARGE (décision du
-- 19/09, « tant pis ») : ses lignes gardent l'ancienne structure, que
-- l'invariant `lignes_dans_la_structure_de_l_athlete` signalera.

BEGIN;

-- 1. La bibliothèque porte sa structure, et le nom est unique DANS la structure.
ALTER TABLE library_entries
  ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);

ALTER TABLE athlete_goals             DROP CONSTRAINT athlete_goals_mouvement_fkey;
ALTER TABLE athlete_prs               DROP CONSTRAINT athlete_prs_mouvement_fkey;
ALTER TABLE block_objectives          DROP CONSTRAINT block_objectives_mouvement_fkey;
ALTER TABLE objectifs_techniques      DROP CONSTRAINT objectifs_techniques_categorie_mouvement_fkey;
ALTER TABLE training_base_accessories DROP CONSTRAINT training_base_accessories_mouvement_fkey;
ALTER TABLE training_base_principles  DROP CONSTRAINT training_base_principles_mouvement_fkey;
ALTER TABLE training_exercises        DROP CONSTRAINT training_exercises_mouvement_fkey;
ALTER TABLE training_sets             DROP CONSTRAINT training_sets_mouvement_fkey;

ALTER TABLE library_entries DROP CONSTRAINT library_entries_category_name_key;
ALTER TABLE library_entries ADD CONSTRAINT library_entries_structure_category_name_key
  UNIQUE (structure, category, name);

-- 2. La copie : chaque autre structure part du référentiel French Forge.
INSERT INTO library_entries (structure, category, name, competition, supports, created_by, created_at)
SELECT s.slug, l.category, l.name, l.competition, l.supports, l.created_by, l.created_at
  FROM library_entries l CROSS JOIN structures s
 WHERE l.structure = 'french-forge' AND s.slug <> 'french-forge'
ON CONFLICT (structure, category, name) DO NOTHING;

-- 3. La structure d'une ligne, lue sur son athlète.
CREATE FUNCTION ff_pose_la_structure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF TG_TABLE_NAME = 'training_exercises' THEN
    SELECT a.structure INTO s
      FROM training_sessions se JOIN training_weeks w ON w.id = se.week_id
      JOIN training_blocks b ON b.id = w.block_id JOIN training_macros m ON m.id = b.macro_id
      JOIN programs p ON p.id = m.program_id JOIN athletes a ON a.id = p.athlete_id
     WHERE se.id = NEW.session_id;
  ELSIF TG_TABLE_NAME IN ('training_base_principles', 'training_base_accessories', 'block_objectives') THEN
    SELECT a.structure INTO s
      FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id
      JOIN programs p ON p.id = m.program_id JOIN athletes a ON a.id = p.athlete_id
     WHERE b.id = NEW.block_id;
  ELSIF TG_TABLE_NAME IN ('athlete_goals', 'athlete_prs', 'objectifs_techniques') THEN
    SELECT a.structure INTO s FROM athletes a WHERE a.id = NEW.athlete_id;
  ELSIF TG_TABLE_NAME = 'training_sets' THEN
    SELECT a.structure INTO s FROM athletes a WHERE a.legacy_id = NEW.athlete_id;
  END IF;
  -- Un parent introuvable garde la valeur reçue : la clé étrangère du parent
  -- refusera la ligne elle-même, avec un message qui dit la vraie cause.
  NEW.structure := coalesce(s, NEW.structure);
  RETURN NEW;
END $$;

-- 4. La colonne, puis le rattrapage (seules les lignes hors French Forge bougent),
--    puis le trigger, puis la clé.
ALTER TABLE training_exercises        ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE training_sets             ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE training_base_principles  ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE training_base_accessories ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE block_objectives          ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE athlete_goals             ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE athlete_prs               ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE objectifs_techniques      ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);

UPDATE training_exercises e SET structure = a.structure
  FROM training_sessions se, training_weeks w, training_blocks b, training_macros m, programs p, athletes a
 WHERE se.id = e.session_id AND w.id = se.week_id AND b.id = w.block_id AND m.id = b.macro_id
   AND p.id = m.program_id AND a.id = p.athlete_id AND a.structure <> 'french-forge';
UPDATE training_base_principles x SET structure = a.structure
  FROM training_blocks b, training_macros m, programs p, athletes a
 WHERE b.id = x.block_id AND m.id = b.macro_id AND p.id = m.program_id AND a.id = p.athlete_id
   AND a.structure <> 'french-forge';
UPDATE training_base_accessories x SET structure = a.structure
  FROM training_blocks b, training_macros m, programs p, athletes a
 WHERE b.id = x.block_id AND m.id = b.macro_id AND p.id = m.program_id AND a.id = p.athlete_id
   AND a.structure <> 'french-forge';
UPDATE block_objectives x SET structure = a.structure
  FROM training_blocks b, training_macros m, programs p, athletes a
 WHERE b.id = x.block_id AND m.id = b.macro_id AND p.id = m.program_id AND a.id = p.athlete_id
   AND a.structure <> 'french-forge';
UPDATE athlete_goals x SET structure = a.structure FROM athletes a
 WHERE a.id = x.athlete_id AND a.structure <> 'french-forge';
UPDATE athlete_prs x SET structure = a.structure FROM athletes a
 WHERE a.id = x.athlete_id AND a.structure <> 'french-forge';
UPDATE objectifs_techniques x SET structure = a.structure FROM athletes a
 WHERE a.id = x.athlete_id AND a.structure <> 'french-forge';
UPDATE training_sets x SET structure = a.structure FROM athletes a
 WHERE a.legacy_id = x.athlete_id AND a.structure <> 'french-forge';

CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF session_id ON training_exercises
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF block_id ON training_base_principles
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF block_id ON training_base_accessories
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF block_id ON block_objectives
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF athlete_id ON athlete_goals
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF athlete_id ON athlete_prs
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF athlete_id ON objectifs_techniques
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF athlete_id ON training_sets
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();

ALTER TABLE training_exercises ADD CONSTRAINT training_exercises_mouvement_fkey
  FOREIGN KEY (structure, categorie, name) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE training_sets ADD CONSTRAINT training_sets_mouvement_fkey
  FOREIGN KEY (structure, categorie, exercise) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE training_base_principles ADD CONSTRAINT training_base_principles_mouvement_fkey
  FOREIGN KEY (structure, categorie, name) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE training_base_accessories ADD CONSTRAINT training_base_accessories_mouvement_fkey
  FOREIGN KEY (structure, categorie, name) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE block_objectives ADD CONSTRAINT block_objectives_mouvement_fkey
  FOREIGN KEY (structure, categorie, exercise) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE athlete_goals ADD CONSTRAINT athlete_goals_mouvement_fkey
  FOREIGN KEY (structure, categorie, exercise) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE athlete_prs ADD CONSTRAINT athlete_prs_mouvement_fkey
  FOREIGN KEY (structure, categorie, movement) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE objectifs_techniques ADD CONSTRAINT objectifs_techniques_mouvement_fkey
  FOREIGN KEY (structure, categorie, mouvement) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-19_une_bibliotheque_par_structure.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
