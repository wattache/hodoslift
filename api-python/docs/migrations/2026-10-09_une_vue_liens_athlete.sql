-- QUI SUIT QUI, EN UNE VUE (FRE-217). Le lien d'une personne à un athlète —
-- coach de la fiche ou du programme, kiné, l'athlète lui-même, accès support en
-- cours — s'écrivait à onze endroits, et pas de la même façon : l'accès support
-- entrait dans l'autorisation et le sélecteur, pas dans le guichet, les
-- signalements ni les suivis. Une demi-règle. Ici, une seule.
--
-- ⚠️ UN ACCÈS SUPPORT EN COURS VAUT COACH ET KINÉ, et c'est un lien comme les
-- autres : il porte sa fin. `clock_timestamp()` et non `now()` : l'accès se
-- juge à l'heure réelle, pas au début de la transaction qui le lit.

BEGIN;

CREATE VIEW liens_athlete AS
SELECT a.coach_uid AS uid, a.id AS athlete_id, 'coach' AS lien, NULL::timestamptz AS jusqu_au
  FROM athletes a
UNION
SELECT p.coach_uid, p.athlete_id, 'coach', NULL
  FROM programs p
UNION
SELECT a.kine_uid, a.id, 'kine', NULL
  FROM athletes a WHERE a.kine_uid IS NOT NULL
UNION
SELECT a.user_uid, a.id, 'athlete', NULL
  FROM athletes a WHERE a.user_uid IS NOT NULL
UNION
SELECT s.uid, s.athlete_id, l.lien, s.fin
  FROM acces_support s CROSS JOIN (VALUES ('coach'), ('kine')) AS l(lien)
 WHERE s.fin > clock_timestamp();

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-09_une_vue_liens_athlete.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
