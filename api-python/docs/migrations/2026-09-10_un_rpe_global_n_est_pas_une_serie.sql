-- UN RPE GLOBAL N'EST PAS UNE SAISIE PAR SÉRIE.
--
-- ⚠️ LA CARTE DE L'ATHLÈTE ÉCRIVAIT TOUJOURS PAR SÉRIE, même pli fermé. Ses
--    boutons de RPE appelaient `onUpdateSetRPE(i, serieActive, valeur)` sans
--    jamais regarder si le pli était ouvert — la série active valant 1 par
--    défaut. Taper un ressenti sur une ligne à quatre séries, sans avoir vu une
--    seule pastille, écrivait donc `felt_rpe_by_set = {'8'}`.
--
--    Personne ne le voyait : le serveur dérive `felt_rpe` de ce tableau, et la
--    moyenne d'un seul élément vaut cet élément. Les deux colonnes disaient la
--    même chose, et tous les écrans lisent le scalaire.
--
--    Jusqu'au badge « n/N » de FRE-156, qui lit un tableau non vide comme un pli
--    OUVERT : `{'8'}` sur quatre séries se lisait « 1/4 rempli ». Signalé le
--    10/09 — 7 255 lignes sur les 13 475 à plusieurs séries portaient un badge.
--
--    Reps et charge n'ont pas le défaut : leurs champs testaient DÉJÀ le pli
--    avant d'écrire. C'est l'asymétrie qui se chiffre — 8 539 lignes ont un
--    tableau de RPE, 54 un tableau de répétitions.
--
-- CE QUE FAIT CETTE MIGRATION : remettre au global les lignes dont le tableau
-- n'est qu'un scalaire déguisé, c'est-à-dire UN élément, non vide, ÉGAL au
-- scalaire déjà stocké. Mesuré le 10/09 : 4 953 lignes, et le scalaire vaut
-- l'unique élément dans les 4 953 — aucune ne perd d'information.
--
-- ⚠️ SAUF `FAIL`, ET C'EST LA SEULE EXCEPTION QUI COMPTE. 75 de ces lignes
--    portent `{'FAIL'}`. `ff_series_tenues` ne compte les séries tenues à partir
--    du tableau QUE s'il contient un FAIL — vidé, il retomberait sur « toutes
--    les séries prescrites ont été tenues ». On transformerait un échec en
--    séance pleine, et le tonnage suivrait. Elles restent telles quelles ; le
--    badge les concerne à peine (leur pli est légitimement ouvert).
--
-- ÉPROUVÉE DANS UNE TRANSACTION ANNULÉE, ligne à ligne, sur les 4 878 restantes :
--   séries tenues qui changent ........ 0
--   `felt_rpe` qui change ............. 0
--   lignes encore marquées « faite » .. 4 878 / 4 878
-- Le suivi ne bouge pas. Seul le badge du front cesse de mentir.

BEGIN;

UPDATE training_exercises
   SET felt_rpe_by_set = NULL
 WHERE cardinality(felt_rpe_by_set) = 1
   AND btrim(felt_rpe_by_set[1]) <> ''
   AND felt_rpe = felt_rpe_by_set[1]
   AND upper(btrim(felt_rpe_by_set[1])) <> 'FAIL';

-- ⚠️ ET « PAS DE DÉTAIL » CESSE D'AVOIR DEUX ÉCRITURES. `NULL` (jamais touché)
--    et `{}` (saisie effacée) disaient la même chose et ne se lisaient pas
--    pareil : `_SERIES_PAR_LIFT_SQL` marque une ligne « faite » sur
--    `felt_rpe_by_set IS NOT NULL`, ce qu'un tableau vide satisfait. Mesuré le
--    10/09 : 102 lignes sans le moindre ressenti étaient comptées faites.
--    L'écriture est normalisée côté serveur ; ces 102-là sont rattrapées ici.

UPDATE training_exercises SET felt_rpe_by_set    = NULL WHERE felt_rpe_by_set    = '{}';
UPDATE training_exercises SET reps_done_by_set   = NULL WHERE reps_done_by_set   = '{}';
UPDATE training_exercises SET weight_done_by_set = NULL WHERE weight_done_by_set = '{}';

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-10_un_rpe_global_n_est_pas_une_serie.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATIONS, à jouer après le COMMIT :
--
--   -- plus aucun tableau d'un seul élément qui ne fait que répéter le scalaire
--   SELECT count(*) FROM training_exercises
--    WHERE cardinality(felt_rpe_by_set) = 1
--      AND felt_rpe = felt_rpe_by_set[1]
--      AND upper(btrim(felt_rpe_by_set[1])) <> 'FAIL';        -- attendu : 0
--
--   -- les FAIL sont restés
--   SELECT count(*) FROM training_exercises
--    WHERE cardinality(felt_rpe_by_set) = 1
--      AND upper(btrim(felt_rpe_by_set[1])) = 'FAIL';         -- attendu : 75
--
--   -- et personne n'a perdu son ressenti
--   SELECT count(*) FROM training_exercises
--    WHERE felt_rpe_by_set IS NULL AND nullif(btrim(felt_rpe), '') IS NOT NULL;
