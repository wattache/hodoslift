-- Migration : coach_profiles — profil PUBLIC d'un coach, éditable depuis l'app (FRE-30).
--
-- CONTEXTE. Les pages coach de french-forge.com lisaient un fichier statique figé
-- au build (eitri/landing/coachs.js). On rend le coach autonome : il édite son
-- profil depuis l'app, le site vitrine lit cette table via une route PUBLIQUE.
--
-- ⚠️ INVARIANT DE SÉCURITÉ. Cette table est lue SANS authentification. Elle est
-- sûre pour une seule raison : elle ne contient QUE du public. La route ne filtre
-- rien, ne joint jamais `athletes`. La redondance (1RM recopiés ici, pas joints)
-- EST le mécanisme — une jointure « plus propre » sur athletes finirait par
-- exposer un champ privé ajouté six mois plus tard.
--
-- coach_uid : colonne PROPRIÉTAIRE (contrôle d'identité du PATCH + cible de la
--   projection des 1RM). PK → un profil par coach.
-- slug : clé PUBLIQUE (l'URL du site), UNIQUE.
-- one_rm : PROJECTION de athletes.current_one_rm (le coach est un athlète via
--   athletes.user_uid = coaches.uid), rafraîchie par le job nocturne
--   training-analytics-refresh. Clés : muscleUp/pullUp/chinUp/dip/squat.
-- Les autres champs sont écrits directement par le coach (frais à la seconde).
--
-- Pas de champ vidéo ni de témoignages : ils restent dans coachs.js (figés au
-- build) — décision explicite FRE-30.
--
-- ⚠️ ÉTAT D'APPLICATION : PAS ENCORE APPLIQUÉE au 2026-08-13. À jouer sur Neon
-- AVANT le déploiement de brokkr — l'ORDRE INVERSE des migrations additives
-- précédentes, et c'est délibéré. Ici le code SUPPOSE la table existante :
--   - le job nocturne `training-analytics-refresh` tourne sur la MÊME image que le
--     service (local.brokkr_image dans nidavellir/analytics.tf) : déployer brokkr
--     met aussi à jour le job. Sans la table, la projection des 1RM lève à 03:30
--     Europe/Paris et le job sort en échec (les 7 000 lignes de `training_sets`
--     sont préservées — la projection a sa propre transaction, cf. ci-dessous),
--     mais la page vitrine reste sans 1RM jusqu'à la prochaine nuit ;
--   - la route publique GET /coach-profiles/{slug} lève un 500 sur une table
--     absente, alors que le site vitrine l'appelle dès le déploiement.
-- Migration D'ABORD, déploiement ENSUITE : la table vide est inerte pour le code
-- en place (personne ne la lit avant la nouvelle image). Une colonne ajoutée à
-- une table existante tolère l'ordre inverse ; une table dont dépend le code
-- déployé, non — c'est la classe d'erreur de l'incident `repsUnit` du 11 août.
-- Non destructive (table neuve).

BEGIN;

CREATE TABLE coach_profiles (
    coach_uid  text PRIMARY KEY REFERENCES coaches(uid) ON DELETE CASCADE,
    slug       text NOT NULL UNIQUE,
    accroche   text,
    bio        text,
    instagram  text,
    photo_url  text,
    one_rm     jsonb
);

COMMIT;
