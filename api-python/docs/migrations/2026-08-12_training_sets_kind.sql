-- Migration : training_sets — NATURE de la ligne d'exercice (FRE-10).
--
-- CONTEXTE. Les coachs prescrivent désormais des échauffements structurés et le
-- kiné ses propres exercices ; rien ne les distinguait d'une série de travail. Le
-- champ `kind` sur la ligne d'exercice (schemas/week_content.py) le fait :
-- 'training' / 'warmup' / 'rehab'. On le projette dans la table de faits pour que
-- les agrégats du Tracking (tracking.py) n'agrègent que l'entraînement.
--
-- NULL = entraînement (le champ est ABSENT sur les 9 147 lignes existantes et ne
-- sera jamais rétro-écrit — absent vaut 'training'). D'où `text` NULLABLE, sans
-- valeur par défaut : aucune rétro-donnée à écrire.
--
-- ⚠️ tonnage_kg RESTE calculé pour warmup/rehab (un band pull apart à 5 kg déplace
-- 5 kg — écrire 0/NULL consignerait un fait faux). C'est l'AGRÉGATION qui ignore
-- ces lignes (WHERE kind IS DISTINCT FROM 'warmup'/'rehab'), pas la donnée.
--
-- Projection DÉRIVÉE : training_sets est reconstruite par scripts/etl_training_sets.py
-- (DELETE + INSERT), la colonne se remplit au prochain rebuild. Rien ne casse si le
-- rebuild n'a pas encore tourné (colonne NULL = tout compte comme entraînement,
-- exactement l'état actuel).
--
-- ⚠️ ÉTAT D'APPLICATION : PAS ENCORE APPLIQUÉE au 2026-08-12. À jouer sur Neon
-- APRÈS le déploiement du schéma brokkr (kind vérifié dans l'OpenAPI en ligne) et
-- AVANT le prochain rebuild de l'ETL. Non destructive (ADD COLUMN nullable).

BEGIN;

ALTER TABLE training_sets ADD COLUMN kind text;

COMMIT;
