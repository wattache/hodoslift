-- LA RÉPARTITION DES JOURS CITE QUATRE NOMS MORTS (FRE-194).
--
-- La BASE tient en DEUX morceaux, et un seul porte des clés étrangères : les
-- lignes (`training_base_principles`, `_accessories`) ont suivi l'anglicisation
-- de la bibliothèque, `training_blocks.day_split` non — c'est du jsonb, il ne
-- référence rien. La répartition dit donc `DEV COUCHE` là où le principe dit
-- `BENCH PRESS`, et rien n'apparie plus les deux : `generation_semaine.py`
-- apparie par ÉGALITÉ DE NOM.
--
-- ⚠️ « + SEMAINE » N'EST PAS CONCERNÉ, et c'est la raison pour laquelle ce
-- fichier n'est pas urgent : `semaine_suivante()` copie la dernière semaine et
-- ne lit jamais `day_split`. Seule `generer_semaine()` le lit, et seule la S1
-- passe par elle. Les blocs en cours ne risquent rien.
--
-- ⚠️ CE QUI EST CASSÉ SE VOIT DÉJÀ, ET S'EFFACE TOUT SEUL : au front,
-- `normaliseDaySplit` ne garde que les tiers dont le mouvement est encore
-- sélectionné, et `DEV COUCHE` n'y est plus. La case tombe au CHARGEMENT — le
-- coach voit son BENCH PRESS prescrit et placé nulle part — et le prochain
-- enregistrement de la BASE la perd pour de bon. Les 53 tiers encore là sont
-- ceux des BASE que personne n'a rouvertes : la fenêtre se referme seule.
--
-- MESURÉ EN PRODUCTION LE 23/09 :
--
--   DEV COUCHE   40 occurrences · 37 blocs   → BENCH PRESS
--   BENCH BARRE   6 occurrences ·  4 blocs   → BENCH PRESS
--   POMPES        4 occurrences ·  4 blocs   → PUSH UPS
--   VELO          3 occurrences ·  3 blocs   → BIKE
--
-- Aucun bloc ne porte à la fois un nom mort et son remplaçant, et aucun jour ne
-- porte deux noms morts menant au même vivant : la substitution n'écrase donc
-- aucun tier existant. Vérifié avant d'écrire ce fichier.

BEGIN;

-- ⚠️ `tiers` EST UN OBJET `{NOM: tier}`, PAS UN TABLEAU. On remplace donc une
-- CLÉ, et c'est toute la difficulté : `jsonb_set` ne sait pas renommer une clé.
-- On reconstruit l'objet à partir de ses paires, en substituant la clé au
-- passage — la valeur (le numéro de tier) suit sans y toucher.
UPDATE training_blocks b
   SET day_split = sub.nouvelle
  FROM (
    SELECT b2.id,
           jsonb_agg(
             CASE WHEN jour.value ? 'tiers'
                  THEN jsonb_set(jour.value, '{tiers}', (
                         SELECT coalesce(jsonb_object_agg(
                                  CASE paire.key
                                    WHEN 'DEV COUCHE'  THEN 'BENCH PRESS'
                                    WHEN 'BENCH BARRE' THEN 'BENCH PRESS'
                                    WHEN 'POMPES'      THEN 'PUSH UPS'
                                    WHEN 'VELO'        THEN 'BIKE'
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
       AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(b2.day_split) AS j(value),
                          jsonb_each(coalesce(j.value->'tiers', '{}'::jsonb)) AS k(key, val)
              WHERE k.key IN ('DEV COUCHE', 'BENCH BARRE', 'POMPES', 'VELO'))
     GROUP BY b2.id
  ) AS sub
 WHERE b.id = sub.id;

-- ── La vérification de sortie : elle LÈVE, elle n'affiche pas ────────────────
DO $$
DECLARE restants int; vivants int;
BEGIN
  SELECT count(*) INTO restants
    FROM training_blocks b,
         jsonb_array_elements(b.day_split) AS j(value),
         jsonb_each(coalesce(j.value->'tiers', '{}'::jsonb)) AS k(key, val)
   WHERE jsonb_typeof(b.day_split) = 'array'
     AND k.key IN ('DEV COUCHE', 'BENCH BARRE', 'POMPES', 'VELO');
  IF restants > 0 THEN
    RAISE EXCEPTION '% tier(s) citent encore un nom mort.', restants;
  END IF;

  -- ⚠️ ET LE COMPTE DES VIVANTS DIT QUE LA SUBSTITUTION A EU LIEU, au lieu de
  -- se contenter de l'absence : un `day_split` vidé par erreur passerait le
  -- premier garde sans broncher.
  SELECT count(*) INTO vivants
    FROM training_blocks b,
         jsonb_array_elements(b.day_split) AS j(value),
         jsonb_each(coalesce(j.value->'tiers', '{}'::jsonb)) AS k(key, val)
   WHERE jsonb_typeof(b.day_split) = 'array'
     AND k.key IN ('BENCH PRESS', 'PUSH UPS', 'BIKE');
  IF vivants < 53 THEN
    RAISE EXCEPTION 'Seulement % tier(s) sur les noms vivants — 53 au moins attendus.', vivants;
  END IF;
  RAISE NOTICE '% tiers citent désormais un nom vivant.', vivants;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-23_les_grilles_citent_les_noms_vivants.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
