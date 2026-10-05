-- LA RÉPARTITION DEVIENT UN CYCLE : J1 … Jn, et non plus Lundi … Dimanche.
--
-- Demandé par William le 19/09, pour deux raisons mesurées à l'usage :
--   · une couleur par jour de semaine ne porte aucun sens, et deux coachs ont
--     confondu jeudi (orange) et vendredi (rouge) ;
--   · des athlètes suivent des cycles qui ne font pas sept jours — le guichet
--     le dit déjà noir sur blanc (`routers/guichet.py`) : « certains athlètes
--     ont des semaines de 9 jours ». Une grille bornée aux sept noms de la
--     semaine ne peut pas les porter.
--
-- ⚠️ CE N'EST QU'UN RENOMMAGE D'ÉTIQUETTES, et c'est ce qui le rend sûr. Le jour
-- de la répartition n'a JAMAIS été une date : aucun code des deux dépôts ne
-- dérive un jour de semaine d'une date (ni `getDay`, ni `EXTRACT(DOW)`). Il sert
-- à TROIS choses, toutes des comparaisons de chaînes : l'ordre des séances
-- (`generation_semaine.py`), le rattachement d'un accessoire à son jour
-- (`training_base_accessories.day`), et le NOM donné à la séance engendrée.
-- Rien ne change de sens ; seul le vocabulaire change.
--
-- ⚠️ L'ORDRE DU CYCLE EST CELUI DE LA SEMAINE, pas celui du stockage. La grille
-- se range dans n'importe quel ordre en base (une spec brokkr le prouve depuis
-- toujours : « Mercredi » stocké avant « Lundi » sort quand même en second).
-- C'est donc le rang du jour FRANÇAIS qui donne le numéro : Lundi → J1 …
-- Dimanche → J7. Mesuré le 20/09 en production : 181 blocs ont une base, tous
-- avec exactement les sept jours, aucun doublon, aucun nom hors de la liste —
-- la garde ci-dessous le revérifie au moment d'appliquer.
--
-- ⚠️ LES SÉANCES DÉJÀ ENGENDRÉES GARDENT LEUR NOM (2 773 s'appellent « Lundi »
-- … « Dimanche »), et c'est voulu : un nom de séance est un libellé libre, que
-- le coach peut avoir changé, et la semaine suivante se recopie par ce nom
-- (`semaine_suivante.py`). Les toucher, c'est réécrire l'historique des athlètes
-- pour un affichage. Les séances engendrées APRÈS cette migration s'appelleront
-- « J1 » … « Jn » ; les deux cohabitent sans se gêner.

BEGIN;

-- Le rang de chaque jour de la semaine — la table de conversion, et rien d'autre.
CREATE TEMP TABLE rang_du_jour (jour text PRIMARY KEY, n int NOT NULL) ON COMMIT DROP;
INSERT INTO rang_du_jour VALUES
  ('Lundi', 1), ('Mardi', 2), ('Mercredi', 3), ('Jeudi', 4),
  ('Vendredi', 5), ('Samedi', 6), ('Dimanche', 7);

-- ⚠️ LA GARDE COMPTE CE QU'ELLE NE SAIT PAS TRADUIRE, et s'arrête plutôt que de
-- poser un `null` dans une grille. Un jour inconnu produirait un `jsonb_set`
-- sans nom, donc une ligne que plus rien ne rattache à ses accessoires.
DO $$
DECLARE inconnus int; doublons int;
BEGIN
  SELECT count(*) INTO inconnus
    FROM training_blocks b, jsonb_array_elements(coalesce(b.day_split, '[]'::jsonb)) j
   WHERE NOT EXISTS (SELECT 1 FROM rang_du_jour r WHERE r.jour = j->>'day');
  IF inconnus > 0 THEN
    RAISE EXCEPTION 'Grilles : % jour(s) hors des sept noms de la semaine — à ranger avant de migrer.', inconnus;
  END IF;

  SELECT count(*) INTO inconnus
    FROM training_base_accessories a
   WHERE NOT EXISTS (SELECT 1 FROM rang_du_jour r WHERE r.jour = a.day);
  IF inconnus > 0 THEN
    RAISE EXCEPTION 'Accessoires : % jour(s) hors des sept noms de la semaine.', inconnus;
  END IF;

  -- Deux lignes du même jour fusionneraient en un seul J#, donc perdraient des tiers.
  SELECT count(*) INTO doublons FROM (
    SELECT b.id FROM training_blocks b, jsonb_array_elements(coalesce(b.day_split, '[]'::jsonb)) j
     GROUP BY b.id, j->>'day' HAVING count(*) > 1) x;
  IF doublons > 0 THEN
    RAISE EXCEPTION '% grille(s) portent deux fois le même jour.', doublons;
  END IF;
END $$;

-- 1. Les grilles : renumérotées DANS L'ORDRE DE LA SEMAINE.
UPDATE training_blocks b
   SET day_split = (
     SELECT jsonb_agg(jsonb_set(j, '{day}', to_jsonb('J' || r.n)) ORDER BY r.n)
       FROM jsonb_array_elements(b.day_split) j
       JOIN rang_du_jour r ON r.jour = j->>'day'
   )
 WHERE jsonb_array_length(coalesce(b.day_split, '[]'::jsonb)) > 0;

-- 2. Les accessoires, qui se rattachent à leur jour par ÉGALITÉ DE CHAÎNE
--    (`generation_semaine.py`) : sans eux, 2 257 accessoires deviendraient
--    orphelins d'une grille qui ne parle plus leur langue.
UPDATE training_base_accessories a
   SET day = 'J' || r.n
  FROM rang_du_jour r
 WHERE r.jour = a.day;

-- La vérification de sortie : plus un seul nom de semaine, ni d'un côté ni de l'autre.
DO $$
DECLARE restants int;
BEGIN
  SELECT (SELECT count(*) FROM training_blocks b, jsonb_array_elements(coalesce(b.day_split, '[]'::jsonb)) j
           WHERE j->>'day' !~ '^J[0-9]+$')
       + (SELECT count(*) FROM training_base_accessories WHERE day !~ '^J[0-9]+$')
    INTO restants;
  IF restants > 0 THEN
    RAISE EXCEPTION 'Migration incomplète : % ligne(s) ne portent pas un jour de cycle.', restants;
  END IF;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-20_repartition_du_cycle.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
