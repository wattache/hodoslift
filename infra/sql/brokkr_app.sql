-- LE RÔLE APPLICATIF, QUI NE PEUT NI CRÉER DE RÔLE NI SUPPRIMER DE TABLE (FRE-151)
--
-- `brokkr` est le rôle que l'APPLICATION utilise à chaque requête, et il peut
-- créer des rôles, créer des bases, ignorer la RLS et — via `neon_superuser` —
-- supprimer n'importe quelle table. `brokkr_app` ne sait que lire et écrire des
-- lignes, sur les tables NOMMÉES ici. `brokkr` reste propriétaire des objets et
-- sert aux migrations.
--
-- ⚠️ EN SQL, ET SURTOUT PAS PAR `neon_role`. Tout rôle créé par le provider Neon
-- devient membre de `neon_superuser`, appartenance que `brokkr` ne peut pas
-- révoquer (essayé le 27/08, refusé). Ce serait un rôle « sans pouvoir » capable
-- de tout supprimer — exactement `analytics_ro`, qui a annoncé pendant quatre
-- semaines une lecture seule qui n'avait jamais existé (FRE-112, voir `neon.tf`).
--
-- ⚠️ TABLE PAR TABLE, ET PAS `ON ALL TABLES` — décision de William, 09/09. Le
-- privilège se lit alors dans ce fichier, sans avoir à interroger la base. Le
-- prix est une DISCIPLINE : toute migration qui crée une table doit poser son
-- propre `GRANT … TO brokkr_app`, sinon la table est invisible à l'application —
-- et ça ne se voit pas au déploiement, ça se voit au premier appel de la route,
-- en 500, découvert par un coach.
--
-- Deux gardes tiennent cette discipline, parce qu'une consigne ne tient rien :
--   · `tests/test_migrer.py` refuse une migration qui crée une table sans son
--     GRANT — donc `make test`, avant que le fichier ne parte ;
--   · l'invariant `privileges_du_role_applicatif` compte les relations que le
--     rôle ne peut pas toucher — donc `make invariants`, que `make deploy` joue.
--
-- À COLLER dans la console Neon, connecté en `brokkr` sur `french_forge_trainer`.
-- Remplacer <MOT_DE_PASSE> par `terraform -chdir=nidavellir output -raw
-- brokkr_app_password`. Ne jamais écrire la valeur dans ce fichier.
--
-- ⚠️ CE QUE CE RÔLE NE PROTÈGE PAS : le `.env` du portable garde `brokkr`, qui
-- joue les migrations. On réduit ce qu'une exécution de code DANS LE CONTENEUR
-- peut faire, pas ce qu'un portable compromis peut faire.

BEGIN;

-- NOINHERIT : si quelque chose lui accorde un jour un rôle d'administration, il
-- n'en héritera pas en silence. C'est le mode d'échec de FRE-112.
CREATE ROLE brokkr_app WITH LOGIN PASSWORD '<MOT_DE_PASSE>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

GRANT CONNECT ON DATABASE french_forge_trainer TO brokkr_app;
GRANT USAGE ON SCHEMA public TO brokkr_app;
REVOKE CREATE ON SCHEMA public FROM brokkr_app;

-- ─── LES 39 RELATIONS QUE L'APPLICATION ÉCRIT ────────────────────────────────
-- Ordre alphabétique, une par ligne : c'est ce qui rend l'ajout d'une table
-- lisible dans un diff.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  acces_support,
  athlete_goals,
  athlete_prs,
  athletes,
  bilan_medias_demo,
  bilan_modeles,
  bilan_resultat_medias,
  bilan_resultats,
  bilan_rubriques,
  bilan_test_medias,
  bilan_tests,
  bilans,
  block_objectives,
  calendar_events,
  coach_profiles,
  coaches,
  competition_attempts,
  competition_coach_availability,
  competition_editors,
  competition_movements,
  competition_participants,
  competitions,
  daily_logs,
  douleur_logs,
  douleurs,
  kine_notes,
  kines,
  library_entries,
  objectifs_techniques,
  programs,
  signalement_vu,
  training_base_accessories,
  training_base_principles,
  training_blocks,
  training_exercises,
  training_macros,
  training_sessions,
  training_sets,
  training_weeks,
  users,
  weight_categories
TO brokkr_app;

-- ─── LECTURE SEULE ───────────────────────────────────────────────────────────
-- `competition_scores` est une VUE : son contenu est calculé, personne n'y écrit.
GRANT SELECT ON competition_scores TO brokkr_app;
-- Les vues du 09/10 (FRE-215 → 222) : le compte et ses rôles, qui suit qui, les
-- signalements, un bloc et une semaine tels qu'on les lit, les séries réalisées.
-- ⚠️ UNE VUE AUSSI DOIT SON GRANT : sans lui, `/users/me` a rendu 500 à tout le
-- monde le 09/10 — la vue existait pour `brokkr`, pas pour l'application.
GRANT SELECT ON comptes, liens_athlete, signalements,
                blocs_lus, semaines_lues, series_realisees, series_de_travail
TO brokkr_app;

-- ⚠️ `norep_reasons` : 32 lignes de référentiel, qu'AUCUN code ne lit par son nom
-- — le front porte les libellés, et c'est la clé étrangère de
-- `competition_attempts` qui valide. Les contrôles d'intégrité référentielle ne
-- réclament pas de privilège au writer, donc ce `SELECT` n'est pas nécessaire
-- aujourd'hui. Il est là parce qu'un référentiel public de 32 lignes ne coûte
-- rien à ouvrir, alors qu'une route qui le lirait un jour tomberait en 500.
GRANT SELECT ON norep_reasons TO brokkr_app;

-- `structures` (FRE-13) : French Forge, SCAPPULIFT. Une structure se crée par
-- migration, pas par l'application — elle la lit pour dire à chacun où il est.
GRANT SELECT ON structures TO brokkr_app;

-- `push_subscriptions` (28/09) : les abonnements aux notifications push, écrits
-- et retirés par l'appelant, retirés par brokkr quand le service de push les
-- déclare partis.
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO brokkr_app;

-- ─── CE QUI N'EST PAS DONNÉ, ET POURQUOI ─────────────────────────────────────
-- `schema_migrations` : le registre de ce qui a été appliqué. Une application
-- capable de le réécrire pourrait faire rejouer — ou faire sauter — n'importe
-- quelle migration. Il n'appartient qu'à `scripts/migrer.py`, joué en `brokkr`.
-- C'est la seule table du schéma que le rôle applicatif ne voit pas.

-- La séquence de `training_sets`, la seule du schéma.
GRANT USAGE, SELECT ON SEQUENCE training_sets_id_seq TO brokkr_app;

-- Les fonctions ne sont pas une surface de DONNÉE, et `PUBLIC` porte déjà
-- `EXECUTE` par défaut : les nommer une par une (50 aujourd'hui) allongerait ce
-- fichier sans rien fermer.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO brokkr_app;

COMMIT;

-- ═══ À LIRE AVANT DE BASCULER QUOI QUE CE SOIT ═══════════════════════════════
-- Les réponses attendues sont écrites en face. La deuxième est celle qui compte :
-- si elle rend une ligne, le rôle ne vaut rien et c'est FRE-112 qui recommence.

-- attendu : 4 × false
SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
  FROM pg_roles WHERE rolname = 'brokkr_app';

-- attendu : AUCUNE ligne
SELECT r.rolname AS membre_de FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.roleid
  JOIN pg_roles u ON u.oid = m.member
 WHERE u.rolname = 'brokkr_app';

-- attendu : false — il ne peut pas endosser le propriétaire, donc rien détruire
SELECT pg_has_role('brokkr_app', 'brokkr', 'USAGE') AS peut_endosser_brokkr;

-- attendu : EXACTEMENT `schema_migrations` — ni plus, ni moins. Une ligne de plus
-- est une table oubliée ; une de moins veut dire que le registre est ouvert.
SELECT c.relname AS sans_lecture
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
   AND NOT has_table_privilege('brokkr_app', c.oid, 'SELECT');

-- ═══ CE QUE LA BASCULE A APPRIS (09/09) ══════════════════════════════════════
--
-- ⚠️ NE PAS RECOPIER LE MOT DE PASSE À LA MAIN. La première tentative a posé une
-- valeur qui n'était pas celle de Terraform : les deux endpoints répondaient
-- « password authentication failed » alors que le rôle était correct — mot de
-- passe SCRAM présent, `rolcanlogin` vrai, pas d'expiration. Une heure de doute
-- pour une copie abîmée. Le poser mécaniquement, sans passer par le presse-papier :
--
--   PW=$(terraform -chdir=nidavellir output -raw brokkr_app_password)
--   docker exec -i ff-training psql "<DATABASE_URL de brokkr/.env>" \
--     -c "ALTER ROLE brokkr_app WITH PASSWORD '$PW'"
--
-- ⚠️ LE POOLER ACCEPTE CE RÔLE, éprouvé le 09/09 sur les deux endpoints. La
-- question se posait parce que le job nocturne y passe, lui, contrairement au
-- service — et délibérément : c'est ce qui lui fait échapper au
-- `statement_timeout` de 15 s, sans quoi l'ETL serait tué en route (FRE-155).
--
-- ═══ CE QUI RESTE, ET QUE CE FICHIER NE FAIT PAS ═════════════════════════════
--   · `terraform apply` — bascule DB_USER/DB_PASSWORD du service ET du job
--     (`brokkr.tf`, `analytics.tf`), qui lisent tous deux `local.role_applicatif` ;
--   · redéployer brokkr, puis éprouver une route de LECTURE et une d'ÉCRITURE ;
--   · déclencher le job à la main plutôt que d'attendre 3 h 30 ;
--   · CREATE EXTENSION pg_stat_statements — absente.
--
-- En cas de retour arrière : DROP OWNED BY brokkr_app; DROP ROLE brokkr_app;
