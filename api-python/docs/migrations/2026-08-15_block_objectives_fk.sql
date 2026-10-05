-- Migration : `block_objectives` rejoint l'arbre par une VRAIE clé étrangère (FRE-12).
--
-- CONTEXTE. Cette table a été créée le 2026-08-03, quand l'arbre d'entraînement
-- vivait encore dans Firestore. Elle référençait donc le bloc par son id
-- documentaire, en `text`, sans table en face — et son propre commentaire
-- l'annonçait : « quand macro/bloc migreront, block_id deviendra une FK par un
-- simple ALTER ». Nous y sommes.
--
-- POURQUOI MAINTENANT, ET PAS APRÈS LA BASCULE. Le front envoie désormais des
-- uuid : sans cette migration, il écrirait des objectifs que la lecture ne
-- retrouverait pas, puisqu'elle joint sur `legacy_id`. Le défaut serait SILENCIEUX
-- — un objectif enregistré, et simplement absent à l'affichage.
--
-- CE QUE ÇA SUPPRIME AU PASSAGE. La jointure de lecture passait par
-- `training_blocks.legacy_id`, en portant AUSSI le programme et le macro, parce
-- qu'un id Firestore n'est pas unique entre programmes (un programme a été
-- dupliqué avec les ids de ses documents). Trois conditions pour désigner un
-- bloc ; il n'en reste qu'une, et elle est garantie par la base.
--
-- ⚠️ ORDRE : APRÈS le chargement de l'arbre (`etl_training_tree.py --apply`),
-- puisqu'on résout les anciens ids contre `training_blocks`. Les objectifs dont
-- le bloc n'a pas d'équivalent — s'il en existe — seraient orphelins : la
-- migration REFUSE de s'appliquer dans ce cas plutôt que de les perdre.

BEGIN;

-- 1. Colonne cible, résolue depuis l'ancien couple (programme, id documentaire).
ALTER TABLE block_objectives ADD COLUMN block_uuid uuid;

UPDATE block_objectives o
SET block_uuid = b.id
FROM training_blocks b
JOIN training_macros m ON m.id = b.macro_id
WHERE b.legacy_id = o.block_id
  AND m.legacy_id = o.macro_id
  AND m.program_id = o.program_id;

-- 2. Garde-fou : on ne perd aucun objectif en silence.
DO $$
DECLARE orphelins integer;
BEGIN
    SELECT count(*) INTO orphelins FROM block_objectives WHERE block_uuid IS NULL;
    IF orphelins > 0 THEN
        RAISE EXCEPTION 'ARRÊT : % objectif(s) sans bloc correspondant. '
            'L''arbre a-t-il bien été chargé (etl_training_tree --apply) ?', orphelins;
    END IF;
END $$;

-- 3. Bascule. `program_id` et `macro_id` disparaissent : le bloc les porte déjà,
--    et les garder inviterait à les croire faisant autorité.
ALTER TABLE block_objectives
    DROP CONSTRAINT IF EXISTS block_objectives_program_id_macro_id_block_id_position_key,
    DROP COLUMN macro_id,
    DROP COLUMN block_id,
    DROP COLUMN program_id;

ALTER TABLE block_objectives RENAME COLUMN block_uuid TO block_id;

ALTER TABLE block_objectives
    ALTER COLUMN block_id SET NOT NULL,
    ADD CONSTRAINT block_objectives_block_fkey
        FOREIGN KEY (block_id) REFERENCES training_blocks(id) ON DELETE CASCADE,
    ADD CONSTRAINT block_objectives_block_position_key UNIQUE (block_id, position);

CREATE INDEX ON block_objectives (block_id);

COMMIT;
