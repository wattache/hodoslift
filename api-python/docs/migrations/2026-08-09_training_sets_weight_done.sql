-- Migration : training_sets — charge RÉALISÉE dans sa propre colonne (FRE-18).
--
-- CONTEXTE. La charge était la seule paire prescrit/réalisé à n'avoir qu'un champ
-- (weight), quand reps/repsDone, rest/restActual, aimedRPE/feltRPE en ont deux. Le
-- front ajoute weightDone ; côté projection analytics, on stocke la charge réelle à
-- part — exactement comme reps_done cohabite avec reps. weight_kg reste la
-- PRESCRIPTION ; les métriques (tonnage) se dérivent de la charge EFFECTIVE.
--
-- Projection DÉRIVÉE : training_sets est reconstruite par scripts/etl_training_sets.py
-- (TRUNCATE + INSERT), la colonne se remplit au prochain rebuild. Nullable, aucune
-- rétro-donnée à écrire, rien ne casse si le rebuild n'a pas encore tourné.
--
-- ⚠️ ÉTAT D'APPLICATION : APPLIQUÉE SUR NEON le 2026-08-09, après le déploiement
-- du schéma brokkr (weightDone vérifié dans l'OpenAPI en ligne) et AVANT tout
-- rebuild. Vérifié dans la foulée : colonne numeric nullable, 9 164 lignes
-- inchangées, 0 valeur non-NULL (normal, l'ETL n'a pas encore été rejoué).
-- Ré-exécuter tel quel lèverait « column already exists » : ce fichier reste la
-- trace canonique du DDL, pour un environnement neuf.
--
-- Le rebuild n'est PAS urgent : personne n'avait encore saisi de charge réelle au
-- moment de la migration, et l'ETL reconstruit la table entièrement depuis
-- Firestore — un seul passage ultérieur ramassera tout l'historique.

BEGIN;

ALTER TABLE training_sets ADD COLUMN weight_done_kg numeric;

COMMIT;
