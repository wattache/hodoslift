-- LA TRAME PORTE LES DATES DE SA SEMAINE 1 (FRE-138).
--
-- Les dates de S1 dans la BASE sont ce dont toute la mécanique part : la
-- génération et « + Semaine » les exigent, et le front en déroule les dates
-- de chaque semaine du bloc. Un bloc dont les semaines sont datées mais dont
-- la trame ne porte pas S1 est un bloc d'avant la règle : ses dates existent,
-- au mauvais endroit.
--
-- Ce fichier pose S1 = la semaine 1 du bloc (sa première par numéro), là où
-- elle porte un début ET une fin, et où la trame n'a pas ses deux dates. Rien
-- d'autre : un bloc sans semaine datée n'a pas de S1 à déduire, et reste au
-- coach.
--
-- Population témoin, relevée le 24/09 en lecture seule : sur 147 blocs qui
-- portent S1 et une semaine 1 datée, 144 ont S1 = semaine 1 ; les trois autres
-- s'en écartent d'une ou quatre semaines. Candidats par ce critère : 27 blocs
-- (19 d'Aubin, 8 de William). 20 blocs restent sans S1, sans aucune semaine
-- datée.

BEGIN;

DO $$
DECLARE
  candidats integer;
  posees    integer;
BEGIN
  SELECT count(*) INTO candidats
    FROM training_blocks b
    JOIN LATERAL (SELECT start_date, end_date FROM training_weeks w
                   WHERE w.block_id = b.id ORDER BY number LIMIT 1) s1 ON true
   WHERE (b.s1_start_date IS NULL OR b.s1_end_date IS NULL)
     AND s1.start_date IS NOT NULL AND s1.end_date IS NOT NULL;

  UPDATE training_blocks b
     SET s1_start_date = s1.start_date,
         s1_end_date   = s1.end_date
    FROM (SELECT DISTINCT ON (block_id) block_id, start_date, end_date
            FROM training_weeks ORDER BY block_id, number) s1
   WHERE s1.block_id = b.id
     AND (b.s1_start_date IS NULL OR b.s1_end_date IS NULL)
     AND s1.start_date IS NOT NULL AND s1.end_date IS NOT NULL;
  GET DIAGNOSTICS posees = ROW_COUNT;

  IF posees <> candidats THEN
    RAISE EXCEPTION '% blocs candidats, % trames datées — migration annulée.', candidats, posees;
  END IF;
  RAISE NOTICE '% trames portent désormais les dates de leur semaine 1.', posees;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-24_la_trame_porte_les_dates_de_sa_semaine_1.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
