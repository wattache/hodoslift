-- LES SEPT VUES DU 09/10 SONT VISIBLES DE L'APPLICATION. `brokkr_app` ne sait
-- lire que ce qu'on lui a nommé (`infra/sql/brokkr_app.sql`) : une vue créée
-- sans son GRANT existe pour le propriétaire et pour personne d'autre — et
-- `/users/me`, qui lit `comptes`, rendait 500 à chaque personne connectée.
--
-- ⚠️ TOUTE VUE OU TABLE NOUVELLE PORTE SON GRANT DANS SA MIGRATION. Le bac à
-- sable et les tests tournent en superutilisateur : ils ne voient pas un
-- droit manquant ; la production, si.

BEGIN;

GRANT SELECT ON comptes, liens_athlete, signalements,
                blocs_lus, semaines_lues, series_realisees, series_de_travail
TO brokkr_app;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-09_vues_visibles_a_l_application.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
