-- LES SEMAINES ET LEURS SÉANCES ONT LEURS DATES (FRE-138, point 1 : la reprise unique).
--
-- Une semaine ou une séance sans date n'entre dans aucune courbe du suivi : ni
-- agrégat hebdo, ni RPE par bloc, ni calibrage. Deux reprises, dans cet ordre,
-- chacune là où la date est SÛRE ; le reste n'est pas deviné.
--
-- 1. LES SEMAINES. Une semaine sans date se date par ses voisines, quand elles
--    la CORROBORENT :
--    · un bloc dont aucune semaine n'est datée, encadré dans son programme par
--      un bloc daté avant et un bloc daté après, sans autre bloc nu entre eux,
--      et dont le trou vaut EXACTEMENT sept jours par semaine : les semaines
--      s'y enchaînent, la première le lendemain du bloc d'avant ;
--    · une semaine sans date dans un bloc dont les semaines datées font sept
--      jours et s'enchaînent par numéro : elle prend sa place dans la suite.
--    Une seule ancre ne suffit pas : mesuré le 24/09, 4 blocs nus sur 14 à deux
--    ancres ont un trou qui ne vaut PAS sept jours par semaine (une coupure
--    entre deux blocs). Dater par un seul voisin se tromperait une fois sur
--    trois, et une fausse date vaut moins qu'une absence.
--
-- 2. LES SÉANCES. La règle qui date une séance à sa création
--    (`generation_semaine.date_du_jour`, `semaine_suivante`) est
--        date = début de la semaine + (rang du jour − 1)
--    la date PRÉVUE, pas celle où l'athlète s'est entraîné. Appliquée ici à
--    toute séance sans date dont la semaine est datée, commence un lundi, dure
--    sept jours, et dont le nom dit le jour : Lundi … Dimanche (l'usage des
--    coachs), ou J1 … J7. La date posée tombe donc toujours DANS la semaine.
--
-- Éprouvé le 24/09 sur une copie de la production de la veille, corps joué dans
-- une transaction annulée : 41 semaines (40 par encadrement dans 10 blocs, 1 par
-- ses sœurs), puis 1 668 séances, dont 151 dans les semaines reprises. Restent
-- sans date, hors les « semaines » longues de Maxime : 75 semaines qu'aucun
-- voisin ne corrobore — le coach les date en posant les dates de S1 dans la
-- trame, qui se propagent au bloc — et les séances au nom libre (« SQUAT 1 »,
-- « Push »…) ou hors semaine du lundi.
--
-- Vérification attendue après coup : la semaine en cours des athlètes de Théo
-- et d'Aubin va du 21 au 27 septembre 2026, et leurs séances aussi.

BEGIN;

-- 1a. Les blocs nus encadrés par deux blocs datés, au trou exact.
DO $$
DECLARE
  candidates integer;
  posees     integer;
BEGIN
  CREATE TEMP TABLE encadres ON COMMIT DROP AS
  WITH blocs AS (
    SELECT b.id, m.program_id, m.number AS mn, b.number AS bn,
           (SELECT count(*) FROM training_weeks w WHERE w.block_id = b.id) AS semaines,
           (SELECT min(start_date) FROM training_weeks w WHERE w.block_id = b.id) AS debut,
           (SELECT max(end_date) FROM training_weeks w WHERE w.block_id = b.id) AS fin,
           (SELECT bool_and(start_date IS NULL AND end_date IS NULL)
              FROM training_weeks w WHERE w.block_id = b.id) AS nu
    FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id),
  ordonnes AS (
    SELECT *, row_number() OVER (PARTITION BY program_id ORDER BY mn, bn) AS i FROM blocs),
  nus AS (
    SELECT o.id, o.semaines,
           (SELECT max(i) FROM ordonnes a WHERE a.program_id = o.program_id AND a.i < o.i AND a.fin IS NOT NULL) AS i_avant,
           (SELECT min(i) FROM ordonnes a WHERE a.program_id = o.program_id AND a.i > o.i AND a.debut IS NOT NULL) AS i_apres,
           o.program_id, o.i
    FROM ordonnes o WHERE o.nu AND o.semaines > 0)
  SELECT n.id AS block_id, n.semaines, av.fin AS fin_avant, ap.debut AS debut_apres
  FROM nus n
  JOIN ordonnes av ON av.program_id = n.program_id AND av.i = n.i_avant
  JOIN ordonnes ap ON ap.program_id = n.program_id AND ap.i = n.i_apres
  WHERE NOT EXISTS (SELECT 1 FROM ordonnes x WHERE x.program_id = n.program_id
                     AND x.i > n.i_avant AND x.i < n.i_apres AND x.i <> n.i AND x.nu AND x.semaines > 0)
    AND ap.debut - av.fin - 1 = 7 * n.semaines;

  SELECT count(*) INTO candidates FROM training_weeks w JOIN encadres e ON e.block_id = w.block_id;

  UPDATE training_weeks w
     SET start_date = e.fin_avant + 1 + 7 * (r.rang - 1),
         end_date   = e.fin_avant + 7 * r.rang
    FROM encadres e,
         LATERAL (SELECT id, row_number() OVER (ORDER BY number)::int AS rang
                    FROM training_weeks w2 WHERE w2.block_id = e.block_id) r
   WHERE w.block_id = e.block_id AND w.id = r.id;
  GET DIAGNOSTICS posees = ROW_COUNT;

  IF posees <> candidates THEN
    RAISE EXCEPTION '1a : % semaines candidates, % datées — migration annulée.', candidates, posees;
  END IF;
  RAISE NOTICE '1a : % semaines datées par encadrement (% blocs).', posees, (SELECT count(*) FROM encadres);
END $$;

-- 1b. Les semaines sans date dans un bloc dont les sœurs datées s'enchaînent.
DO $$
DECLARE
  candidates integer;
  posees     integer;
BEGIN
  CREATE TEMP TABLE suites ON COMMIT DROP AS
  WITH origines AS (
    SELECT block_id, min(start_date) AS origine, min(number) AS numero_origine
    FROM training_weeks WHERE start_date IS NOT NULL GROUP BY block_id)
  SELECT o.* FROM origines o
  WHERE NOT EXISTS (
    SELECT 1 FROM training_weeks w
    WHERE w.block_id = o.block_id AND w.start_date IS NOT NULL
      AND (w.end_date IS NULL OR w.end_date - w.start_date <> 6
           OR w.start_date <> o.origine + 7 * (w.number - o.numero_origine)));

  SELECT count(*) INTO candidates FROM training_weeks w JOIN suites s ON s.block_id = w.block_id
   WHERE w.start_date IS NULL AND w.end_date IS NULL;

  UPDATE training_weeks w
     SET start_date = s.origine + 7 * (w.number - s.numero_origine),
         end_date   = s.origine + 7 * (w.number - s.numero_origine) + 6
    FROM suites s
   WHERE s.block_id = w.block_id AND w.start_date IS NULL AND w.end_date IS NULL;
  GET DIAGNOSTICS posees = ROW_COUNT;

  IF posees <> candidates THEN
    RAISE EXCEPTION '1b : % semaines candidates, % datées — migration annulée.', candidates, posees;
  END IF;
  RAISE NOTICE '1b : % semaines datées par leurs sœurs.', posees;
END $$;

-- Après coup : dans un bloc, deux semaines datées ne se chevauchent jamais.
DO $$
DECLARE chevauchements integer;
BEGIN
  SELECT count(*) INTO chevauchements
    FROM training_weeks a JOIN training_weeks b ON b.block_id = a.block_id AND b.id <> a.id
   WHERE a.start_date IS NOT NULL AND b.start_date IS NOT NULL
     AND a.start_date <= b.end_date AND b.start_date <= a.end_date;
  IF chevauchements > 0 THEN
    RAISE EXCEPTION '% chevauchements de semaines dans un même bloc — migration annulée.', chevauchements;
  END IF;
END $$;

-- 2. Les séances.
DO $$
DECLARE
  candidates integer;
  posees     integer;
BEGIN
  SELECT count(*) INTO candidates
    FROM training_sessions s JOIN training_weeks w ON w.id = s.week_id
   WHERE s.session_date IS NULL
     AND w.start_date IS NOT NULL AND w.end_date - w.start_date = 6
     AND extract(isodow FROM w.start_date) = 1
     AND lower(btrim(s.name)) IN ('lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche',
                                  'j1','j2','j3','j4','j5','j6','j7');

  UPDATE training_sessions s
     SET session_date = w.start_date + (
           CASE lower(btrim(s.name))
             WHEN 'lundi'    THEN 1 WHEN 'mardi'  THEN 2 WHEN 'mercredi' THEN 3
             WHEN 'jeudi'    THEN 4 WHEN 'vendredi' THEN 5 WHEN 'samedi' THEN 6
             WHEN 'dimanche' THEN 7
             WHEN 'j1' THEN 1 WHEN 'j2' THEN 2 WHEN 'j3' THEN 3 WHEN 'j4' THEN 4
             WHEN 'j5' THEN 5 WHEN 'j6' THEN 6 WHEN 'j7' THEN 7
           END - 1)
    FROM training_weeks w
   WHERE w.id = s.week_id
     AND s.session_date IS NULL
     AND w.start_date IS NOT NULL AND w.end_date - w.start_date = 6
     AND extract(isodow FROM w.start_date) = 1
     AND lower(btrim(s.name)) IN ('lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche',
                                  'j1','j2','j3','j4','j5','j6','j7');
  GET DIAGNOSTICS posees = ROW_COUNT;

  IF posees <> candidates THEN
    RAISE EXCEPTION '% séances candidates, % datées — migration annulée.', candidates, posees;
  END IF;
  RAISE NOTICE '% séances datées.', posees;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-24_les_semaines_et_leurs_seances_ont_leurs_dates.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
