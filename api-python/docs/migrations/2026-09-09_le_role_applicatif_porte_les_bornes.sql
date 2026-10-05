-- LE RÔLE APPLICATIF PORTE LES BORNES, LUI AUSSI (FRE-151).
--
-- ⚠️ CETTE MIGRATION RÉPARE UNE RÉGRESSION QUE LA BASCULE A CAUSÉE, le 09/09.
--    Le service est passé de `brokkr` à `brokkr_app` ; or les bornes de session
--    vivent sur le RÔLE (`…_les_bornes_de_session_vivent_sur_le_role.sql`), et
--    `brokkr_app` venait de naître sans aucune. Mesuré juste après le
--    déploiement :
--
--        statement_timeout : attendu '15s', reçu '0'
--        lock_timeout      : attendu '5s',  reçu '0'
--        TimeZone          : attendu 'Europe/Paris', reçu 'GMT'
--
--    C'est-à-dire une production sans plafond de requête — exactement l'état du
--    08/09, pour une cause différente.
--
-- ⚠️ CE QUI L'A VUE, ET C'EST LE POINT À RETENIR : `make verifier`, qui lit
--    `/health/db` APRÈS le déploiement et compare ce que brokkr REÇOIT à
--    `BORNES_DU_ROLE` (FRE-154). Ni pytest ni les invariants ne pouvaient le
--    voir : les deux tournent sous un autre rôle que celui de la production.
--    Une garde qui n'existait pas il y a deux jours a rattrapé la faute le jour
--    même.
--
-- ⚠️ LE NOM EST EN DUR, contrairement au `CURRENT_USER` de la migration des
--    bornes — et c'est délibéré. Elle visait le rôle qui joue la migration ;
--    celle-ci vise un rôle PRÉCIS, qui n'est jamais celui qui la joue (les
--    migrations passent par `brokkr`). Le bloc conditionnel évite qu'elle
--    échoue là où ce rôle n'existe pas : bac à sable, pytest, poste de dev.
--
-- Ce que chaque borne vaut, et pourquoi : `app/db.py`, `BORNES_DU_ROLE`.
-- Le rôle lui-même : `nidavellir/sql/brokkr_app.sql`.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brokkr_app') THEN
    EXECUTE 'ALTER ROLE brokkr_app SET statement_timeout = ''15s''';
    EXECUTE 'ALTER ROLE brokkr_app SET lock_timeout      = ''5s''';
    EXECUTE 'ALTER ROLE brokkr_app SET timezone          = ''Europe/Paris''';
  ELSE
    RAISE NOTICE 'rôle brokkr_app absent : rien à borner (bac à sable, pytest)';
  END IF;
END
$$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-09_le_role_applicatif_porte_les_bornes.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION — elle demande une NOUVELLE connexion : un `ALTER ROLE` ne change
-- rien à la session en cours, ni à celles que Cloud Run tient déjà ouvertes.
--
--   cd brokkr && make verifier SHA=<le sha déployé>
--
-- Les trois bornes doivent ressortir. Elles arrivent aux connexions NEUVES : si
-- le service tient encore des connexions d'avant, laisser passer un moment, ou
-- redéployer pour repartir sur des backends propres.
