-- UN PARTICIPANT PASSE DANS UN GROUPE, AVEC UN NUMÉRO DE LOT (FRE-204).
--
-- Les athlètes d'une compétition passent par groupes ; dans un tour, de la
-- charge annoncée la plus légère à la plus lourde, et à charge égale par numéro
-- de lot. Rien ne disait jusqu'ici dans quel groupe passait un participant.
--
-- Deux colonnes facultatives : un participant sans groupe reste valide, le
-- calcul de l'ordre le range à part. Le groupe est saisi à la main (William,
-- 24/09), pas déduit de la catégorie.
--
-- ⚠️ `''` N'EST PAS UN GROUPE : un champ vidé s'écrit NULL (le contrat le
-- convertit), et la base le refuse au cas où une écriture l'oublierait.

BEGIN;

ALTER TABLE competition_participants
    ADD COLUMN groupe text CONSTRAINT competition_participants_groupe_non_vide CHECK (btrim(groupe) <> ''),
    ADD COLUMN lot integer CONSTRAINT competition_participants_lot_positif CHECK (lot > 0);

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-24_un_participant_passe_dans_un_groupe.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
