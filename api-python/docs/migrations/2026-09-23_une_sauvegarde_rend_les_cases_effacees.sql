-- QUATRE CASES EFFACÉES LE 19/09, RETROUVÉES DANS UNE SAUVEGARDE (FRE-194).
--
-- ⚠️ CE N'EST PAS UNE DÉDUCTION, C'EST UNE LECTURE. Les valeurs ci-dessous
-- viennent des dumps horaires de `gs://french-forge-600-db-backups` : celui du
-- 18/09 00h10 les porte, celui du 20/09 00h10 ne les porte plus. Le diff des
-- deux, sur les 177 blocs communs, donne QUATRE cases perdues dans TROIS blocs
-- — et rien d'autre : aucune grille vidée, aucun autre mouvement touché.
--
-- LE MÉCANISME EST CELUI DE `2026-09-20_avant_le_cycle_grille_de_laura.sql` :
-- le front qui parle en J1…Jn a été servi avant que la base ne les connaisse,
-- `normaliseDaySplit` n'a reconnu aucun jour, et le premier enregistrement de
-- trame a gardé ce qu'il voyait. Ce fichier-là disait « un seul bloc a été
-- touché, celui de Laura » ; c'était vrai des grilles VIDÉES, pas des cases
-- perdues une à une — `BENCH` n'étant dans aucune sélection de mouvements,
-- il tombait aussi chez qui rouvrait sa trame.
--
-- LES JOURS SE TRADUISENT COMME LA MIGRATION DU CYCLE L'A FAIT : Lundi → J1 …
-- Dimanche → J7. Samedi → J6, Mardi → J2, Vendredi → J5.
--
-- CE QU'ON NE TOUCHE PAS, ET POURQUOI :
--   · David Ortiz b1 et Ulysse Guibert b4 prescrivent en tier 3 et placent en
--     tier 1. Le dump du 16/09 le montre DÉJÀ : l'écart est d'origine, pas une
--     perte. C'est FRE-193, et c'est au coach.
--   · Rémy Cardy b2 n'a jamais porté de case depuis sa création (16/09).
--     On ne fabrique pas un placement que personne n'a posé.

BEGIN;

-- ⚠️ LA GARDE D'ENTRÉE EXIGE LES QUATRE, ET REFUSE D'EN POSER TROIS. Chaque
-- case doit viser un jour qui existe, un principe prescrit AU MÊME TIER, et une
-- place encore libre. Si un coach a refait sa grille depuis, il n'y a rien à
-- réparer et cette migration ne doit pas défaire son travail.
DO $$
DECLARE posables int;
BEGIN
  SELECT count(*) INTO posables
    FROM (VALUES
      ('92fb9934-ef83-4465-b06d-ccb2dbbb16e6'::uuid, 'J6', 2),
      ('b69b0b15-7676-446d-aa5e-46babd53572c'::uuid, 'J2', 1),
      ('b69b0b15-7676-446d-aa5e-46babd53572c'::uuid, 'J5', 2),
      ('991305c8-792d-4d43-b1d8-14aca1c12406'::uuid, 'J2', 1)
    ) AS r(block_id, jour, tier)
    JOIN training_blocks b ON b.id = r.block_id
   WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(b.day_split) AS j(value)
                  WHERE j.value->>'day' = r.jour
                    AND NOT (coalesce(j.value->'tiers', '{}'::jsonb) ? 'BENCH PRESS'))
     AND EXISTS (SELECT 1 FROM training_base_principles p
                  WHERE p.block_id = r.block_id AND p.name = 'BENCH PRESS' AND p.tier = r.tier);
  IF posables <> 4 THEN
    RAISE EXCEPTION '% case(s) posables sur 4 — la donnée a bougé depuis le relevé.', posables;
  END IF;
END $$;

WITH restitution(block_id, jour, tier) AS (VALUES
  ('92fb9934-ef83-4465-b06d-ccb2dbbb16e6'::uuid, 'J6', 2),
  ('b69b0b15-7676-446d-aa5e-46babd53572c'::uuid, 'J2', 1),
  ('b69b0b15-7676-446d-aa5e-46babd53572c'::uuid, 'J5', 2),
  ('991305c8-792d-4d43-b1d8-14aca1c12406'::uuid, 'J2', 1)
),
nouvelles AS (
  SELECT b.id,
         jsonb_agg(
           CASE WHEN r.tier IS NULL THEN jour.value
                -- ⚠️ ON REPOSE `tiers` AVANT D'Y ÉCRIRE : `jsonb_set` ne crée pas
                -- un parent manquant, il rendrait la ligne inchangée EN SILENCE.
                ELSE jsonb_set(
                       jsonb_set(jour.value, '{tiers}', coalesce(jour.value->'tiers', '{}'::jsonb)),
                       ARRAY['tiers', 'BENCH PRESS'], to_jsonb(r.tier))
           END
           -- ⚠️ L'ORDRE DES JOURS EST CELUI DE LA RÉPARTITION : sans `ORDER BY`,
           -- `jsonb_agg` suit l'ordre d'arrivée et la semaine sort à l'envers.
           ORDER BY jour.ordinality) AS nouvelle
    FROM training_blocks b
    CROSS JOIN LATERAL jsonb_array_elements(b.day_split) WITH ORDINALITY AS jour(value, ordinality)
    LEFT JOIN restitution r ON r.block_id = b.id AND r.jour = jour.value->>'day'
   WHERE b.id IN (SELECT block_id FROM restitution)
   GROUP BY b.id
)
UPDATE training_blocks b SET day_split = n.nouvelle FROM nouvelles n WHERE b.id = n.id;

-- ── La vérification de sortie : elle LÈVE, elle n'affiche pas ────────────────
DO $$
DECLARE posees int; total int;
BEGIN
  SELECT count(*) INTO posees
    FROM (VALUES
      ('92fb9934-ef83-4465-b06d-ccb2dbbb16e6'::uuid, 'J6', 2),
      ('b69b0b15-7676-446d-aa5e-46babd53572c'::uuid, 'J2', 1),
      ('b69b0b15-7676-446d-aa5e-46babd53572c'::uuid, 'J5', 2),
      ('991305c8-792d-4d43-b1d8-14aca1c12406'::uuid, 'J2', 1)
    ) AS r(block_id, jour, tier)
    JOIN training_blocks b ON b.id = r.block_id,
         LATERAL jsonb_array_elements(b.day_split) AS j(value)
   WHERE j.value->>'day' = r.jour
     AND (j.value->'tiers'->>'BENCH PRESS')::int = r.tier;
  IF posees <> 4 THEN
    RAISE EXCEPTION 'Attendu 4 cases reposées, trouvé %.', posees;
  END IF;

  -- ⚠️ ET LE TOTAL DIT QU'ON N'A RIEN CASSÉ AILLEURS : 114 avant, 4 posées.
  -- Sans ce second compte, une grille écrasée par erreur passerait le premier.
  SELECT count(*) INTO total
    FROM training_blocks b, jsonb_array_elements(b.day_split) AS j(value),
         jsonb_each(coalesce(j.value->'tiers','{}'::jsonb)) AS k(key,val)
   WHERE jsonb_typeof(b.day_split) = 'array' AND k.key = 'BENCH PRESS';
  IF total <> 118 THEN
    RAISE EXCEPTION '% jours placent BENCH PRESS — 118 attendus (114 + 4).', total;
  END IF;
  RAISE NOTICE '4 cases reposées ; % jours placent BENCH PRESS.', total;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-23_une_sauvegarde_rend_les_cases_effacees.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
