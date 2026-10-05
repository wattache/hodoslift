-- REMETTRE LA GRILLE DU BLOC DE LAURA, effacée le 20/09 — AVANT le cycle.
--
-- CE QUI S'EST PASSÉ. Le front qui parle en jours de cycle (J1 … Jn) a été
-- ouvert sur une base qui parle encore en jours de semaine. `normaliseDaySplit`
-- ne gardait que les jours qu'il reconnaît : il n'en reconnaissait aucun, a
-- affiché sept lignes vides, et le premier geste du coach — créer puis
-- supprimer un bloc, ce qui réécrit la trame — les a enregistrées. Un seul bloc
-- a été touché, celui de Laura ; ses 12 principes et ses 13 accessoires n'ont
-- pas bougé, et les 181 autres grilles non plus.
--
-- ⚠️ ELLE PASSE AVANT `…_repartition_du_cycle.sql`, ET SON NOM LE GARANTIT
-- (« avant » avant « repartition », l'ordre étant celui du nom de fichier). Il
-- le faut dans ce sens : la garde du cycle refuse une grille qu'elle ne sait pas
-- traduire, et se serait arrêtée sur ces sept « J# ». On repose donc les jours
-- de SEMAINE, et la migration du cycle les renommera comme les 181 autres —
-- plutôt que d'écrire des J# à la main et d'avoir à les exclure d'une garde qui
-- a justement bien fait son travail.
--
-- ⚠️ LA GRILLE EST RECONSTITUÉE, PAS DEVINÉE. Les DEUX semaines engendrées
-- depuis cette trame portent chacune les mêmes séances, nommées par leur jour,
-- et chaque ligne y porte son tier :
--
--     Lundi     MUSCLE UP 1 · DIPS 2
--     Mardi     SQUAT 1 · PULL UP 2
--     Jeudi     DIPS 1
--     Vendredi  PULL UP 1 · MUSCLE UP 2
--     Samedi    SQUAT 2
--
-- Les douze lignes de `training_base_principles` du bloc couvrent exactement ces
-- neuf couples (mouvement, tier), et les treize accessoires sont datés des mêmes
-- cinq jours. Mercredi et dimanche n'ont jamais rien porté : aucune séance, aucun
-- accessoire.

BEGIN;

-- ⚠️ ON N'ÉCRASE QUE L'ÉTAT EXACT QU'ON A CONSTATÉ : sept jours de cycle, tous
-- vides. Si le coach a refait sa grille entre-temps, il n'y a rien à réparer et
-- cette migration ne doit pas défaire son travail.
DO $$
DECLARE trouve int;
BEGIN
  SELECT count(*) INTO trouve FROM training_blocks
   WHERE legacy_id = '41964005-40eb-4ae9-a6d8-624c24ece8c0'
     AND day_split = '[{"day": "J1", "tiers": {}}, {"day": "J2", "tiers": {}}, {"day": "J3", "tiers": {}},
                       {"day": "J4", "tiers": {}}, {"day": "J5", "tiers": {}}, {"day": "J6", "tiers": {}},
                       {"day": "J7", "tiers": {}}]'::jsonb;
  IF trouve = 0 THEN
    RAISE NOTICE 'Grille de Laura : déjà refaite ou déjà réparée — rien à faire.';
  ELSE
    UPDATE training_blocks SET day_split = '[
      {"day": "Lundi",    "tiers": {"MUSCLE UP": 1, "DIPS": 2}},
      {"day": "Mardi",    "tiers": {"SQUAT": 1, "PULL UP": 2}},
      {"day": "Mercredi", "tiers": {}},
      {"day": "Jeudi",    "tiers": {"DIPS": 1}},
      {"day": "Vendredi", "tiers": {"PULL UP": 1, "MUSCLE UP": 2}},
      {"day": "Samedi",   "tiers": {"SQUAT": 2}},
      {"day": "Dimanche", "tiers": {}}]'::jsonb
     WHERE legacy_id = '41964005-40eb-4ae9-a6d8-624c24ece8c0';
    RAISE NOTICE 'Grille de Laura : reposée sur ses cinq jours.';
  END IF;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-20_avant_le_cycle_grille_de_laura.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
