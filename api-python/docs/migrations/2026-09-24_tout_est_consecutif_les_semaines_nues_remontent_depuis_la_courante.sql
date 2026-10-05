-- TOUT EST CONSÉCUTIF : LES SEMAINES NUES REMONTENT DEPUIS LA COURANTE (FRE-138).
--
-- La règle, posée par William le 24/09 : dès qu'un bloc se finit, on part sur
-- un autre, pour tous les athlètes ; les semaines font sept jours et
-- s'enchaînent. La semaine courante va du 21 au 27 septembre 2026. Partant de
-- là, les bornes de toute semaine nue se déduisent :
--
--   · un bloc nu qu'un bloc daté SUIT finit la veille de ce bloc, et ses
--     semaines remontent de sept en sept ;
--   · un bloc nu qu'aucun bloc daté ne suit, dans un programme qui en a un
--     AVANT, commence le lendemain de la dernière semaine datée ;
--   · un bloc nu dans un programme SANS aucune semaine datée finit avec la
--     semaine courante : sa dernière semaine est celle du 21 au 27 septembre.
--
-- Plusieurs blocs nus à la suite se remontent l'un après l'autre. S1 de la
-- trame prend les dates de la semaine 1 posée, pour que la mécanique continue.
--
-- Périmètre : les athlètes non archivés, et les programmes dont aucune semaine
-- datée ne dépasse sept jours — un programme aux « semaines » d'un mois ne
-- suit pas la règle, et n'est pas touché. Une semaine plus COURTE (un bloc
-- parti un mardi) reste une semaine. Un bloc n'est « nu » que si AUCUNE de ses
-- semaines n'a de date ; un bloc à demi daté n'est pas touché.
--
-- Après coup : aucun chevauchement dans un bloc, et chaque semaine posée fait
-- sept jours — sinon tout est annulé.

BEGIN;

DO $$
DECLARE
  prog        record;
  bloc        record;
  n           integer;
  debut       date;
  fin         date;
  prochain    date;      -- début du bloc qui suit (daté ou tout juste posé)
  fin_d_avant date;      -- fin de la dernière semaine datée AVANT le bloc
  a_des_dates boolean;
  posees      integer := 0;
  blocs_poses integer := 0;
  chevauche   integer;
  mal_taillee integer;
BEGIN
  CREATE TEMP TABLE posees_ici (week_id uuid PRIMARY KEY) ON COMMIT DROP;

  FOR prog IN
    SELECT p.id
    FROM programs p JOIN athletes a ON a.id = p.athlete_id
    WHERE a.archive_le IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM training_weeks w JOIN training_blocks b ON b.id = w.block_id
        JOIN training_macros m ON m.id = b.macro_id
        WHERE m.program_id = p.id AND w.start_date IS NOT NULL
          AND (w.end_date IS NULL OR w.end_date - w.start_date > 6))
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM training_weeks w JOIN training_blocks b ON b.id = w.block_id
      JOIN training_macros m ON m.id = b.macro_id
      WHERE m.program_id = prog.id AND w.start_date IS NOT NULL) INTO a_des_dates;

    prochain := NULL;
    FOR bloc IN
      SELECT b.id, m.number AS mn, b.number AS bn,
             (SELECT count(*) FROM training_weeks w WHERE w.block_id = b.id) AS semaines,
             (SELECT min(start_date) FROM training_weeks w WHERE w.block_id = b.id) AS debut_date,
             (SELECT bool_and(start_date IS NULL AND end_date IS NULL)
                FROM training_weeks w WHERE w.block_id = b.id) AS nu
      FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id
      WHERE m.program_id = prog.id
      ORDER BY m.number DESC, b.number DESC
    LOOP
      IF bloc.semaines = 0 THEN
        CONTINUE;
      END IF;
      IF NOT bloc.nu THEN
        prochain := bloc.debut_date;
        CONTINUE;
      END IF;
      n := bloc.semaines;

      IF prochain IS NOT NULL THEN
        fin := prochain - 1;
        debut := fin - 7 * n + 1;
      ELSIF a_des_dates THEN
        SELECT max(w.end_date) INTO fin_d_avant
        FROM training_weeks w JOIN training_blocks b2 ON b2.id = w.block_id
        JOIN training_macros m2 ON m2.id = b2.macro_id
        WHERE m2.program_id = prog.id AND (m2.number, b2.number) < (bloc.mn, bloc.bn);
        IF fin_d_avant IS NULL THEN
          -- Un bloc nu au-dessus de tout bloc daté : rien devant, rien derrière.
          CONTINUE;
        END IF;
        debut := fin_d_avant + 1;
        fin := debut + 7 * n - 1;
      ELSE
        fin := DATE '2026-09-27';
        debut := fin - 7 * n + 1;
      END IF;

      UPDATE training_weeks w
         SET start_date = debut + 7 * (r.rang - 1),
             end_date   = debut + 7 * r.rang - 1
        FROM (SELECT id, row_number() OVER (ORDER BY number)::int AS rang
                FROM training_weeks w2 WHERE w2.block_id = bloc.id) r
       WHERE w.id = r.id;
      INSERT INTO posees_ici SELECT id FROM training_weeks WHERE block_id = bloc.id;
      posees := posees + n;
      blocs_poses := blocs_poses + 1;

      UPDATE training_blocks SET s1_start_date = debut, s1_end_date = debut + 6
       WHERE id = bloc.id;

      prochain := debut;
    END LOOP;
  END LOOP;

  SELECT count(*) INTO chevauche
    FROM training_weeks a JOIN training_weeks b ON b.block_id = a.block_id AND b.id <> a.id
   WHERE a.start_date IS NOT NULL AND b.start_date IS NOT NULL
     AND a.start_date <= b.end_date AND b.start_date <= a.end_date;
  SELECT count(*) INTO mal_taillee
    FROM training_weeks w JOIN posees_ici p ON p.week_id = w.id
   WHERE w.end_date - w.start_date <> 6;
  IF chevauche > 0 OR mal_taillee > 0 THEN
    RAISE EXCEPTION '% chevauchements, % semaines mal taillées — migration annulée.', chevauche, mal_taillee;
  END IF;
  RAISE NOTICE '% semaines datées dans % blocs.', posees, blocs_poses;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-24_tout_est_consecutif_les_semaines_nues_remontent_depuis_la_courante.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
