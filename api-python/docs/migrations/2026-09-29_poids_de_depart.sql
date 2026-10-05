-- LE POIDS DE DÉPART D'UN ATHLÈTE (29/09) : le point zéro du suivi de poids
-- vers une pesée. Les athlètes qui se pèsent tous les jours préparent une
-- compétition ; ce qu'ils regardent, c'est l'écart depuis le jour où ils ont
-- commencé, pas la valeur du jour — un Google Sheet tenu à la main le faisait
-- à côté de l'app.
--
-- Une PAIRE, posée ensemble par la route : le poids seul ne dit rien sans la
-- date qui ouvre la semaine 1. `weight_kg` reste le poids courant de la fiche.

BEGIN;

ALTER TABLE athletes
    ADD COLUMN poids_depart_kg numeric CONSTRAINT poids_depart_kg_positif CHECK (poids_depart_kg > 0),
    ADD COLUMN poids_depart_le date,
    ADD CONSTRAINT poids_depart_par_paire CHECK ((poids_depart_kg IS NULL) = (poids_depart_le IS NULL));

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-29_poids_de_depart.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
