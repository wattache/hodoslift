-- LE VIDE N'EST PAS UNE VALEUR — lot TIÈDE, et les tables de BASE (FRE-137).
--
-- ⚠️ LE LOT FROID N'A FAIT QUE LA MOITIÉ DU CHEMIN, ET L'INVARIANT NE LE VOYAIT
--    PAS. Il a migré `coach_note` sur `training_exercises` — et laissé les 1 584
--    `coach_note` vides des DEUX TABLES DE BASE, parce que `pas_de_texte_vide`
--    ne comptait qu'une table sur trois. Un vérificateur qui sort vert pour la
--    mauvaise raison est pire que pas de vérificateur : il rassure.
--
--    Relevé le 11/09 après le lot froid : `training_exercises` portait 38 593
--    cases vides, et les tables de BASE 12 119 de plus, invisibles. La vraie
--    dette était de 50 712.
--
-- ⚠️ ET CE N'EST PAS UN OUBLI D'INATTENTION : les trois tables partagent la MÊME
--    liste de champs (`prescription.CHAMPS_PRESCRIPTION`), parce qu'une trame et
--    la semaine qu'elle produit portent la même prescription. Toute règle posée
--    sur l'une et pas sur les autres se rouvrira par la génération.
--
-- ⚠️ UN SEUL ÉCRIVAIN POUR LES TABLES DE BASE : `arbre_creation.inserer_ligne`,
--    qui passe par `prescription.valeur_ligne` depuis le lot 1. Vérifié avant
--    d'écrire le CHECK — aucun `UPDATE` ni `INSERT` direct ailleurs dans `app/`.
--
-- ⚠️ `day` EST `NOT NULL` sur `training_base_accessories` et reste donc en `''` :
--    c'est le seul « rien » que la colonne accepte. `CLES_NON_NULLABLES`
--    l'épargne côté code, et aucun CHECK n'est posé ici.
--
-- AVANT (relevé du 11/09) :
--
--                          exercises   principles   accessories
--   assistance                  5 438          758           897
--   cluster_mode                5 316          730           891
--   cluster_rest                5 478          777           898
--   format                      5 361          747           889
--   tempo                       4 388          594           708
--   increment                     352           44            68
--   coach_note (rattrapage)         0          738           846
--
--   soit 35 918 cases.
--
-- ⚠️ LE COMPTE NE SE RECOPIE PAS DANS UN COMMENTAIRE DE CODE : c'est l'invariant
--    `pas_de_texte_vide` qui porte l'état — élargi aux TROIS tables dans le même
--    commit que cette migration.

BEGIN;

-- Les six colonnes du lot tiède, sur les trois tables.
UPDATE training_exercises SET assistance   = NULL WHERE btrim(assistance) = '';
UPDATE training_exercises SET cluster_mode = NULL WHERE btrim(cluster_mode) = '';
UPDATE training_exercises SET cluster_rest = NULL WHERE btrim(cluster_rest) = '';
UPDATE training_exercises SET format       = NULL WHERE btrim(format) = '';
UPDATE training_exercises SET tempo        = NULL WHERE btrim(tempo) = '';
UPDATE training_exercises SET increment    = NULL WHERE btrim(increment) = '';

UPDATE training_base_principles SET assistance   = NULL WHERE btrim(assistance) = '';
UPDATE training_base_principles SET cluster_mode = NULL WHERE btrim(cluster_mode) = '';
UPDATE training_base_principles SET cluster_rest = NULL WHERE btrim(cluster_rest) = '';
UPDATE training_base_principles SET format       = NULL WHERE btrim(format) = '';
UPDATE training_base_principles SET tempo        = NULL WHERE btrim(tempo) = '';
UPDATE training_base_principles SET increment    = NULL WHERE btrim(increment) = '';
-- Rattrapage du lot froid, que l'invariant aveugle avait laissé passer.
UPDATE training_base_principles SET coach_note   = NULL WHERE btrim(coach_note) = '';

UPDATE training_base_accessories SET assistance   = NULL WHERE btrim(assistance) = '';
UPDATE training_base_accessories SET cluster_mode = NULL WHERE btrim(cluster_mode) = '';
UPDATE training_base_accessories SET cluster_rest = NULL WHERE btrim(cluster_rest) = '';
UPDATE training_base_accessories SET format       = NULL WHERE btrim(format) = '';
UPDATE training_base_accessories SET tempo        = NULL WHERE btrim(tempo) = '';
UPDATE training_base_accessories SET increment    = NULL WHERE btrim(increment) = '';
UPDATE training_base_accessories SET coach_note   = NULL WHERE btrim(coach_note) = '';

ALTER TABLE training_exercises
    ADD CONSTRAINT assistance_non_vide   CHECK (btrim(assistance) <> ''),
    ADD CONSTRAINT cluster_mode_non_vide CHECK (btrim(cluster_mode) <> ''),
    ADD CONSTRAINT cluster_rest_non_vide CHECK (btrim(cluster_rest) <> ''),
    ADD CONSTRAINT format_non_vide       CHECK (btrim(format) <> ''),
    ADD CONSTRAINT tempo_non_vide        CHECK (btrim(tempo) <> ''),
    ADD CONSTRAINT increment_non_vide    CHECK (btrim(increment) <> '');

ALTER TABLE training_base_principles
    ADD CONSTRAINT assistance_non_vide   CHECK (btrim(assistance) <> ''),
    ADD CONSTRAINT cluster_mode_non_vide CHECK (btrim(cluster_mode) <> ''),
    ADD CONSTRAINT cluster_rest_non_vide CHECK (btrim(cluster_rest) <> ''),
    ADD CONSTRAINT format_non_vide       CHECK (btrim(format) <> ''),
    ADD CONSTRAINT tempo_non_vide        CHECK (btrim(tempo) <> ''),
    ADD CONSTRAINT increment_non_vide    CHECK (btrim(increment) <> ''),
    ADD CONSTRAINT coach_note_non_vide   CHECK (btrim(coach_note) <> '');

ALTER TABLE training_base_accessories
    ADD CONSTRAINT assistance_non_vide   CHECK (btrim(assistance) <> ''),
    ADD CONSTRAINT cluster_mode_non_vide CHECK (btrim(cluster_mode) <> ''),
    ADD CONSTRAINT cluster_rest_non_vide CHECK (btrim(cluster_rest) <> ''),
    ADD CONSTRAINT format_non_vide       CHECK (btrim(format) <> ''),
    ADD CONSTRAINT tempo_non_vide        CHECK (btrim(tempo) <> ''),
    ADD CONSTRAINT increment_non_vide    CHECK (btrim(increment) <> ''),
    ADD CONSTRAINT coach_note_non_vide   CHECK (btrim(coach_note) <> '');

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-11_le_vide_n_est_pas_une_valeur_lot_tiede.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION : `make invariants` doit tomber de 50 712 à 14 794.
-- et la base doit REFUSER un retour en arrière, sur chacune des trois tables :
--   UPDATE training_base_accessories SET tempo = ''
--    WHERE id = (SELECT id FROM training_base_accessories LIMIT 1);   -- refusé
--
-- ⚠️ APRÈS AVOIR JOUÉ : surveiller la première GÉNÉRATION DE SEMAINE. C'est le
--    geste qui traverse `inserer_ligne` sur les trois tables, et le seul qui
--    éprouve vraiment le lot 1 — la saisie quotidienne ne le traverse pas.
