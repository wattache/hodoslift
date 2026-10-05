-- FRE-127 — archiver un athlète qui suspend le coaching.
--
-- ⚠️ À JOUER AVANT DE DÉPLOYER brokkr : la lecture de `/athletes/mine` sélectionne
--    la colonne, et c'est l'écran d'accueil du coach. La base doit OFFRIR avant
--    que le code ne demande.
--
-- ⚠️ AUCUNE REPRISE : NULL veut dire « actif », et c'est la valeur de départ des
--    69 athlètes. Personne ne se retrouve archivé par la migration.
--
-- Mesuré le 03/09 avant d'écrire : 38 athlètes actifs (une séance dans les 30
-- jours), 25 sans AUCUNE séance datée, et ZÉRO inactif depuis plus de 90 jours.
-- Ce dernier chiffre est la raison pour laquelle l'archivage est un GESTE et non
-- un seuil : aucune règle automatique n'aurait rien rangé, et elle aurait fini
-- par archiver quelqu'un en vacances.

BEGIN;

ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS archive_le timestamptz;

COMMIT;

-- ⚠️ PAS D'INDEX. La liste d'un coach tient en quelques dizaines de lignes et se
-- lit déjà en entier ; filtrer sur cette colonne ne demande pas d'aide. Un index
-- ici coûterait à chaque écriture pour une lecture qui ne le remarquerait pas.
