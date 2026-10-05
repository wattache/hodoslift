-- LES BORNES DE SESSION VIVENT SUR LE RÔLE, PAS DANS LA CONNEXION (FRE-135).
--
-- ⚠️ CETTE MIGRATION RÉPARE UNE PANNE DE PRODUCTION QUE J'AI CAUSÉE LE 08/09.
--    `app/db.py` posait `statement_timeout`, `lock_timeout` et `timezone` par
--    `connect_args={"options": "-c …"}`. Le POOLER de Neon (PgBouncer) refuse ce
--    paramètre à l'ouverture :
--
--        unsupported startup parameter in options: statement_timeout
--
--    Plus aucune connexion ne s'établissait. Le front affichait « Serveur
--    injoignable », et `/health` restait VERT — il ne touche pas la base. C'est
--    `/health/db` qui disait 503.
--
-- ⚠️ AUCUN HARNAIS NE POUVAIT LE VOIR, ET C'EST LA VRAIE LEÇON. pytest monte un
--    Postgres DIRECT (testcontainers), le bac à sable est DIRECT, le `.env` local
--    vise l'hôte DIRECT. Seule la production passe par le pooler. La spec écrite
--    pour ces options prouvait que « Postgres les accepte » — vrai, et hors sujet.
--    Elle ne traversait pas le chemin où le défaut vit.
--
-- ⚠️ ET UN `SET` À LA CONNEXION N'AURAIT PAS MARCHÉ NON PLUS. Le pooler est en
--    mode TRANSACTION : la connexion serveur change d'un appel à l'autre, donc un
--    réglage posé à l'ouverture d'une session cliente ne la suit pas.
--
--    `ALTER ROLE … SET`, lui, est appliqué par POSTGRES à chaque backend, y
--    compris ceux que le pooler ouvre — et le `DISCARD ALL` qu'il joue entre deux
--    transactions rétablit ces défauts au lieu de les perdre. C'est le seul des
--    trois mécanismes qui traverse un pooler en mode transaction.
--
-- ⚠️ `CURRENT_USER` ET PAS `brokkr` EN DUR : la production tourne sous `brokkr`,
--    le bac à sable et pytest sous `postgres`. Nommer le rôle ferait échouer la
--    migration partout ailleurs qu'en production — ou pire, la ferait porter sur
--    un rôle que personne n'utilise.
--
-- Ce que chaque borne vaut, et pourquoi : voir `app/db.py`, `BORNES_DU_ROLE`.
-- Ce qui les VÉRIFIE : l'invariant `bornes_de_session` (`make invariants`).

BEGIN;

ALTER ROLE CURRENT_USER SET statement_timeout = '15s';
ALTER ROLE CURRENT_USER SET lock_timeout      = '5s';
ALTER ROLE CURRENT_USER SET timezone          = 'Europe/Paris';

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-09_les_bornes_de_session_vivent_sur_le_role.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;


-- ⚠️ MESURÉ APRÈS COUP, ET ÇA NE SUFFIT PAS : le pooler ne propage pas les
--    défauts de rôle. Une connexion DIRECTE reçoit bien 15s / 5s / Europe/Paris ;
--    par le pooler, la même lecture rend 0 / 0 / GMT.
--
--    Cette migration reste utile — elle borne les connexions directes, donc les
--    migrations et les scripts de mesure — mais elle NE BORNE PAS la production.
--    Ne pas la lire comme si le sujet était clos : voir `app/db.py`.
--
-- VÉRIFICATION, après le COMMIT — et elle demande une NOUVELLE connexion :
-- un `ALTER ROLE` ne change rien à la session en cours.
--
--   make invariants        → `bornes_de_session` à zéro.
--
-- Et par le chemin de la PRODUCTION, c'est-à-dire le pooler :
--
--   psql "$DATABASE_URL_POOLER" -c "SHOW statement_timeout; SHOW TimeZone;"
