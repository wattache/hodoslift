-- Théo Goutte-toquet : les données de la fiche pro passent sur sa fiche perso.
--
-- Deux fiches, toutes deux coachées par lui : `IE6LcTiEwqBpYYfAdf9w`
-- (theogoutte69@gmail.com, liée à son compte, ses compétitions et son programme)
-- et `K0bULDmaiFOiK3V6XOp0` (theogtpro@gmail.com, jamais connectée, un programme
-- vide). Demandé par William le 16/10.
--
-- Passent sur la perso : les records manuels (déplacés), le profil (nom, poids,
-- taille, naissance — là où la perso n'en a pas), et le 1RM, le plus lourd des
-- deux par mouvement. La fiche pro est ARCHIVÉE, pas supprimée.
BEGIN;

UPDATE athlete_prs
   SET athlete_id = (SELECT id FROM athletes WHERE legacy_id = 'IE6LcTiEwqBpYYfAdf9w')
 WHERE athlete_id = (SELECT id FROM athletes WHERE legacy_id = 'K0bULDmaiFOiK3V6XOp0');

UPDATE athletes perso
   SET first_name     = pro.first_name,
       last_name      = pro.last_name,
       weight_kg      = coalesce(perso.weight_kg, pro.weight_kg),
       height_cm      = coalesce(perso.height_cm, pro.height_cm),
       birth_date     = coalesce(perso.birth_date, pro.birth_date),
       current_one_rm = (
         SELECT jsonb_object_agg(k, greatest((coalesce(perso.current_one_rm, '{}') ->> k)::numeric,
                                             (coalesce(pro.current_one_rm, '{}') ->> k)::numeric))
           FROM (SELECT jsonb_object_keys(coalesce(perso.current_one_rm, '{}')) AS k
                 UNION SELECT jsonb_object_keys(coalesce(pro.current_one_rm, '{}'))) cles)
  FROM athletes pro
 WHERE perso.legacy_id = 'IE6LcTiEwqBpYYfAdf9w' AND pro.legacy_id = 'K0bULDmaiFOiK3V6XOp0';

UPDATE athletes SET archive_le = clock_timestamp()
 WHERE legacy_id = 'K0bULDmaiFOiK3V6XOp0' AND archive_le IS NULL;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-16_theo_une_seule_fiche.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
