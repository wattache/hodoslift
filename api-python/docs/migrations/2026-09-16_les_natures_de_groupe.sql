-- LES NATURES DE GROUPE (FRE-116) : circuit, set sur barre, EMOM et AMRAP en
-- rotation, et les tours réalisés d'un AMRAP.
--
-- Un groupe savait être un bi-set ou un dropset. Les programmes d'endurance
-- musculaire en demandent quatre de plus, et deux d'entre elles portent un TEMPS
-- qui appartient au groupe, pas à la ligne : l'intervalle d'un EMOM en rotation,
-- la durée d'un AMRAP. Faute de mieux, ce temps s'écrivait sur CHAQUE ligne, et
-- se lisait « 5' de squats, PUIS 5' de pompes » (le bi-set de Laura, 04-05/2026).
--
-- ⚠️ ON ÉLARGIT, ON NE REPREND RIEN. Aucune ligne existante ne change de nature :
-- les bi-sets et dropsets gardent leurs règles, et les 392 EMOM d'UN mouvement
-- restent un format de ligne. Remplacer le CHECK suffit ; son nom est celui que
-- Postgres a donné à la contrainte en ligne (`<table>_group_kind_check`).
--
-- ⚠️ `tours_realises` EST DU RÉALISÉ, et il appartient au GROUPE AMRAP : la
-- colonne est par ligne comme `sets`, et c'est brokkr qui l'aligne sur tout le
-- groupe (`prescription.champs_de_groupe`). Absent des tables de BASE : une trame
-- n'est réalisée par personne.
--
-- ⚠️ `>= 0` ET NON `> 0` : zéro tour complet est un résultat — on a commencé, on
-- n'a pas bouclé. L'absence de saisie, elle, est NULL.

BEGIN;

ALTER TABLE training_exercises DROP CONSTRAINT training_exercises_group_kind_check;
ALTER TABLE training_exercises ADD CONSTRAINT training_exercises_group_kind_check
  CHECK (group_kind IN ('biset', 'dropset', 'circuit', 'set_barre', 'emom', 'amrap'));

ALTER TABLE training_base_accessories DROP CONSTRAINT training_base_accessories_group_kind_check;
ALTER TABLE training_base_accessories ADD CONSTRAINT training_base_accessories_group_kind_check
  CHECK (group_kind IN ('biset', 'dropset', 'circuit', 'set_barre', 'emom', 'amrap'));

ALTER TABLE training_exercises
  ADD COLUMN tours_realises integer CHECK (tours_realises >= 0);

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-16_les_natures_de_groupe.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
