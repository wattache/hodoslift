-- Un objectif de bloc vient d'UNE LIGNE DE LA BASE de son bloc (FRE-254,
-- William 25/10) : un principe (avec son tier) ou un renfo. `source` dit
-- laquelle ; NULL = un objectif posé avant la règle, non lié. Son avancement se
-- lit sur les lignes de semaine de même mouvement, variantes, format, tempo et
-- tier.
BEGIN;

ALTER TABLE block_objectives
  ADD COLUMN source text CONSTRAINT block_objectives_source CHECK (source IN ('principe', 'renfo')),
  ADD COLUMN tier smallint CONSTRAINT block_objectives_tier CHECK (tier BETWEEN 1 AND 3);

-- Les objectifs existants qui ne correspondent qu'à UNE ligne de la BASE de leur
-- bloc (mouvement, variantes, format, tempo) y sont rattachés. Les ambigus et
-- les orphelins restent non liés : on ne devine pas.
WITH base AS (
  SELECT block_id, name, tier, 'principe' AS source,
         coalesce(array_to_string(ARRAY(SELECT upper(btrim(v)) FROM unnest(variant) v
                                        WHERE btrim(v) <> '' ORDER BY 1), '+'), '') AS var,
         coalesce(format, '') AS f, coalesce(tempo, '') AS t
  FROM training_base_principles
  UNION ALL
  SELECT block_id, name, NULL, 'renfo',
         coalesce(array_to_string(ARRAY(SELECT upper(btrim(v)) FROM unnest(variant) v
                                        WHERE btrim(v) <> '' ORDER BY 1), '+'), ''),
         coalesce(format, ''), coalesce(tempo, '')
  FROM training_base_accessories
), cle AS (
  SELECT o.id, o.block_id, o.exercise,
         coalesce(array_to_string(ARRAY(SELECT upper(btrim(v)) FROM unnest(string_to_array(coalesce(o.variant, ''), '+')) v
                                        WHERE btrim(v) <> '' ORDER BY 1), '+'), '') AS var,
         coalesce(o.format, '') AS f, coalesce(o.tempo, '') AS t
  FROM block_objectives o
), unique_ligne AS (
  SELECT c.id, min(b.source) AS source, min(b.tier) AS tier
  FROM cle c JOIN base b ON b.block_id = c.block_id AND b.name = c.exercise
                        AND b.var = c.var AND b.f = c.f AND b.t = c.t
  GROUP BY c.id HAVING count(*) = 1
)
UPDATE block_objectives o SET source = u.source, tier = u.tier
FROM unique_ligne u WHERE o.id = u.id;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-25_un_objectif_vient_d_une_ligne_de_base.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
