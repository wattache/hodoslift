-- Migration : création de block_objectives (objectifs de bloc, Firestore → Postgres).
--
-- ⚠️ DÉJÀ APPLIQUÉE SUR NEON (constaté le 2026-08-03) : la table existe, vide, avec
-- EXACTEMENT ce schéma (colonnes, FK program_id, PK id, UNIQUE (block_id, position),
-- index block_id — vérifié par introspection). Ré-exécuter tel quel lèverait
-- « relation already exists ». Ce fichier reste la trace canonique du DDL (schéma de
-- référence, environnements neufs). Sur un environnement où la table manque, jouer
-- ce script ; sur Neon, il n'y a rien à faire — passer directement à l'ETL.
--
-- Table NEUVE (aucune donnée live à transformer) : l'ETL
-- scripts/etl_block_objectives.py chargera ensuite les 18 objectifs existants
-- (dé-dupliqués : ils étaient recopiés sur chaque semaine du bloc).
--
-- program_id a une VRAIE FK (programs.id = id Firestore du programme, PK text).
-- macro_id / block_id sont des ids Firestore sans table en face tant que l'arbre
-- d'entraînement n'a pas migré — même motif que training_sets.program_id. Le jour
-- où bloc migrera, block_id deviendra une FK par un simple ALTER.
--
-- gen_random_uuid() est natif en PG13+ (Neon PG16).

BEGIN;

CREATE TABLE block_objectives (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    macro_id   text NOT NULL,
    block_id   text NOT NULL,
    position   integer NOT NULL,
    exercise   text,
    variant    text,
    format     text,
    sets       text,
    reps       text,
    weight_min text,
    weight_max text,
    assistance text,
    UNIQUE (block_id, position)
);
CREATE INDEX ON block_objectives (block_id);

COMMIT;
