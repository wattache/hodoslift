-- LA RÉPARTITION DIT `BENCH`, LE PRINCIPE DIT `BENCH PRESS` (FRE-194, suite).
--
-- ⚠️ CE FICHIER EXISTE PARCE QUE J'AI CHERCHÉ LES NOMS MORTS AU MAUVAIS
-- ENDROIT. La migration précédente partait d'une liste de quatre noms ABSENTS
-- DE LA BIBLIOTHÈQUE. `BENCH` y est vivant — il n'a donc jamais été vu, alors
-- qu'il ne désigne le mouvement d'aucun bloc.
--
-- LE BON CRITÈRE EST CELUI QUE LA GÉNÉRATION APPLIQUE : un tier trouve son
-- principe par NOM ET TIER, dans SON bloc (`generation_semaine.py`,
-- `if p.get("name") == mouvement and p.get("tier") == tier`). Une clé qui
-- n'apparie aucun principe du bloc n'engendre rien, que son nom existe ailleurs
-- ou non.
--
-- MESURÉ SUR COPIE FRAÎCHE DE LA PRODUCTION :
--
--   31 clés `BENCH` (22 en tier 1, 9 en tier 2)
--   31 / 31 dans un bloc qui prescrit `BENCH PRESS` AU MÊME TIER
--    0 principe et 0 accessoire nommés `BENCH` — personne ne l'emploie
--    0 jour portant les deux clés — la substitution n'écrase rien
--    0 ligne de séance nommée `BENCH` — le mouvement n'a jamais été entraîné
--
-- VU ROUGE PAR LE VRAI CHEMIN, avant d'écrire : `lire_base` puis
-- `generer_semaine` sur les 41 blocs actifs qui prescrivent BENCH PRESS —
-- 25 le rendent, 16 L'OUBLIENT.

BEGIN;

-- ⚠️ LA GARDE D'ENTRÉE PROTÈGE UN `BENCH` LÉGITIME. Le jour où quelqu'un
-- prescrit vraiment ce mouvement, sa clé cesse d'être une coquille et cette
-- migration lui volerait son jour. Elle lève plutôt que de deviner.
DO $$
DECLARE legitime int; collision int;
BEGIN
  SELECT count(*) INTO legitime
    FROM (SELECT name FROM training_base_principles WHERE name = 'BENCH'
          UNION ALL SELECT name FROM training_base_accessories WHERE name = 'BENCH') t;
  IF legitime > 0 THEN
    RAISE EXCEPTION '% ligne(s) de BASE s''appellent vraiment BENCH — la clé n''est plus une coquille.', legitime;
  END IF;

  SELECT count(*) INTO collision
    FROM training_blocks b, jsonb_array_elements(b.day_split) AS j(value)
   WHERE jsonb_typeof(b.day_split) = 'array'
     AND j.value->'tiers' ? 'BENCH' AND j.value->'tiers' ? 'BENCH PRESS';
  IF collision > 0 THEN
    RAISE EXCEPTION '% jour(s) portent les deux clés — la substitution en écraserait une.', collision;
  END IF;
END $$;

-- ⚠️ `tiers` EST UN OBJET `{NOM: tier}` : on remplace une CLÉ, et `jsonb_set`
-- ne sait pas renommer une clé. On reconstruit l'objet depuis ses paires.
--
-- ⚠️ ET LA SUBSTITUTION EST CONDITIONNÉE AU TIER, pas au seul nom : `BENCH` en
-- tier 2 ne devient `BENCH PRESS` que si le bloc prescrit BENCH PRESS EN TIER 2.
-- Sans cette condition, une coquille en tier 3 fabriquerait un tier que le
-- coach n'a jamais posé, et la séance sortirait avec une ligne de trop.
UPDATE training_blocks b
   SET day_split = sub.nouvelle
  FROM (
    SELECT b2.id,
           jsonb_agg(
             CASE WHEN jour.value ? 'tiers'
                  THEN jsonb_set(jour.value, '{tiers}', (
                         SELECT coalesce(jsonb_object_agg(
                                  CASE WHEN paire.key = 'BENCH'
                                        AND EXISTS (SELECT 1 FROM training_base_principles p
                                                     WHERE p.block_id = b2.id
                                                       AND p.name = 'BENCH PRESS'
                                                       AND p.tier = (paire.value)::int)
                                       THEN 'BENCH PRESS'
                                       ELSE paire.key
                                  END, paire.value), '{}'::jsonb)
                           FROM jsonb_each(jour.value->'tiers') AS paire(key, value)))
                  ELSE jour.value
             END
             -- ⚠️ L'ORDRE DES JOURS EST CELUI DE LA RÉPARTITION. `jsonb_agg` sans
             -- `ORDER BY` suit l'ordre d'arrivée, qui n'est pas garanti : J3
             -- pourrait passer devant J1, et la semaine sortirait à l'envers.
             ORDER BY jour.ordinality
           ) AS nouvelle
      FROM training_blocks b2,
           jsonb_array_elements(b2.day_split) WITH ORDINALITY AS jour(value, ordinality)
     WHERE jsonb_typeof(b2.day_split) = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(b2.day_split) AS j(value)
                    WHERE j.value->'tiers' ? 'BENCH')
     GROUP BY b2.id
  ) AS sub
 WHERE b.id = sub.id;

-- ── La vérification de sortie : elle LÈVE, elle n'affiche pas ────────────────
DO $$
DECLARE restants int; places int;
BEGIN
  SELECT count(*) INTO restants
    FROM training_blocks b, jsonb_array_elements(b.day_split) AS j(value),
         jsonb_each(coalesce(j.value->'tiers','{}'::jsonb)) AS k(key,val)
   WHERE jsonb_typeof(b.day_split) = 'array' AND k.key = 'BENCH';
  IF restants > 0 THEN
    RAISE EXCEPTION '% clé(s) BENCH subsistent.', restants;
  END IF;

  -- ⚠️ ET LE COMPTE DES PLACÉS DIT QUE LA SUBSTITUTION A EU LIEU, au lieu de se
  -- contenter de l'absence : un `day_split` vidé par erreur passerait le premier
  -- garde sans broncher. 83 avant, 31 substitués.
  SELECT count(*) INTO places
    FROM training_blocks b, jsonb_array_elements(b.day_split) AS j(value),
         jsonb_each(coalesce(j.value->'tiers','{}'::jsonb)) AS k(key,val)
   WHERE jsonb_typeof(b.day_split) = 'array' AND k.key = 'BENCH PRESS';
  IF places < 114 THEN
    RAISE EXCEPTION 'Seulement % BENCH PRESS placés — 114 au moins attendus.', places;
  END IF;
  RAISE NOTICE '% jours placent BENCH PRESS.', places;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-23_une_repartition_qui_dit_bench_dit_bench_press.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
