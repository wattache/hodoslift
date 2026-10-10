-- Euros 2026 : la feuille de match d'origine revient, l'annonce hors plan se range à côté.
--
-- L'ancien plateau écrivait une charge annoncée hors plan DANS le tier annoncé
-- (le R à défaut) : le plan P/R/O perdait sa valeur d'origine — le pull up #3
-- d'Aubin affichait 109 au R, prévu à 107.5. Les valeurs ci-dessous sont celles
-- des sauvegardes horaires (gs://french-forge-600-db-backups), au matin du jour
-- de passage de chaque athlète. La CHARGE annoncée (`weight_kg`) et le verdict
-- ne bougent pas : les scores sont inchangés. Le tier devient celui dont la
-- valeur d'origine égale la charge annoncée, NULL sinon (annonce hors plan).
--
-- ⚠️ PAR CLÉ NATURELLE, pas par id : la feuille se réécrit entière à chaque
-- enregistrement, et les essais changent d'id.
BEGIN;

UPDATE competition_attempts a
   SET weight_pessimistic = c.p, weight_realistic = c.r, weight_optimistic = c.o, selected_tier = c.tier
  FROM (VALUES
  ('Aubin', 'MUSCLE UP', 3, 47.5::numeric, 48.75::numeric, 50::numeric, NULL::attempt_tier),
  ('Aubin', 'PULL UP', 3, 105::numeric, 107.5::numeric, 110::numeric, NULL::attempt_tier),
  ('Aubin', 'DIPS', 2, 157.5::numeric, 160::numeric, 162.5::numeric, NULL::attempt_tier),
  ('Aubin', 'DIPS', 3, 165::numeric, 167.5::numeric, 170::numeric, NULL::attempt_tier),
  ('Chartier Enzo', 'PULL UP', 2, 80::numeric, 82.5::numeric, 85::numeric, NULL::attempt_tier),
  ('Guilhemette', 'PULL UP', 3, 47.5::numeric, 50::numeric, 52.5::numeric, NULL::attempt_tier),
  ('Guilhemette', 'DIPS', 3, 75::numeric, 77.5::numeric, 80::numeric, NULL::attempt_tier),
  ('Ignacy', 'MUSCLE UP', 2, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'MUSCLE UP', 3, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'PULL UP', 1, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'PULL UP', 2, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'PULL UP', 3, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'DIPS', 1, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'DIPS', 2, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'DIPS', 3, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'SQUAT', 1, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'SQUAT', 2, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'SQUAT', 3, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Ignacy', 'MUSCLE UP', 1, NULL::numeric, NULL::numeric, NULL::numeric, NULL::attempt_tier),
  ('Kevin gogo', 'MUSCLE UP', 1, 25::numeric, 27.5::numeric, 30::numeric, NULL::attempt_tier),
  ('Kevin gogo', 'MUSCLE UP', 3, 32.5::numeric, 35::numeric, 37.5::numeric, NULL::attempt_tier),
  ('Kevin gogo', 'PULL UP', 3, 90::numeric, 92.5::numeric, 95::numeric, NULL::attempt_tier),
  ('Kevin gogo', 'DIPS', 3, 170::numeric, 175::numeric, 177.5::numeric, NULL::attempt_tier),
  ('Kevin gogo', 'SQUAT', 1, 235::numeric, 240::numeric, 245::numeric, NULL::attempt_tier),
  ('Kevin gogo', 'SQUAT', 3, 255::numeric, 260::numeric, 265::numeric, NULL::attempt_tier),
  ('Lionel', 'MUSCLE UP', 1, 40::numeric, 41.25::numeric, 42.5::numeric, 'optimistic'::attempt_tier),
  ('Théo GT', 'MUSCLE UP', 3, 27.5::numeric, 28.75::numeric, 31.25::numeric, NULL::attempt_tier),
  ('Théo GT', 'PULL UP', 1, 80::numeric, 82.5::numeric, 85::numeric, NULL::attempt_tier),
  ('Théo GT', 'PULL UP', 2, 90::numeric, 91.25::numeric, 92.5::numeric, NULL::attempt_tier),
  ('Théo GT', 'DIPS', 2, 177.5::numeric, 180::numeric, 183::numeric, NULL::attempt_tier),
  ('Théo GT', 'SQUAT', 3, 260::numeric, 262.5::numeric, 265::numeric, NULL::attempt_tier)
  ) AS c(athlete, mouvement, essai, p, r, o, tier),
       competition_participants p, competition_movements m, competitions co
 WHERE p.id = a.participant_id AND m.id = a.movement_id AND co.id = p.competition_id
   AND co.name = 'EUROS 2026 FINAL REP'
   AND p.name = c.athlete AND m.movement = c.mouvement AND a.attempt_index = c.essai;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-10_euros_la_feuille_de_match_revient.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
