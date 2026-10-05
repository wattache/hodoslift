-- UNE PRÉFÉRENCE D'AFFICHAGE PAR PERSONNE (brief progression, 27/09).
--
-- La carte « Progression sur le bloc » se rend de plusieurs façons — courbe,
-- barres, marches, chiffres, une phrase… — et chacun choisit la sienne, en
-- mode athlète et en mode coach. C'est une préférence de la PERSONNE : elle
-- doit la suivre d'un appareil à l'autre, donc elle vit ici et pas dans le
-- navigateur.
--
-- Un jsonb, parce que d'autres réglages du même genre viendront s'y ranger ;
-- la forme est gardée par le contrat (`Preferences`, extra="forbid"), pas par
-- la base. `{}` par défaut : aucune ligne à toucher.

BEGIN;

ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-27_une_preference_d_affichage_par_personne.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
