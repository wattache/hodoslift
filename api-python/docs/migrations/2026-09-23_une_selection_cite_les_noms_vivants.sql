-- LA SÉLECTION DE MOUVEMENTS CITE ENCORE LES NOMS MORTS (FRE-194, suite).
--
-- ⚠️ CE FICHIER CORRIGE UNE AFFIRMATION FAUSSE DE MA PART. Le ticket et la
-- migration `…_les_grilles_citent_les_noms_vivants.sql` disaient
-- « `selected_principals` est un text[] et ne porte AUCUN de ces noms ».
-- Il les porte tous : DEV COUCHE (37 blocs), BENCH (17), BENCH BARRE (4),
-- POMPES (4), VELO (3). Le relevé avait été fait sur la mauvaise colonne.
--
-- ⚠️ ET SANS CE FICHIER, LES TROIS MIGRATIONS PRÉCÉDENTES SE DÉFONT. Au front,
-- `normaliseDaySplit` ne garde que les tiers dont le mouvement est SÉLECTIONNÉ :
-- une grille qui place BENCH PRESS dans un bloc dont la sélection dit encore
-- DEV COUCHE perd sa case au PREMIER enregistrement de trame. C'est le mécanisme
-- exact qui a effacé les quatre cases du 19/09.
--
-- MESURÉ EN PRODUCTION LE 23/09 :
--
--   73 tiers placés sur un mouvement NON sélectionné, dans 59 blocs
--      · BENCH PRESS ×66 (57 blocs) · PUSH UPS ×4 · BIKE ×3
--
--   DEV COUCHE  → BENCH PRESS   37 blocs, 37 prescrivent le vivant
--   BENCH       → BENCH PRESS   17 blocs, 16 prescrivent le vivant
--   BENCH BARRE → BENCH PRESS    4 blocs,  4 prescrivent le vivant
--   POMPES      → PUSH UPS       4 blocs,  4 prescrivent le vivant
--   VELO        → BIKE           3 blocs,  3 prescrivent le vivant
--
--   0 collision, 0 doublon préexistant, 0 principe ou accessoire portant un
--   de ces noms — personne ne les emploie pour de bon.
--
-- ⚠️ LE SEIZIÈME BENCH SUR DIX-SEPT. Un bloc a `BENCH` dans sa sélection sans
-- prescrire BENCH PRESS. On ne le substitue pas : la condition est le PRINCIPE
-- du bloc, pas le nom. Il restera, visible et inutile, plutôt que deviné.

BEGIN;

-- ⚠️ LA GARDE D'ENTRÉE PROTÈGE UN NOM LÉGITIME. Le jour où quelqu'un prescrit
-- vraiment BENCH, POMPES ou VELO, sa sélection cesse d'être une coquille et
-- cette migration lui volerait son mouvement. Elle lève plutôt que de deviner.
DO $$
DECLARE legitimes int;
BEGIN
  SELECT count(*) INTO legitimes FROM (
    SELECT name FROM training_base_principles  WHERE name IN ('DEV COUCHE','BENCH BARRE','BENCH','POMPES','VELO')
    UNION ALL
    SELECT name FROM training_base_accessories WHERE name IN ('DEV COUCHE','BENCH BARRE','BENCH','POMPES','VELO')) t;
  IF legitimes > 0 THEN
    RAISE EXCEPTION '% ligne(s) de BASE portent vraiment un de ces noms — ce ne sont plus des coquilles.', legitimes;
  END IF;
END $$;

-- ⚠️ LA SUBSTITUTION SE FAIT EN PLACE, À RANG CONSTANT. `selected_principals`
-- N'EST PAS UN ENSEMBLE : son ORDRE est celui que le coach a voulu, et
-- `generation_semaine` s'en sert pour ranger les lignes d'une séance (FRE-29).
-- Remplacer à la position exacte préserve son intention ; retirer puis ajouter
-- enverrait le mouvement en fin de séance.
UPDATE training_blocks b
   SET selected_principals = sub.nouvelle
  FROM (
    SELECT b2.id,
           array_agg(
             CASE WHEN m.vivant IS NOT NULL
                   -- La condition est le PRINCIPE du bloc : c'est ce que la
                   -- génération apparie, et c'est ce qui rend le nom mort.
                   AND EXISTS (SELECT 1 FROM training_base_principles p
                                WHERE p.block_id = b2.id AND p.name = m.vivant)
                  THEN m.vivant
                  ELSE e.nom
             END ORDER BY e.n) AS nouvelle
      FROM training_blocks b2
      CROSS JOIN LATERAL unnest(b2.selected_principals) WITH ORDINALITY AS e(nom, n)
      LEFT JOIN (VALUES ('DEV COUCHE','BENCH PRESS'), ('BENCH BARRE','BENCH PRESS'),
                        ('BENCH','BENCH PRESS'), ('POMPES','PUSH UPS'), ('VELO','BIKE'))
             AS m(mort, vivant) ON m.mort = e.nom
     WHERE b2.selected_principals IS NOT NULL
       AND b2.selected_principals && ARRAY['DEV COUCHE','BENCH BARRE','BENCH','POMPES','VELO']
     GROUP BY b2.id
  ) AS sub
 WHERE b.id = sub.id;

-- ── La vérification de sortie : elle LÈVE, elle n'affiche pas ────────────────
DO $$
DECLARE doublons int; exposes int; restants int;
BEGIN
  -- ⚠️ UN DOUBLON SERAIT LE SIGNE D'UNE COLLISION NON VUE : deux entrées du même
  -- mouvement, dont l'éditeur ne sait afficher qu'une colonne.
  SELECT count(*) INTO doublons FROM training_blocks b
   WHERE b.selected_principals IS NOT NULL
     AND array_length(b.selected_principals, 1)
         <> (SELECT count(DISTINCT n) FROM unnest(b.selected_principals) AS n);
  IF doublons > 0 THEN
    RAISE EXCEPTION '% sélection(s) portent deux fois le même mouvement.', doublons;
  END IF;

  -- LE VRAI OBJET DE CE FICHIER : plus aucune case ne tombera au prochain
  -- enregistrement, dans un bloc qui prescrit pourtant le mouvement.
  SELECT count(*) INTO exposes
    FROM training_blocks b, jsonb_array_elements(b.day_split) AS j(value),
         jsonb_each(coalesce(j.value->'tiers','{}'::jsonb)) AS k(key,val)
   WHERE jsonb_typeof(b.day_split) = 'array' AND b.selected_principals IS NOT NULL
     AND NOT (k.key = ANY(b.selected_principals))
     AND EXISTS (SELECT 1 FROM training_base_principles p
                  WHERE p.block_id = b.id AND p.name = k.key);
  IF exposes > 0 THEN
    RAISE EXCEPTION '% tier(s) tomberaient encore au prochain enregistrement.', exposes;
  END IF;

  -- Ce qui reste doit rester pour une RAISON : un bloc qui ne prescrit pas le
  -- mouvement vivant. Tout autre reste serait une substitution manquée.
  SELECT count(*) INTO restants
    FROM training_blocks b, unnest(b.selected_principals) AS nom
    JOIN (VALUES ('DEV COUCHE','BENCH PRESS'), ('BENCH BARRE','BENCH PRESS'),
                 ('BENCH','BENCH PRESS'), ('POMPES','PUSH UPS'), ('VELO','BIKE'))
      AS m(mort, vivant) ON m.mort = nom
   WHERE b.selected_principals IS NOT NULL
     AND EXISTS (SELECT 1 FROM training_base_principles p
                  WHERE p.block_id = b.id AND p.name = m.vivant);
  IF restants > 0 THEN
    RAISE EXCEPTION '% nom(s) mort(s) subsistent dans un bloc qui prescrit le vivant.', restants;
  END IF;
  RAISE NOTICE 'Sélections reprises ; plus aucun tier exposé.';
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-23_une_selection_cite_les_noms_vivants.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
