-- LE CYCLE MENSTRUEL QUITTE LE CALENDRIER POUR LE JOURNAL (FRE-173).
--
-- Une phase de cycle est un FAIT DU JOUR, comme une pesée — pas un événement
-- daté de `start_date` à `end_date`. `daily_logs` a pour clé (athlète, jour) :
-- c'est exactement le grain de la donnée, et celui du poids, du sommeil, de
-- l'eau. Le calendrier, lui, invitait une PLAGE.
--
-- Mesuré en production le 12/09 (lecture seule) : UNE entrée de type `cycle`
-- dans toute la base, sur 1 fiche sur 71 — et elle couvre 117 jours (25/05 →
-- 18/09). Aucune menstruation ne dure 117 jours : la seule fois où quelqu'un
-- s'est servi de la fonctionnalité, la forme l'a conduit à écrire quelque chose
-- qui n'a pas de sens. C'est le patron qui est faux, pas la saisie.
--
-- ⚠️ UNE COLONNE À ELLE, PAS DANS LE jsonb `kine`. `_SIGNALEMENTS_SQL` et la
-- file du guichet sélectionnent sur `kine IS NOT NULL` : ranger le cycle là
-- remplirait l'écran « qui va mal en ce moment ? » de déclarations de règles.
-- Le type `cycle_phase` existe déjà (menstruation, follicular, ovulation,
-- luteal) : il se réutilise, il ne se recrée pas.
--
-- ⚠️ CE QUE LA MIGRATION FAIT DE L'ENTRÉE EXISTANTE : elle reporte le JOUR DE
-- DÉBUT seul (25/05, `menstruation`), et rien d'autre. Transcrire la plage
-- fabriquerait 117 déclarations que l'athlète n'a jamais faites — dont 18
-- tomberaient sur des journées où elle a saisi son poids. Le début est la seule
-- chose qu'elle a réellement déclarée. L'événement calendrier N'EST PAS
-- SUPPRIMÉ ici : le retrait de la valeur `cycle` de l'enum `event_type` et de
-- la colonne `phase` viendra dans une migration à part, une fois l'écran qui
-- ne les propose plus déployé.
--
-- Aucune écriture rétroactive au-delà : les journées existantes gardent
-- `cycle_phase = NULL`, qui veut dire « pas déclaré » — et ne se confond pas
-- avec `menstruation`.

BEGIN;

ALTER TABLE daily_logs ADD COLUMN cycle_phase cycle_phase;

-- Le jour de début de chaque événement de cycle, et seulement lui.
INSERT INTO daily_logs (athlete_id, log_date, cycle_phase)
SELECT athlete_id, start_date, phase
  FROM calendar_events
 WHERE type = 'cycle' AND phase IS NOT NULL
ON CONFLICT (athlete_id, log_date) DO UPDATE SET cycle_phase = EXCLUDED.cycle_phase;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-12_le_cycle_dans_le_journal.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION :
--   SELECT count(*) FROM daily_logs WHERE cycle_phase IS NOT NULL;   -- attendu : 1
--   SELECT log_date, cycle_phase FROM daily_logs
--    WHERE cycle_phase IS NOT NULL;                                  -- 2026-05-25, menstruation
--   SELECT count(*) FROM calendar_events WHERE type = 'cycle';       -- attendu : 1 (intact)
