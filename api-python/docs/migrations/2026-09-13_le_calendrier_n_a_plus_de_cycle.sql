-- LE CALENDRIER N'A PLUS DE CYCLE (suite de FRE-173).
--
-- Le cycle menstruel vit dans `daily_logs.cycle_phase` depuis
-- `2026-09-12_le_cycle_dans_le_journal.sql`, et le serveur refuse `cycle` et
-- `phase` à l'écriture du calendrier. Il restait en base ce que plus rien ne
-- produit : la colonne `calendar_events.phase`, son CHECK, la valeur `cycle` de
-- l'enum `event_type`, et l'unique événement de ce type. William, 13/09 :
-- « personne n'utilisait » — ce qui ne sert à personne se supprime, il ne se
-- garde pas inerte. Deux endroits où un cycle PEUT exister, c'est deux
-- définitions d'une même notion, même quand l'un est muet.
--
-- ⚠️ L'ÉVÉNEMENT SUPPRIMÉ A DÉJÀ ÉTÉ REPORTÉ. La migration du 12/09 a posé son
-- jour de début dans `daily_logs` ; sa plage de 117 jours n'était pas une
-- déclaration (voir l'en-tête de celle-ci). Rien de déclaré n'est perdu.
--
-- ⚠️ POSTGRES NE SAIT PAS RETIRER UNE VALEUR D'ENUM. On renomme l'ancien type,
-- on crée le nouveau sans `cycle`, on convertit la colonne par le texte, on jette
-- l'ancien. La conversion échouerait s'il restait une ligne `cycle` : le DELETE
-- passe donc AVANT, dans la même transaction.
--
-- `DROP COLUMN phase` emporte le CHECK `phase IS NULL OR type = 'cycle'` : une
-- contrainte qui porte sur une colonne supprimée tombe avec elle, sans avoir à
-- connaître le nom que Postgres lui a donné. Le type `cycle_phase` reste — c'est
-- celui de `daily_logs.cycle_phase`.
--
-- Aucune vue ne lit `calendar_events` (vérifié dans `pg_depend` le 13/09).

BEGIN;

DELETE FROM calendar_events WHERE type = 'cycle';

ALTER TABLE calendar_events DROP COLUMN phase;

ALTER TYPE event_type RENAME TO event_type_avant_le_journal;
CREATE TYPE event_type AS ENUM ('competition', 'vacation', 'travel', 'rest', 'other');
ALTER TABLE calendar_events ALTER COLUMN type TYPE event_type USING type::text::event_type;
DROP TYPE event_type_avant_le_journal;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-13_le_calendrier_n_a_plus_de_cycle.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION :
--   SELECT enum_range(NULL::event_type);                         -- sans cycle
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'calendar_events' AND column_name = 'phase';  -- 0
--   SELECT count(*) FROM daily_logs WHERE cycle_phase IS NOT NULL;    -- inchangé
