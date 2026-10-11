-- Euros 2026, Aubin : la feuille de match d'origine revient, une seconde fois.
--
-- Retouchée le 10/10 au soir avec l'ancien front, après
-- `2026-10-10_euros_la_feuille_de_match_revient` : la charge annoncée hors plan
-- s'est de nouveau écrite DANS un tier. Les valeurs d'origine sont celles de la
-- sauvegarde du 4 octobre au matin. La charge (`weight_kg`) et le verdict ne
-- bougent pas ; aucune ne figure au plan d'origine, l'annonce est hors plan.
BEGIN;

UPDATE competition_attempts a
   SET weight_pessimistic = c.p, weight_realistic = c.r, weight_optimistic = c.o, selected_tier = NULL
  FROM (VALUES
  ('MUSCLE UP', 3, 47.5::numeric, 48.75::numeric, 50::numeric),
  ('PULL UP',   3, 105::numeric,  107.5::numeric, 110::numeric),
  ('DIPS',      2, 157.5::numeric, 160::numeric,  162.5::numeric),
  ('DIPS',      3, 165::numeric,  167.5::numeric, 170::numeric),
  ('SQUAT',     3, 230::numeric,  235::numeric,   240::numeric)
  ) AS c(mouvement, essai, p, r, o),
       competition_participants p, competition_movements m, competitions co
 WHERE p.id = a.participant_id AND m.id = a.movement_id AND co.id = p.competition_id
   AND co.name = 'EUROS 2026 FINAL REP' AND p.name = 'Aubin'
   AND m.movement = c.mouvement AND a.attempt_index = c.essai;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-11_aubin_la_feuille_de_match_revient.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
