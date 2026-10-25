-- Un objectif de bloc porte les OPTIONS de son format et son tempo (FRE-252) :
-- un objectif posé depuis une ligne de BASE la reprend en entier, et « EMOM »
-- seul ne disait ni la durée ni le rythme. Colonnes nullables : un objectif
-- sans format n'a pas d'options.
BEGIN;

ALTER TABLE block_objectives
  ADD COLUMN cluster_mode text,
  ADD COLUMN cluster_rest text,
  ADD COLUMN tempo        text;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-25_options_du_format_d_un_objectif.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
