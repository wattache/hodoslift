-- L'UNICITÉ DE `users.email` NE PROTÈGE RIEN, ET REND UN 500 (FRE-77).
--
-- `_UPSERT_ME_SQL` fait `ON CONFLICT (uid) DO NOTHING` — la clé primaire, donc.
-- Un uid Firebase NEUF portant un email DÉJÀ présent frappe alors
-- `users_email_key`, pas `users_pkey` : UniqueViolation → IntegrityError → 500
-- sur `GET /users/me`, c'est-à-dire la toute première route que le front appelle
-- après la connexion. La personne voit « Serveur injoignable » — un message qui
-- suggère un incident passager alors que la panne est PERMANENTE pour elle.
--
-- ⚠️ MESURÉ AVANT DE RETIRER, sur Neon le 22/08 :
--
--   users .......................... 67
--   emails en double ............... aucun
--   email vide ('') ou NULL ........ aucun
--   requêtes qui lisent `users` PAR EMAIL ...... AUCUNE
--
-- Ce dernier point est le seul qui décide. `uid` est la clé ; l'email n'est
-- qu'un attribut affiché (annuaire admin, nom d'un coach à défaut de
-- `display_name`). Aucune règle métier ne s'appuie sur son unicité — la
-- contrainte n'avait donc qu'un effet observable, ce 500.
--
-- ⚠️ ET FIREBASE, LUI, AUTORISE LE PARTAGE. Deux comptes peuvent porter la même
-- adresse (fournisseurs différents, compte recréé). Une base qui l'interdit
-- pendant que la source d'identité l'autorise ne fait pas respecter une règle :
-- elle refuse de représenter la réalité.
--
-- ⚠️ `NOT NULL` RESTE. Le retirer ouvrirait le défaut le plus récurrent de ce
-- projet — `''` et NULL confondus à une frontière — pour rien : `MoiLu.email`
-- est un `str`, le routeur écrit `''` à défaut, et l'unicité partie, dix comptes
-- sans adresse peuvent désormais coexister avec le même `''`.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

COMMIT;

-- Vérification :
--
--   SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass;
--   → users_pkey, et plus users_email_key.
