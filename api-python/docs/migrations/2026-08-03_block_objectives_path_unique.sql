-- Migration : corriger l'unicité de block_objectives (chemin complet, pas block_id).
--
-- BUG. La table portait UNIQUE (block_id, position), ce qui SUPPOSE qu'un id de bloc
-- Firestore est globalement unique. Il ne l'est PAS : sur 109 chemins de blocs, seuls
-- 106 ids sont distincts — 3 ids apparaissent sous DEUX programmes (un programme a été
-- dupliqué en recopiant les documents AVEC leurs ids ; le macro parent porte lui aussi
-- le même id). Conséquences : à l'ETL, ON CONFLICT (block_id, position) a écrasé un
-- bloc par son homonyme (18 objectifs → 15 insérés) ; au PUT, l'INSERT aux positions
-- 0..n entrait en collision avec les lignes de l'AUTRE programme → IntegrityError / 500,
-- bloc non enregistrable pour l'un des deux athlètes.
--
-- CORRECTIF. L'identité d'un objectif est son CHEMIN complet : (program_id, macro_id,
-- block_id, position). On remplace la contrainte, et l'index (block_id) par
-- (program_id, block_id) : toutes les requêtes (lecture /training, DELETE du PUT,
-- cascades) filtrent déjà sur program_id, aucune n'interroge block_id seul.
--
-- Non destructif : aucune ligne existante ne viole la nouvelle contrainte (elle est
-- PLUS permissive — un sur-ensemble de colonnes). L'ETL rejoué APRÈS cette migration
-- récupère les 3 objectifs perdus (18 lignes attendues).

BEGIN;

ALTER TABLE block_objectives DROP CONSTRAINT block_objectives_block_id_position_key;
ALTER TABLE block_objectives
    ADD CONSTRAINT block_objectives_path_key
    UNIQUE (program_id, macro_id, block_id, position);

DROP INDEX block_objectives_block_id_idx;
CREATE INDEX ON block_objectives (program_id, block_id);

COMMIT;
