-- Les OBJECTIFS DE BLOC se cochent.
--
-- ⚠️ À JOUER AVANT DE DÉPLOYER brokkr : la lecture de l'arbre sélectionne la
--    colonne, et sans elle `GET /training` répond 500 — l'écran d'entraînement
--    entier. La base doit OFFRIR avant que le code ne demande.
--
-- ⚠️ AUCUNE REPRISE : les 22 objectifs de bloc existants (sur 9 blocs) sortent
--    NULL, c'est-à-dire « pas atteint », ce qui est exact.
--
-- Une DATE et non un booléen, pour le même coût : `athlete_goals.achieved_on`
-- existe déjà et l'app dit « Atteint le… ». Un troisième vocabulaire pour la
-- même idée se paierait à chaque lecture de code.
--
-- ⚠️ CE N'EST PAS DU SUIVI (décision de William, 02/09) : « c'est une
--    satisfaction, c'est pédagogique. Pas pour du tracking : le tableau des PR
--    le fait. » D'où une coche, et pas un « réalisé » en face du prescrit.
--
-- Après application : `make schema-verifier` doit rester vert.

BEGIN;

ALTER TABLE block_objectives
  ADD COLUMN IF NOT EXISTS atteint_le date;

COMMIT;
