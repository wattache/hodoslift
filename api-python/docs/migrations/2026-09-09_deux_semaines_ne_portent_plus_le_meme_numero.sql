-- DEUX ENFANTS D'UN MÊME PARENT NE PORTENT PLUS LE MÊME NUMÉRO (FRE-134).
--
-- ⚠️ LE DOUBLON ÉTAIT MUET, ET C'EST TOUT LE PROBLÈME. `prochain_numero` rend
--    `max(number) + 1` : deux créations simultanées — un double clic, deux
--    onglets, un rejeu de la file hors ligne — lisent le même maximum et
--    insèrent deux fois le même numéro, sans que rien ne le dise. Le Tracking
--    fusionne ensuite sur `(week_number, session_index)`.
--
--    C'est la cause de FRE-59, dont on n'avait corrigé que les effets.
--
-- ⚠️ LES SÉANCES ET LES LIGNES ÉTAIENT DÉJÀ GARDÉES, elles, par un
--    `UNIQUE (week_id, position) DEFERRABLE` : le second commit échoue
--    bruyamment. C'est la même forme qu'on pose ici, un niveau au-dessus — trois
--    tables l'avaient, trois ne l'avaient pas, et rien ne justifiait l'écart.
--
-- ⚠️ `DEFERRABLE INITIALLY IMMEDIATE`, ET LES DEUX MOTS COMPTENT.
--
--    IMMEDIATE : la violation doit surgir à l'INSERT, pas au COMMIT. C'est ce
--    qui permet à `prochain_numero` de RÉESSAYER dans un point de reprise —
--    différée, l'erreur arriverait après coup, quand il est trop tard pour
--    recalculer quoi que ce soit.
--
--    DEFERRABLE : `_recompacter` renumérote 1..n d'un seul `UPDATE`. Fermer le
--    trou de 2,3 vers 1,2 descend une ligne sur un numéro que l'autre porte
--    encore ; une contrainte ORDINAIRE, vérifiée ligne par ligne, refuserait ce
--    geste légitime — on transformerait une garde en panne.
--
--    ⚠️ ET `DEFERRABLE` SUFFIT, SANS `SET CONSTRAINTS`. Le mot change la
--    GRANULARITÉ du contrôle : déférable, la contrainte est vérifiée en fin
--    d'INSTRUCTION même en mode `IMMEDIATE`. Vérifié dans les deux sens sur un
--    bac à sable (09/09) : une contrainte nue refuse `number = number + 1`, la
--    même en `DEFERRABLE` l'accepte. Le report explicite qu'on avait écrit dans
--    `_recompacter` ne servait à rien, et la mutation l'a montré.
--
-- Mesuré avant de poser : ZÉRO doublon sur les trois niveaux (09/09). La
-- contrainte ne reprend rien, elle ferme une porte.

BEGIN;

ALTER TABLE training_macros
  ADD CONSTRAINT training_macros_program_number_unique
  UNIQUE (program_id, number) DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE training_blocks
  ADD CONSTRAINT training_blocks_macro_number_unique
  UNIQUE (macro_id, number) DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE training_weeks
  ADD CONSTRAINT training_weeks_block_number_unique
  UNIQUE (block_id, number) DEFERRABLE INITIALLY IMMEDIATE;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-09_deux_semaines_ne_portent_plus_le_meme_numero.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION :
--   SELECT count(*) FROM (SELECT block_id, number FROM training_weeks
--                          GROUP BY 1,2 HAVING count(*) > 1) d;   -- attendu : 0
-- et la contrainte doit REFUSER un doublon fabriqué :
--   INSERT INTO training_weeks (block_id, legacy_id, number)
--   SELECT block_id, 'doublon-test', number FROM training_weeks LIMIT 1;  -- refusé
