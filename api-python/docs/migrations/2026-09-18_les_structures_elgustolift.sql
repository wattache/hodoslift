-- UNE TROISIÈME STRUCTURE : ELGUSTOLIFT, les athlètes que William coache (FRE-13).
--
-- Demandé par William le 18/09. Joue APRÈS `2026-09-18_les_structures.sql` —
-- l'ordre est celui du nom, et « les_structures.sql » précède
-- « les_structures_elgustolift.sql » (`.` avant `_`).
--
-- Ce qui passe ElGustoLift : sa ligne COACH, sa ligne KINÉ (il ne suit que ses
-- propres athlètes), et les fiches qu'il COACHE. Ce qui reste French Forge : SA
-- fiche d'athlète (coachée par Aubin), et les compétitions qu'il a créées — leurs
-- participants sont mêlés à ceux d'Aubin et de Théo, et un meet partagé se lit
-- par ses participants (`competitions.py`), pas par sa structure.
--
-- ⚠️ L'INVARIANT `fiche_dans_la_structure_de_son_coach` tient après : ses fiches
-- suivent sa ligne coach dans la même transaction.

BEGIN;

INSERT INTO structures (slug, nom) VALUES ('elgustolift', 'ElGustoLift')
ON CONFLICT (slug) DO NOTHING;

UPDATE coaches  SET structure = 'elgustolift' WHERE uid = 's6BEEJn6v2aA1HphGIQRIh33xqr1';
UPDATE kines    SET structure = 'elgustolift' WHERE uid = 's6BEEJn6v2aA1HphGIQRIh33xqr1';
UPDATE athletes SET structure = 'elgustolift' WHERE coach_uid = 's6BEEJn6v2aA1HphGIQRIh33xqr1';

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-18_les_structures_elgustolift.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
