-- `library_entries.created_by` cesse de retenir un coach (FRE-24).
--
-- ⚠️ CE N'EST PAS UN CHANGEMENT DE MODÈLE, C'EST UN RATTRAPAGE. `docs/postgres-
-- schema.sql` — la source du schéma, celle qu'appliquent les tests — déclare
-- DÉJÀ `ON DELETE SET NULL` sur cette colonne. Seule la production est restée en
-- `NO ACTION`.
--
-- Les deux avaient donc divergé, et c'est ce qui explique que personne ne l'ait
-- vu : les tests tournent sur le fichier, donc dans un monde où la bibliothèque
-- ne retient pas, pendant qu'en production elle retenait. Comparaison faite sur
-- les 31 clés étrangères du fichier : c'est le SEUL écart.
--
-- ⚠️ POURQUOI CE N'EST PAS UN ASSOUPLISSEMENT DE CONFORT. Depuis la refonte de la
-- bibliothèque, TOUTE entrée est partagée : il n'y a plus de bibliothèque privée,
-- plus de propriétaire. `created_by` n'est donc plus qu'une trace d'auteur — et
-- vérification faite, elle est ÉCRITE ET JAMAIS LUE : absente du modèle de
-- lecture, absente du contrat front, jamais consultée pour autoriser quoi que ce
-- soit.
--
-- Or elle est en `NO ACTION`, donc elle BLOQUE la rétrogradation de son auteur.
-- Quatre coachs sont aujourd'hui retenus par ce seul lien — l'un d'eux par 81
-- entrées. Le cas réel du 11/08 en est venu : un compte qui ne coachait plus
-- personne, impossible à rétrograder, et un message qui envoyait chercher du
-- côté des athlètes.
--
-- Une trace d'audit que personne ne lit n'a pas à empêcher un départ. `SET NULL`
-- la laisse s'effacer avec le compte, ce qui est exactement ce qu'elle vaut : 32
-- des 236 entrées sont d'ailleurs DÉJÀ à NULL depuis l'import du 09/08, et rien
-- ne s'en porte plus mal.
--
-- ⚠️ ORDRE : cette migration peut être jouée avant OU après le déploiement.
-- Jouée après, une rétrogradation bloquée par la bibliothèque tomberait sur le
-- filet `IntegrityError` — message générique mais honnête, jamais une erreur
-- muette.

BEGIN;

ALTER TABLE library_entries
  DROP CONSTRAINT IF EXISTS library_entries_created_by_fkey;

ALTER TABLE library_entries
  ADD CONSTRAINT library_entries_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES coaches (uid) ON DELETE SET NULL;

COMMIT;

-- Vérification : la contrainte doit ressortir en `SET NULL`, et les trois autres
-- références bloquantes rester inchangées.
--
--   SELECT c.conrelid::regclass::text AS "table", a.attname AS colonne,
--          CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
--               WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' END AS "on delete"
--   FROM pg_constraint c
--   JOIN unnest(c.conkey) k ON true
--   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
--   WHERE c.contype = 'f' AND c.confrelid = 'coaches'::regclass
--   ORDER BY 1;
