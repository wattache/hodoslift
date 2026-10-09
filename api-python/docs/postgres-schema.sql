-- ============================================================================
-- french-forge — schéma Postgres (Neon)
--
-- CE FICHIER EST EXÉCUTÉ PAR LA SUITE DE TESTS (fixture `pg_engine`) : c'est
-- lui, et pas un dump, qui construit la base sur laquelle 1 271 specs tournent.
-- Il est donc du CODE, pas de la documentation.
--
-- ⚠️ CE QU'IL NE GARANTIT PAS, ET CE PARAGRAPHE L'A LONGTEMPS PROMIS (FRE-133).
--   Il disait « toute dérive entre ce fichier et la vraie base devient un test
--   rouge ». C'est faux dans les deux sens :
--     · un test ne rougit que s'il TRAVERSE la chose qui a dérivé ;
--     · `make schema-verifier` compare des NOMS — tables, vues, enums, colonnes.
--       Ni contraintes, ni index, ni actions `ON DELETE`, ni `NOT NULL`.
--   Une CHECK oubliée ici passe donc inaperçue jusqu'à la production, et c'est
--   arrivé deux fois le même jour (FRE-105, FRE-110). La garantie est un
--   objectif, pas un acquis : elle se construit dans FRE-133.
--
-- TOUT EST ICI DEPUIS LE 2026-08-20 (FRE-6, FRE-72). Il n'y a plus de second
-- magasin : Firestore est coupé, brokkr n'y touche plus, la base est gelée et
-- ne sert plus qu'à d'éventuelles archives. Seule l'AUTH reste chez Firebase,
-- ce qui n'a rien à voir — elle ne stocke pas de donnée métier.
--
--   Ce fichier a décrit pendant des mois un MODÈLE HYBRIDE (« lu en bloc » →
--   document, « interrogé en travers » → relationnel), et l'arbre
--   d'entraînement vivait de l'autre côté. Le raisonnement s'est retourné en
--   FRE-12 : c'est justement l'écriture EN BLOC qui posait problème — elle
--   remplaçait le tableau `sessions` entier, donc une valeur invalide faisait
--   tomber la SEMAINE (incident du 11/08), et une permission par ligne était
--   inapplicable. La crainte du coût ne s'est jamais vérifiée. L'arbre est
--   modélisé plus bas, et la frontière n'existe plus.
--
-- CONVENTIONS
--   - `*_id`  = uuid interne.  `*_uid` = uid texte Firebase Auth (users.uid).
--   - `legacy_id` : ⚠️ PLUS UNE COLONNE DE TRANSITION. Ce fichier a écrit
--     « conserve l'id Firestore le temps de l'ETL, supprimable après » ; c'est
--     l'inverse qui s'est produit. `athletes.legacy_id` est le SEGMENT D'URL
--     public, la clé que `training_sets.athlete_id` recopie, et
--     `app/identifiants.py` en FABRIQUE de nouveaux au même format pour chaque
--     athlète créé. Ce n'est plus un reliquat, c'est l'identité publique.
--   - `text` là où le DOMAINE est non numérique (fourchettes "6/8",
--     sentinelles "Sub5"). On resserre plus tard sur preuve, pas par principe.
--   - Postgres 15+ requis (UNIQUE NULLS NOT DISTINCT).
--
-- ⚠️ LES CHIFFRES CITÉS DANS CE FICHIER SONT DATÉS, ET SE PÉRIMENT. Ceux qui
--   énoncent un INVARIANT (« aucun groupe sans nature », « aucune ligne de BASE
--   ne porte de réalisé ») sont vérifiés par `scripts/verifier_invariants.py`,
--   et c'est LUI qui fait foi. Ceux qui justifient une décision passée gardent
--   leur date et ne se mettent pas à jour : ils disent ce qu'on savait alors.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE gender         AS ENUM ('M', 'F');
CREATE TYPE cycle_phase    AS ENUM ('menstruation', 'follicular', 'ovulation', 'luteal');
-- Plus de `cycle` (13/09) : le cycle vit dans `daily_logs.cycle_phase` (FRE-173).
CREATE TYPE event_type     AS ENUM ('competition', 'vacation', 'travel', 'rest', 'other');
CREATE TYPE attempt_tier   AS ENUM ('pessimistic', 'realistic', 'optimistic');
CREATE TYPE attempt_result AS ENUM ('rep', 'norep');
CREATE TYPE coach_availability AS ENUM ('pending', 'available', 'unavailable');
-- Une seule biblio : les exercices (ex-principaux+renforcement fusionnés) et les
-- 3 autres vocabulaires, tous dans `library_entries`, distingués par `category`.
CREATE TYPE library_category AS ENUM
    ('exercices', 'variantes', 'assistances', 'tempos', 'formats');

-- ============================================================================
-- IDENTITÉ
-- ============================================================================

-- On garde Firebase Auth : seul le stockage change. L'uid EST l'identifiant.
CREATE TABLE users (
    uid          text PRIMARY KEY,
    -- ⚠️ PAS D'UNICITÉ (retirée le 22/08, FRE-77). `uid` est la clé ; aucune
    -- requête ne lit `users` par email, et Firebase autorise deux comptes à
    -- partager une adresse. La contrainte n'avait qu'un effet observable : un
    -- 500 sur `GET /users/me` dès qu'un uid neuf portait un email connu.
    -- `NOT NULL` reste — le routeur écrit `''` à défaut, et `''` ne collisionne
    -- plus avec lui-même.
    email        text NOT NULL,
    display_name text NOT NULL DEFAULT '',
    is_admin     boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- Les réglages d'affichage de la personne (le rendu de la progression, par
    -- mode) : ils la suivent d'un appareil à l'autre. La forme est gardée par
    -- le contrat (`Preferences`), pas ici.
    preferences  jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- LES ABONNEMENTS PUSH (28/09) : « me prévenir quand mon coach génère une
-- semaine ». Un abonnement est PAR NAVIGATEUR — l'endpoint vient du service de
-- push du navigateur et c'est lui la clé ; une personne en a autant que
-- d'appareils. `p256dh` / `auth` : les clés de chiffrement du navigateur
-- (RFC 8291). Un endpoint que le service déclare parti (404 / 410) est retiré
-- par brokkr à l'envoi.
CREATE TABLE push_subscriptions (
    endpoint   text PRIMARY KEY,
    uid        text NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    p256dh     text NOT NULL,
    auth       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON push_subscriptions (uid);

-- LES STRUCTURES (FRE-13) : French Forge, SCAPPULIFT. Une structure se lit sur
-- la fiche athlète, la ligne coach, la ligne kiné et la compétition (colonne
-- `structure`) — pas d'adhésion : aucun coach ne coache dans deux structures.
-- Les liens nominatifs (`coach_uid`, `kine_uid`, `user_uid`) cloisonnent déjà ;
-- la structure CHOISIT ce qu'on regarde. Le slug est la clé, et ne change pas :
-- le front le mémorise pour jouer l'ouverture de la bonne structure.
-- ⚠️ `DEFAULT 'french-forge'` sur les quatre colonnes : les chemins d'écriture de
-- l'app posent tous la structure explicitement ; le défaut ne sert qu'à
-- l'existant et aux fixtures (cf. la migration du 18/09).
CREATE TABLE structures (
    slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]+$'),
    nom  text NOT NULL UNIQUE CHECK (btrim(nom) <> '')
);
INSERT INTO structures (slug, nom) VALUES
  ('french-forge', 'French Forge'),
  ('scappulift',   'SCAPPULIFT'),
  ('elgustolift',  'ElGustoLift');

-- Rôle COACH. Un coach est TOUJOURS un user (pas de coach sans compte, à la
-- différence d'un athlète) → clé = uid, table d'EXTENSION 1:1 de users, pas une
-- entité à uuid propre. Être coach = avoir une ligne ici (d'où le retrait du
-- booléen is_coach de users, qui aurait pu diverger). Rôle double : point
-- d'accroche pour de futurs attributs de coach, ET cible des FK « ce champ doit
-- être un coach » (athletes.coach_uid, programs.coach_uid, competition_editors…).
CREATE TABLE coaches (
    uid        text PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- La structure où il COACHE (FRE-13). Une seule : cf. `structures`.
    structure  text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug)
);

-- Rôle KINÉ (FRE-52) — copie conforme de `coaches`, et la symétrie est VOULUE.
-- Être kiné = avoir une ligne ici ; la table est la cible de la FK
-- `athletes.kine_uid`. Pas de booléen `users.is_kine` : le jour des ORGANISATIONS
-- (FRE-64), `coaches` et `kines` se dissoudront toutes deux dans une adhésion
-- portant un rôle, et la migration doit pouvoir les traiter d'un seul geste — un
-- flag sur `users` se serait traîné.
-- ⚠️ CE QUE CE RÔLE DONNE A CHANGÉ LE 2026-08-18, et ce commentaire a dit le
-- contraire jusqu'au 06/09 : il annonçait « la LECTURE du programme, et rien
-- d'autre », avec l'écriture des lignes rehab renvoyée à FRE-53. FRE-53 a été
-- ANNULÉ, construit puis démonté le même jour — 993 lignes pour une frontière
-- que personne n'avait eu besoin de tracer.
--
-- Sur l'athlète qu'il SUIT, le kiné a exactement les droits du coach : la prog,
-- le suivi, la fiche. Ce qui ouvre l'accès est le LIEN `athletes.kine_uid`, pas
-- le fait d'être kiné. La seule exception est le MÉDICAL, où c'est l'inverse
-- qui vaut : le coach en est exclu (`owner_or_kine`, cf. `bilans` plus bas).
-- La matrice complète vit dans `app/authz.py`, et nulle part ailleurs.
CREATE TABLE kines (
    uid        text PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- La structure où il EXERCE (FRE-13). Suivre un athlète d'une autre
    -- structure reste possible : c'est `athletes.kine_uid`, un lien nominatif.
    structure  text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug)
);

-- Profil PUBLIC d'un coach (FRE-30), lu SANS auth par le site vitrine.
-- ⚠️ Ne contient QUE du public : la route ne filtre rien et ne joint JAMAIS
-- `athletes` — la redondance des 1RM (recopiés ici, pas joints) EST le garde-fou.
-- coach_uid = propriétaire (identité du PATCH + cible de projection). slug = clé
-- publique. one_rm = projection de athletes.current_one_rm (coach = athlète via
-- user_uid), rafraîchie par le job training-analytics-refresh. Ni vidéo ni
-- témoignages : ils restent dans coachs.js.
-- langues = codes ISO 639-1 SANS contrainte d'énumération (champ d'affichage, déjà
-- contraint par le menu déroulant du front) ; normalisés à l'entrée (minuscules,
-- dédupliqués), NULL = non renseigné (jamais un tableau vide).
CREATE TABLE coach_profiles (
    coach_uid  text PRIMARY KEY REFERENCES coaches(uid) ON DELETE CASCADE,
    slug       text NOT NULL UNIQUE,
    accroche   text,
    bio        text,
    instagram  text,
    photo_url  text,
    one_rm     jsonb,
    langues    text[]
);

-- ============================================================================
-- BIBLIOTHÈQUE
-- UNE seule table pour toute la biblio. Un exercice est UNIQUE par son nom
-- (SQUAT = SQUAT, peu importe qui le crée) — plus de principaux/renforcement
-- (les principaux se choisissent dans la BASE), plus de catalogue séparé ni de
-- shared/private : tout est partagé, unique par (category, name).
--
-- L'intégrité des mouvements (PR/compét) n'est PLUS assurée par une FK mais par
-- brokkr, qui valide le nom à l'écriture (l'exo doit exister ici, cat=exercices)
-- et normalise. « Seul le nom intéresse » : PR/compét stockent le nom en texte.
-- ============================================================================

CREATE TABLE library_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category    library_category NOT NULL,
    name        text NOT NULL,
    -- Le petit sous-ensemble d'exercices qui sont des lifts de COMPÉTITION,
    -- suivis en 1RM et affichés au dashboard (ex-`principaux` : MU/PU/CHIN/DIPS/
    -- SQUAT). Remplace la constante front `PRINCIPAL_MOVEMENTS` codée en dur.
    competition boolean NOT NULL DEFAULT false,
    -- Groupes principaux qu'un exercice de renforcement SOUTIENT (clés MU/PU/DIP/
    -- SQ, cf. PARENT_GROUPS front). Métadonnée facultative, pertinente pour les
    -- renforcements (exercices non-competition).
    -- ⚠️ NULL = NON RENSEIGNÉ, ET C'EST LE SEUL ÉTAT VIDE (FRE-157). Le tableau
    -- `[]` était accepté et se lisait comme un NULL (`if supports:` en Python) :
    -- une distinction que ni l'écriture ni l'écran ne savaient exprimer. La
    -- contrainte ci-dessous le rend impossible plutôt que de le faire vivre.
    supports    text[],
    -- ⚠️ LE VOCABULAIRE EST CLOS, ET IL NE L'ÉTAIT QUE DANS LE CODE (FRE-140).
    -- Le contrat Pydantic ÉCARTAIT en silence un groupe inconnu et répondait
    -- 200 : le client croyait avoir enregistré ce que la base n'avait pas. Il
    -- refuse désormais en 422, et cette contrainte ferme l'autre porte — un
    -- `UPDATE` à la main, une reprise, un futur appelant.
    -- ⚠️ ELLE INTERDIT AUSSI LE TABLEAU VIDE (FRE-157), que la version de FRE-140
    -- laissait passer sans le vouloir : `[]` est sous-ensemble de n'importe quoi,
    -- donc `<@` l'acceptait. Cinq entrées en portaient un, reprises en NULL.
    -- Pas de décompte ici : ce que la donnée vaut, c'est la contrainte qui le
    -- garde, pas un chiffre qui vieillit (règle maison).
    CONSTRAINT library_entries_supports CHECK (
        supports IS NULL
        OR (cardinality(supports) > 0
            AND supports <@ ARRAY['MU', 'PU', 'DIP', 'SQ']::text[])),
    created_by  text REFERENCES coaches(uid) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- ⚠️ UNE BIBLIOTHÈQUE PAR STRUCTURE (19/09) : « SQUAT » existe une fois dans
    -- CHACUNE. Les lignes la référencent par `(structure, categorie, nom)` —
    -- cf. `ff_pose_la_structure` et les clés de FRE-123 plus bas.
    structure   text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug),
    UNIQUE (structure, category, name),
    -- Un tempo ou un format n'est jamais un lift de compétition.
    CHECK (NOT competition OR category = 'exercices')
);


CREATE TABLE athletes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id  text UNIQUE,
    first_name text NOT NULL DEFAULT '',
    last_name  text NOT NULL DEFAULT '',
    -- Email de CONTACT, saisi par le coach AVANT que l'athlète ait un compte.
    -- Pas un doublon de users.email : 6 athlètes sur 46 n'ont pas encore de
    -- compte (constat 2026-07-21). Une fois lié, users.email fait foi.
    email      text,
    -- ⚠️ UN ZÉRO N'EST PAS UNE MESURE (FRE-137, lot 4). 28 fiches sur 70
    -- pesaient zéro kilo et 29 mesuraient zéro centimètre : le front fait
    -- `parseFloat(v) || 0`, donc vider la case envoyait `0`, et le serveur
    -- l'écrivait. La contrainte rend cette absence-là impossible ; c'est
    -- `athlete_profile._mesure_ou_absence` qui traduit ce que le front envoie.
    height_cm  numeric CONSTRAINT height_cm_positif CHECK (height_cm > 0),
    weight_kg  numeric CONSTRAINT weight_kg_positif CHECK (weight_kg > 0),
    -- ⚠️ UNE DATE, PAS UN ÂGE (FRE-168). L'entier `age` vieillissait sans que
    -- rien ne le signale ; l'âge se calcule à la lecture (`athletes._COMMON_COLS`).
    -- Le futur est refusé à l'écriture : un CHECK doit rester vrai demain.
    birth_date date CONSTRAINT birth_date_plausible CHECK (birth_date >= DATE '1900-01-01'),
    -- Le point zéro du suivi de poids vers une pesée (29/09) : une PAIRE, posée
    -- ensemble par la route. `weight_kg` reste le poids courant de la fiche.
    poids_depart_kg numeric CONSTRAINT poids_depart_kg_positif CHECK (poids_depart_kg > 0),
    poids_depart_le date,
    CONSTRAINT poids_depart_par_paire CHECK ((poids_depart_kg IS NULL) = (poids_depart_le IS NULL)),
    gender     gender,
    -- La structure de la FICHE (FRE-13) — pas forcément celle de son compte :
    -- Nico est athlète French Forge et coach SCAPPULIFT. Celle du coach qui la
    -- crée (`POST /athletes`).
    structure  text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug),
    -- Le coach gérant : un athlète a toujours un coach.
    coach_uid  text NOT NULL REFERENCES coaches(uid) ON DELETE RESTRICT,
    -- Le compte de l'athlète lui-même. NULL tant qu'il ne s'est pas connecté.
    user_uid   text UNIQUE REFERENCES users(uid) ON DELETE SET NULL,
    -- Le kiné qui SUIT cet athlète (FRE-52). NULL = pas de suivi kiné. Un seul
    -- kiné par athlète en v1 : le lien est nominatif, pas une collection — d'où
    -- une colonne plutôt qu'une table de liaison.
    -- RESTRICT comme `coach_uid` : rétrograder un kiné qui suit encore quelqu'un
    -- échoue (409) au lieu de détacher ses suivis en silence.
    -- Écrit par le COACH de l'athlète, jamais par le kiné : on ne se donne pas
    -- ses propres patients.
    kine_uid   text REFERENCES kines(uid) ON DELETE RESTRICT,
    -- 1RM de PROGRAMMATION (la « Table RM » du dashboard, base des % d'incrément).
    -- C'est une donnée de PROFIL, mutable, DISTINCTE des records (athlete_prs) :
    -- on peut programmer sur un 1RM différent de son record all-time. Map
    -- {mouvement: charge} — jsonb, lu/écrit en bloc avec le profil.
    current_one_rm jsonb,
    -- ⚠️ PLUS DE `photo_path` NI `photo_url` ICI. Retirées de Neon le 20/08 avec
    -- les photos d'athlètes ; elles ont survécu dans ce fichier deux jours de
    -- plus, ce qui est exactement le défaut que ce fichier ne doit pas avoir.
    -- (Le `photo_url` de `coach_profiles`, lui, est LÉGITIME — les photos de
    -- coach n'ont jamais été supprimées.)
    created_at timestamptz NOT NULL DEFAULT now(),
    -- ⚠️ ARCHIVÉ, PAS SUPPRIMÉ (FRE-127). NULL = actif. Un athlète qui suspend le
    -- coaching disparaît des LISTES, pas de la base : il garde son programme, son
    -- historique et ses records, et son coach garde son accès — c'est ce qui rend
    -- « reprendre plus tard » possible.
    --
    -- ⚠️ LE LIEN COACH RESTE INTACT, et c'est ce qui distingue archiver de
    -- DÉTACHER (FRE-128). Vider `coach_uid` retirerait aussi l'accès du coach,
    -- donc le pouvoir de désarchiver : le geste deviendrait un aller simple.
    --
    -- Une DATE et non un booléen, comme `clos_le` et `achieved_on` : « archivé »
    -- sans savoir quand ne raconte rien, et on veut pouvoir dire « il a repris en
    -- mars ».
    archive_le timestamptz
);

-- LE COMPTE ET SES RÔLES, EN UNE LIGNE (FRE-220). `users` ne porte que
-- l'identité et `is_admin` ; être coach, kiné ou athlète, c'est une ligne dans
-- `coaches`, `kines` ou `athletes`. Le profil, l'annuaire et les gardes
-- (`app/socle/authz.py`) lisent ICI, en une requête, au lieu de refaire chacun
-- leurs EXISTS.
CREATE VIEW comptes AS
SELECT u.uid, u.email, u.display_name, u.is_admin, u.preferences,
       c.uid IS NOT NULL AS est_coach,
       c.structure       AS coach_structure,
       k.uid IS NOT NULL AS est_kine,
       k.structure       AS kine_structure,
       -- `athletes.user_uid` est UNIQUE : au plus une fiche, pas de LIMIT 1.
       a.legacy_id       AS athlete_id,
       (SELECT array_agg(DISTINCT x.structure ORDER BY x.structure)
          FROM athletes x WHERE x.user_uid = u.uid) AS athlete_structures
FROM users u
LEFT JOIN coaches  c ON c.uid = u.uid
LEFT JOIN kines    k ON k.uid = u.uid
LEFT JOIN athletes a ON a.user_uid = u.uid;
CREATE INDEX ON athletes (coach_uid);
CREATE INDEX ON athletes (kine_uid);

-- Records manuels de l'athlète (source « manuel » du tableau All-Time PR).
-- UNIQUEMENT les manualPRs Firestore — désormais une LISTE d'objets portant leur
-- contexte (une ligne = un record), et non plus la map appauvrie {mouvement:{reps:
-- charge}}. Le 1RM de programmation, lui, est `athletes.current_one_rm` (chose
-- distincte, cf. ci-dessus).
-- UN ACCÈS SUPPORT (FRE-202) : un admin, un athlète, une fin. Tant qu'il court,
-- l'admin a sur CET athlète les droits de son coach et de son kiné (`authz`).
-- Un lien, pas un rôle : il expire seul, et la ligne reste comme trace.
-- ⚠️ PAS « assistances » : c'est déjà une catégorie de la bibliothèque (RB20…).
CREATE TABLE acces_support (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    uid        text NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    debut      timestamptz NOT NULL DEFAULT now(),
    fin        timestamptz NOT NULL,
    CONSTRAINT acces_support_fin_apres_debut CHECK (fin > debut)
);
CREATE INDEX ON acces_support (uid, athlete_id, fin);

CREATE TABLE athlete_prs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id  uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    -- Le NOM de l'exercice (seul le nom intéresse). Pas de FK : brokkr garantit
    -- qu'il existe dans library_entries (category='exercices' ET competition=true —
    -- un record se tient sur un lift de compétition, pas sur du renforcement).
    -- ⚠️ RÉFÉRENCE LA BIBLIOTHÈQUE depuis FRE-123 : la contrainte est posée
    -- plus bas, avec la colonne `categorie` constante qu'elle exige. NULLABLE
    -- parce que `NULL` veut dire « pas encore choisi » — ce que `''` disait
    -- avant, et qu'aucune clé étrangère n'aurait accepté.
    movement    text,
    reps        integer NOT NULL CHECK (reps > 0),
    weight_kg   numeric NOT NULL CHECK (weight_kg > 0),
    -- Le CONTEXTE fait le sens du PR : « 4 reps à 60 » et « 4x4 à 60 » ne sont
    -- pas la même performance. L'UI l'affiche déjà (formatTrainingDetail →
    -- "4x4", format, variante) ; ne pas le perdre en migrant.
    sets        text,
    format      text,          -- '' | EMOM | AMRAP | CLUSTER
    variant     text,
    performed_on date,
    -- Identité d'un PR = le tuple COMPLET (id de surface + clé naturelle). NULLS NOT
    -- DISTINCT (PG15+) : deux PR à sets NULL collisionnent — sinon on créerait des
    -- doublons sur la donnée réelle (sets/format/variant vides à 100 %).
    UNIQUE NULLS NOT DISTINCT (athlete_id, movement, sets, reps, variant, format)
);

-- Objectifs « rêve », globaux (non liés à un bloc).
CREATE TABLE athlete_goals (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id  uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    legacy_id   text,  -- id du goal dans le tableau Firestore (idempotence ETL)
    -- ⚠️ RÉFÉRENCE LA BIBLIOTHÈQUE depuis FRE-123 : la contrainte est posée
    -- plus bas, avec la colonne `categorie` constante qu'elle exige. NULLABLE
    -- parce que `NULL` veut dire « pas encore choisi » — ce que `''` disait
    -- avant, et qu'aucune clé étrangère n'aurait accepté.
    exercise    text,
    sets        text NOT NULL DEFAULT '',
    reps        text NOT NULL DEFAULT '',
    weight      text NOT NULL DEFAULT '',
    motivation  text NOT NULL DEFAULT '',
    created_on  date NOT NULL,
    achieved_on date,
    CHECK (achieved_on IS NULL OR achieved_on >= created_on),
    UNIQUE (athlete_id, legacy_id)
);
CREATE INDEX ON athlete_goals (athlete_id);

-- ============================================================================
-- PROGRAMME — cette table dit QUI possède QUOI.
-- Le CONTENU (macros → blocs → semaines → séances → lignes) est modélisé plus
-- bas, dans cette base, depuis FRE-12.
-- ============================================================================

-- ⚠️ `id` est TEXT, pas uuid — et c'est volontaire, mais la raison a changé de
-- nature. C'ÉTAIT l'id du document sous lequel vivait l'arbre d'entraînement :
-- lui inventer une uuid aurait obligé à déplacer tout l'arbre, l'opération la
-- plus risquée de l'ETL. L'ETL est fini depuis longtemps.
--
-- Ce qui le retient AUJOURD'HUI est autre chose : cet id est le segment d'URL
-- que le front porte (`/programs/{id}/…`), la valeur que `training_sets`
-- recopie, et `app/identifiants.py` en fabrique de nouveaux au même format à
-- chaque athlète créé. Le changer serait une migration à part entière, pour
-- une esthétique. Donc pas de `legacy_id` ici : l'id EST l'identité.
CREATE TABLE programs (
    id         text PRIMARY KEY,
    name       text,
    coach_uid  text NOT NULL REFERENCES coaches(uid) ON DELETE RESTRICT,
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- Un athlète = un programme (décision 2026-07-21). Les saisons successives
-- sont des macrocycles DANS ce programme, pas des programmes distincts.
CREATE UNIQUE INDEX ON programs (athlete_id);
CREATE INDEX ON programs (coach_uid);

-- QUI SUIT QUI (FRE-217) : LE lien d'une personne à un athlète, et nulle part
-- ailleurs. Coach de la fiche ou du programme, kiné, l'athlète lui-même, accès
-- support en cours. `app/socle/authz.py` en tire les rôles, et les listes
-- (sélecteur, suivis, signalements, guichet, compétitions) y bornent leurs
-- lignes par `porte_un_lien(...)`.
--
-- ⚠️ UN ACCÈS SUPPORT EN COURS VAUT COACH ET KINÉ, et c'est un lien comme les
-- autres : il porte sa fin (`jusqu_au`, NULL pour les liens sans terme).
-- `clock_timestamp()` et non `now()` : l'accès se juge à l'heure réelle, pas au
-- début de la transaction qui le lit.
CREATE VIEW liens_athlete AS
SELECT a.coach_uid AS uid, a.id AS athlete_id, 'coach' AS lien, NULL::timestamptz AS jusqu_au
  FROM athletes a
UNION
SELECT p.coach_uid, p.athlete_id, 'coach', NULL
  FROM programs p
UNION
SELECT a.kine_uid, a.id, 'kine', NULL
  FROM athletes a WHERE a.kine_uid IS NOT NULL
UNION
SELECT a.user_uid, a.id, 'athlete', NULL
  FROM athletes a WHERE a.user_uid IS NOT NULL
UNION
SELECT s.uid, s.athlete_id, l.lien, s.fin
  FROM acces_support s CROSS JOIN (VALUES ('coach'), ('kine')) AS l(lien)
 WHERE s.fin > clock_timestamp();


-- ============================================================================
-- SUIVI QUOTIDIEN & CALENDRIER
-- Relationnel : petites lignes, requêtées par plage de dates (graphiques).
-- ============================================================================

CREATE TABLE daily_logs (
    athlete_id   uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    log_date     date NOT NULL,
    weight_kg    numeric,
    sleep_hours  numeric,
    water_liters numeric,
    calories     numeric,   -- kcal du jour (saisie athlète)
    -- ⚠️ CETTE TABLE NE PORTE PLUS DE DOULEUR (FRE-195). Elle en a porté une, en
    -- objet `jsonb` libre, tant que le questionnaire se cherchait. Une douleur a
    -- une IDENTITÉ — on la renote, elle se clôt, elle revient — et c'est ce
    -- qu'un objet anonyme rangé dans la journée ne savait pas dire. Elle vit
    -- dans `douleurs` / `douleur_logs`. Y remettre un champ ici rouvrirait une
    -- seconde façon d'écrire la même chose, qu'aucun écran ne lirait.
    --
    -- LA PHASE DU CYCLE, UN FAIT DU JOUR (FRE-173). Elle vivait dans le
    -- calendrier comme un événement de `start_date` à `end_date`, et la seule
    -- entrée jamais saisie couvrait 117 jours : le patron invitait une plage
    -- pour une donnée qui est une déclaration par jour. Ici, au grain du poids.
    -- ⚠️ ET PAS AVEC LES DOULEURS : « qui va mal » dirait « qui a ses règles ».
    -- NULL = pas déclaré.
    cycle_phase  cycle_phase,
    PRIMARY KEY (athlete_id, log_date)
);

-- LA COCHE D'UN SIGNALEMENT, PAR LECTEUR (guichet, 12/09).
--
-- ⚠️ UNE TABLE ET NON UNE COLONNE : le kiné et le coach lisent le MÊME
-- signalement (`_SIGNALEMENTS_SQL`, `kine_uid = uid OR coach_uid = uid`). Une
-- colonne unique laisserait l'un le faire disparaître de la file de l'autre.
-- La clé est (athlète, jour, QUI a coché).
CREATE TABLE signalement_vu (
    athlete_id uuid NOT NULL,
    log_date   date NOT NULL,
    uid        text NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    -- `clock_timestamp()` : l'instant de la coche, pas le début de la
    -- transaction — `now()` rendrait « modifié après coché » indécidable dans
    -- une même transaction (cf. `app/relecture.py`).
    vu_le      timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (athlete_id, log_date, uid),
    -- ⚠️ RATTACHÉE À L'ATHLÈTE, PLUS AU JOURNAL QUOTIDIEN (FRE-195). Le
    -- signalement vivait dans `daily_logs` ; il vit dans `douleur_logs`, et un
    -- jour de douleur n'a pas forcément de ligne de journal — 5 des 8 saisies
    -- reprises n'en avaient aucune. La coche reste ce qu'elle est : « j'ai vu
    -- ce que cet athlète a signalé ce jour-là », et elle survit à l'effacement
    -- du signalement, ce qui est juste — on l'a bien lu.
    CONSTRAINT signalement_vu_athlete_id_fkey
        FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

-- LA DOULEUR SUIVIE, ET SES LOGS (FRE-195).
--
-- ⚠️ CE QUI MANQUAIT N'ÉTAIT PAS LA MESURE, C'ÉTAIT L'IDENTITÉ. Une intensité
-- était déjà saisie à chaque signalement ; mais rien ne reliait deux
-- signalements de la même épaule, et personne n'avait jamais saisi deux fois.
--
-- ⚠️ DEUX TABLES PLUTÔT QU'UN CHAMP DE PLUS DANS LE JSONB. Un `douleur_id` dans
-- un objet libre serait une référence sans clé étrangère — exactement ce que
-- FRE-193 et FRE-194 ont mesuré ailleurs : des noms qui survivent à ce qu'ils
-- désignent. Sur de la donnée de santé, non.
CREATE TABLE douleurs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    -- Le nom que l'ATHLÈTE donne : c'est par lui qu'il la reconnaît dans une
    -- liste, pas par le code anatomique.
    nom text NOT NULL CONSTRAINT douleurs_nom_non_vide CHECK (btrim(nom) <> ''),
    -- ⚠️ UN CODE, PAS UN LIBELLÉ : `chest:gauche`. Une des huit saisies
    -- historiques est en anglais ; le mot affiché serait illisible d'une langue
    -- à l'autre. Le côté est celui DE L'ATHLÈTE, jamais celui de l'écran
    -- (`eitri/src/lib/anatomie/zones.ts`).
    zone text NOT NULL CONSTRAINT douleurs_zone_non_vide CHECK (btrim(zone) <> ''),
    -- NULL = l'athlète ne sait pas dire. « 4 ans », « souvent en début de bloc »
    -- sont des réponses vraies qu'aucune date ne rend.
    debut date,
    fin   date,   -- renseignée quand ça ne fait plus mal ; NULL = toujours là
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT douleurs_fin_apres_debut CHECK (fin IS NULL OR debut IS NULL OR fin >= debut)
);
CREATE INDEX ON douleurs (athlete_id);
-- Deux douleurs VIVANTES sur la même zone sont la même : c'est tout l'objet du
-- rattachement. Une douleur close ne bloque rien — la même épaule peut refaire
-- mal six mois plus tard.
CREATE UNIQUE INDEX douleurs_une_vivante_par_zone
    ON douleurs (athlete_id, zone) WHERE fin IS NULL;

-- ⚠️ LA CHRONICITÉ SE DÉDUIT DU NOMBRE DE LOGS, elle ne se coche pas : un
-- booléen à côté du compte finirait par le contredire. Même règle que « repos »
-- dans la grille du cycle, qui se lit de l'absence de tier.
CREATE TABLE douleur_logs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    douleur_id uuid NOT NULL REFERENCES douleurs(id) ON DELETE CASCADE,
    -- Le jour QUE L'ATHLÈTE DÉCRIT, pas celui où il saisit. Même grain que
    -- `daily_logs.log_date`.
    log_date date NOT NULL,
    -- `0` est une réponse — « plus mal aujourd'hui ».
    intensite smallint NOT NULL CHECK (intensite BETWEEN 0 AND 10),
    -- Ce que la figure ne capturera jamais : « fissure au ménisque », « dips ».
    -- `NULL` et jamais `''` (FRE-137).
    commentaire text CONSTRAINT douleur_logs_commentaire_non_vide CHECK (btrim(commentaire) <> ''),
    -- ⚠️ TROIS ÉTATS, ET LE NULL EST LE PLUS IMPORTANT : true = jour entraîné,
    -- false = jour sans, NULL = l'athlète ne l'a pas dit. Une case à cocher
    -- n'en aurait que deux et rangerait « pas répondu » avec « repos ».
    --
    -- ⚠️ DÉCLARÉ, PAS DÉRIVÉ. La base connaît les séries réalisées, mais
    -- « aucune trace ce jour-là » ne veut pas dire « repos » : une séance peut
    -- être saisie plus tard, ou pas du tout. Seul l'athlète sait s'il a bougé,
    -- et c'est la question que le kiné pose en premier devant une douleur qui
    -- dure.
    entrainement boolean,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- ⚠️ « NOTÉ APRÈS COCHÉ » REVIENT DANS LA FILE DU STAFF, et c'est ce que
    -- cette colonne garde. `created_at` ne bouge pas quand on corrige sa note :
    -- le guichet ne verrait pas qu'une douleur a empiré. `clock_timestamp()` et
    -- non `now()`, pour que la comparaison reste décidable dans une même
    -- transaction (cf. `app/relecture.py`).
    modifie_le timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- Deux notes le même jour pour la même douleur se contrediraient : la
    -- seconde est une correction, pas un fait de plus. L'écriture remplace.
    UNIQUE (douleur_id, log_date)
);
CREATE INDEX ON douleur_logs (douleur_id, log_date DESC);

-- UN SIGNALEMENT EST UN ATHLÈTE ET UN JOUR, PAS UNE DOULEUR (FRE-195) : la
-- coche du lecteur (`signalement_vu`) porte cette clé-là, et deux douleurs
-- notées le même jour font UNE ligne. Le tableau des signalements, la file du
-- guichet et la coche lisent cette agrégation ICI, et `recurrente` avec elle.
--
-- ⚠️ `recurrente` compte TOUT l'historique de la douleur, pas la fenêtre lue :
-- une épaule notée en janvier et en juin est récurrente en juin.
CREATE VIEW signalements AS
SELECT d.athlete_id, l.log_date,
       jsonb_agg(jsonb_build_object(
           'id', d.id::text, 'nom', d.nom, 'zone', d.zone,
           'intensite', l.intensite, 'commentaire', l.commentaire,
           'logs', n.logs, 'recurrente', n.logs > 1
       ) ORDER BY l.intensite DESC, d.nom) AS douleurs,
       -- Le repère de « noté après coché » : l'upsert rafraîchit `modifie_le`
       -- quand on réécrit la même journée.
       max(l.modifie_le) AS note_le
  FROM douleur_logs l
  JOIN douleurs d ON d.id = l.douleur_id
  JOIN LATERAL (SELECT count(*) AS logs FROM douleur_logs x WHERE x.douleur_id = d.id) n ON true
 GROUP BY d.athlete_id, l.log_date;


-- LES BILANS — le moteur : modèles composés par la kiné, instances passées
-- par les athlètes. Spec complète : docs/bilan-kine.md.

-- ══════════════════════════════════════════════════════════════════════════
-- LE MODÈLE — composé par la kiné
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE bilan_modeles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nom         text NOT NULL,          -- « Bilan complet », « Cycliste »
    description text,
    cree_par    text REFERENCES kines(uid) ON DELETE SET NULL,
    -- Archivé = retiré des choix à la création d'un bilan. Les instances
    -- passées restent lisibles : on ne retire jamais un point d'une courbe de
    -- santé parce que le modèle a vieilli.
    archive     boolean NOT NULL DEFAULT false,
    cree_le     timestamptz NOT NULL DEFAULT now(),
    modifie_le  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bilan_rubriques (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modele_id  uuid NOT NULL REFERENCES bilan_modeles(id) ON DELETE CASCADE,
    libelle    text NOT NULL,           -- « Tests de mobilité »
    ordre      integer NOT NULL
);

CREATE INDEX bilan_rubriques_modele ON bilan_rubriques (modele_id, ordre);

-- ============================================================================
-- LES MÉDIAS DE DÉMONSTRATION (FRE-99, lot B)
--
-- ⚠️ DEUX FAMILLES DE MÉDIAS, DEUX TABLES (spec §3.6). Celle-ci ne porte QUE de
-- la démonstration : le mouvement montré, identique pour tous, sans personne
-- d'identifiable. Les médias d'ATHLÈTE sont du lot C — table et seau séparés,
-- après FRE-58. Une seule table ferait basculer les démonstrations dans le
-- régime des données de santé.
--
-- ⚠️ IMAGES SEULEMENT : une vidéo ne vit pas dans le seau, elle est transcodée
-- et servie par api.video, donc désignée par un identifiant chez eux et non par
-- un chemin d'objet. Faire porter deux natures d'adresse au champ `chemin`
-- serait l'ambiguïté qu'on paye deux ans plus tard.
-- ============================================================================

CREATE TABLE bilan_medias_demo (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Chemin de l'objet dans le seau PRIVÉ. Le nom du seau n'est pas stocké :
    -- il vient de l'environnement, donc changer d'hébergeur ne demande pas de
    -- réécrire des lignes.
    chemin  text NOT NULL CHECK (btrim(chemin) <> ''),
    type    text NOT NULL DEFAULT 'image' CHECK (type IN ('image')),
    legende text,
    -- Qui a téléversé — une PERSONNE (`users`), pas un rôle : même correction
    -- que `kine_notes.kine_uid`. SET NULL reste ici parce que la colonne est
    -- déjà nullable pour un cas réel — une photo importée par un script n'a pas
    -- d'auteur.
    cree_par text REFERENCES users(uid) ON DELETE SET NULL,
    cree_le  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bilan_tests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rubrique_id  uuid NOT NULL REFERENCES bilan_rubriques(id) ON DELETE CASCADE,
    libelle      text NOT NULL,
    protocole    text,                  -- départ, exécution, consignes

    -- LA PRESCRIPTION — des CHAMPS, pas de la prose. C'est ce qui rend une
    -- variation détectable : « 15 kg » écrit dans le protocole ne se compare
    -- pas, un nombre si.
    mesure       text NOT NULL DEFAULT 'aucune'
                 CHECK (mesure IN ('aucune', 'reps', 'secondes')),
    -- ⚠️ DIT S'IL Y A DEUX RÉSULTATS, pas si le geste a un côté. Le formulaire
    -- d'origine demandait « Droite/Gauche » à l'érecteur du rachis et au
    -- transverse — des tests de TRONC, où la case était un artefact de
    -- copier-coller. Les laisser bilatéraux remplirait `mesure_droite` au
    -- hasard sur ces tests-là, pour des années.
    bilateral    boolean NOT NULL DEFAULT false,
    charge_kg    numeric,
    -- Ce avec quoi la charge est produite. NULL = fonte nue. Sans ce champ,
    -- 25 kg d'élastique et 25 kg de kettlebell seraient le même nombre — or ce
    -- n'est ni le même effort ni le même matériel à sortir.
    materiel     text,
    -- Angles de prise de vue. Sert dès maintenant à l'écran (l'athlète doit
    -- savoir comment se filmer) et devient indispensable au lot C.
    vues         text[] NOT NULL DEFAULT '{}',
    -- ⚠️ SET NULL : supprimer un média n'emporte pas le TEST. Le protocole écrit
    -- reste utilisable sans image — c'est ainsi que les 32 tests fonctionnent
    -- aujourd'hui.
    cible        text,                  -- « 30 s », affiché sur les maintiens

    ordre        integer NOT NULL,
    -- ⚠️ RETRAIT DOUX. Retirer un test le fait disparaître des FUTURS bilans ;
    -- les résultats passés restent, et restent lisibles grâce à l'instantané
    -- ci-dessous. Une suppression franche effacerait des mesures d'athlètes.
    retire       boolean NOT NULL DEFAULT false
);

CREATE INDEX bilan_tests_rubrique ON bilan_tests (rubrique_id, ordre);

-- ══════════════════════════════════════════════════════════════════════════
-- L'INSTANCE — passée par un athlète
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE bilans (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id  uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

    -- Le modèle peut disparaître sans emporter les bilans : SET NULL, et le nom
    -- recopié pour que l'instance reste intelligible seule.
    modele_id   uuid REFERENCES bilan_modeles(id) ON DELETE SET NULL,
    modele_nom  text NOT NULL,

    bilan_date  date NOT NULL,
    -- Qui l'a conduit. NULL si l'athlète l'a rempli seul — et SET NULL au
    -- départ du kiné : le bilan appartient à l'athlète, pas au praticien.
    kine_uid    text REFERENCES kines(uid) ON DELETE SET NULL,

    -- ⚠️ `en_cours` EST LA RÈGLE, PAS L'EXCEPTION. 32 tests avec du matériel ne
    -- se remplissent pas d'une traite : sans reprise, on perd tout à l'abandon.
    -- Seul un bilan `finalise` entre dans une comparaison — un bilan en cours
    -- est un état de saisie, pas une mesure.
    statut      text NOT NULL DEFAULT 'en_cours'
                CHECK (statut IN ('en_cours', 'finalise')),

    -- ⚠️ L'HISTORIQUE MÉDICAL VIT ICI, PAS SUR `athletes`, ET C'EST DÉLIBÉRÉ.
    -- Porté par la fiche athlète, il ferait basculer TOUTE la table athlètes
    -- dans le périmètre des données de santé — donc dans le périmètre HDS
    -- (FRE-58), donc une migration totale le jour venu. Ici le périmètre
    -- médical se réduit aux tables de ce fichier : le déplacement devient
    -- chirurgical.
    --
    -- Effet de bord heureux : chaque bilan garde l'instantané de ce qui était
    -- connu À SA DATE, médicalement plus honnête qu'un champ écrasé. Un nouveau
    -- bilan pré-remplit depuis le précédent ; l'athlète corrige.
    antecedents text,
    notes       text,

    cree_le     timestamptz NOT NULL DEFAULT now(),
    modifie_le  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bilans_athlete_date ON bilans (athlete_id, bilan_date DESC);

CREATE TABLE bilan_resultats (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bilan_id      uuid NOT NULL REFERENCES bilans(id) ON DELETE CASCADE,

    -- L'identité STABLE du test, pour comparer d'un bilan à l'autre. NULL si le
    -- test a été supprimé franchement du modèle : le résultat survit, lisible
    -- par son instantané — il cesse seulement d'être comparé.
    test_id       uuid REFERENCES bilan_tests(id) ON DELETE SET NULL,

    -- ══════════════════════════════════════════════════════════════════════
    -- ⚠️ L'INSTANTANÉ — LA DÉCISION QUI PROTÈGE LES DONNÉES (spec §3.1)
    --
    -- Ce qui a été DEMANDÉ, figé au remplissage. SANS LUI, CHAQUE RETOUCHE DU
    -- MODÈLE RÉÉCRIT SILENCIEUSEMENT LE PASSÉ : la kiné fait passer le grip de
    -- 15 à 20 kg — geste parfaitement légitime — et les résultats déjà
    -- enregistrés se mettent à dire autre chose. Aucune alerte, aucune trace :
    -- juste une courbe devenue fausse.
    --
    -- Figer le référentiel réglerait le problème mais interdirait l'édition,
    -- qui est la demande. L'instantané tient les deux : le modèle vit
    -- librement, le résultat reste vrai. Corollaire : la comparaison entre deux
    -- bilans se VÉRIFIE sur l'instantané (même unité, même charge) au lieu
    -- d'être supposée.
    -- ══════════════════════════════════════════════════════════════════════
    test_libelle     text NOT NULL,
    rubrique_libelle text,
    -- ⚠️ LE PROTOCOLE AUSSI, ET LE FRONT L'A RÉVÉLÉ. L'écran de saisie doit
    -- afficher ce que l'athlète a à faire — or l'athlète n'a pas accès au
    -- catalogue des modèles (réservé à la kiné) : sans ces colonnes, il n'y a
    -- AUCUN chemin pour lui montrer les consignes. Et c'est cohérent avec le
    -- reste : un résultat obtenu sous une consigne doit garder cette consigne,
    -- sinon on relit demain une mesure d'hier avec les instructions d'après.
    protocole        text,
    vues             text[] NOT NULL DEFAULT '{}',
    cible            text,
    mesure           text NOT NULL CHECK (mesure IN ('aucune', 'reps', 'secondes')),
    bilateral        boolean NOT NULL,
    ordre            integer,           -- l'ordre du bilan tel qu'il était

    ressenti      text CHECK (ressenti IN ('ras', 'douleur', 'gene')),
    detail        text,

    -- ⚠️ NULL ≠ 0, ET LA DISTINCTION EST CLINIQUE.
    --   NULL = test NON RÉALISÉ (matériel absent, douleur qui l'empêche, pas eu
    --          le temps) ;
    --   0    = test réalisé, échec complet.
    -- Les confondre fausserait toute lecture d'évolution : un test sauté ferait
    -- un creux dans la courbe, indiscernable d'une régression. C'est le défaut
    -- le plus récurrent du projet — le vide et l'absence traités pareil.
    mesure_gauche numeric,
    mesure_droite numeric,

    -- ⚠️ LA CHARGE RÉELLEMENT UTILISÉE, parce que LA RÉALITÉ DÉVIE. Le protocole
    -- dit 15 kg ; la salle n'a qu'un disque de 12. Enregistrer le résultat comme
    -- s'il valait 15 serait un mensonge silencieux, propagé par chaque
    -- comparaison. Pré-remplie depuis le modèle, modifiable.
    charge_kg     numeric,
    materiel      text,

    modifie_le    timestamptz NOT NULL DEFAULT now(),

    -- ⚠️ LA FORME EST TENUE PAR LA BASE, PAS SEULEMENT PAR LE ROUTEUR. Les gardes
    -- HTTP refusent déjà ces deux cas, mais une garde de routeur ne protège que
    -- le chemin qu'on a écrit : un script de reprise ou un correctif SQL passé à
    -- la main écrivent sans la croiser. Et une `mesure_droite` posée au hasard sur
    -- un test de TRONC ne s'affiche sur aucun écran — donc personne ne la corrige.
    CONSTRAINT bilan_resultats_cote_droit_si_bilateral
        CHECK (bilateral OR mesure_droite IS NULL),
    CONSTRAINT bilan_resultats_mesures_si_mesurable
        CHECK (mesure <> 'aucune'
               OR (mesure_gauche IS NULL AND mesure_droite IS NULL))
);

-- Un test ne peut pas avoir deux résultats dans le même bilan. C'est ce qui rend
-- la saisie IDEMPOTENTE : un bilan en cours enregistre à chaque frappe, donc la
-- même ligne est réécrite des dizaines de fois.
CREATE UNIQUE INDEX bilan_resultats_unicite
    ON bilan_resultats (bilan_id, test_id) WHERE test_id IS NOT NULL;

CREATE INDEX bilan_resultats_bilan ON bilan_resultats (bilan_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- LES IMAGES D'UN TEST (FRE-99) — plusieurs par test, ordonnées.
--
-- Le formulaire papier le faisait déjà : un mouvement se montre en deux ou
-- trois photos — départ, passage, arrivée — et une seule image obligerait à
-- choisir laquelle des trois compte le plus.
--
-- ⚠️ DES TABLES DE LIAISON, PAS UN `uuid[]`. Un tableau aurait tenu en une
-- colonne mais perdu la clé étrangère : Postgres ne contraint pas les éléments
-- d'un tableau, donc une référence vers un média disparu serait possible sans
-- que rien ne le dise avant l'affichage.
--
-- ⚠️ ET L'ORDRE EST EXPLICITE : « départ, passage, arrivée » n'est pas
-- « arrivée, départ, passage ».
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE bilan_test_medias (
    test_id  uuid NOT NULL REFERENCES bilan_tests(id)       ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES bilan_medias_demo(id) ON DELETE CASCADE,
    ordre    integer NOT NULL,
    -- La même image deux fois dans un test est une erreur de manipulation, pas
    -- une intention.
    PRIMARY KEY (test_id, media_id)
);

-- L'INSTANTANÉ des images, côté bilan (§3.1) — comme le protocole et la charge.
--
-- ⚠️ `RESTRICT` ICI ET `CASCADE` LÀ-HAUT, ET LA DIFFÉRENCE EST LE SUJET. Le
-- catalogue est vivant : y retirer une image défait un lien, c'est tout. Un
-- bilan passé, lui, est une mesure datée sous une consigne donnée — le jour où
-- une route de suppression de média existera (elle n'existe pas : la clé
-- Scaleway ne porte pas ce droit), elle devra REFUSER d'effacer ce qu'un bilan
-- montre encore, au lieu de vider une consigne du passé en silence.
CREATE TABLE bilan_resultat_medias (
    resultat_id uuid NOT NULL REFERENCES bilan_resultats(id)   ON DELETE CASCADE,
    media_id    uuid NOT NULL REFERENCES bilan_medias_demo(id) ON DELETE RESTRICT,
    ordre       integer NOT NULL,
    PRIMARY KEY (resultat_id, media_id)
);

-- ============================================================================
-- LES NOTES DE SUIVI DU KINÉ (FRE-102) — au fil de l'eau, hors bilan
--
-- ⚠️ RANGÉE AVEC LES TABLES DU BILAN, PAS AILLEURS. Le périmètre des données de
-- santé reste ainsi circonscrit aux mêmes tables : le jour où FRE-58 impose un
-- hébergement HDS, le déplacement reste chirurgical.
-- ============================================================================

CREATE TABLE kine_notes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

    -- ⚠️ RÉFÉRENCE `users`, PAS `kines` — l'auteur est une PERSONNE, pas un
    -- rôle, et la nuance a été payée une fois. Pointer vers `kines` liait la
    -- note au rôle : retirer le rôle kiné à quelqu'un était alors REFUSÉ tant
    -- que ses notes existaient, et le seul moyen de passer outre était de les
    -- SUPPRIMER. Une contrainte posée pour protéger forçait à détruire.
    --
    -- On ne supprime jamais un `users` dans ce produit — on retire une ligne
    -- `kines`, ce qui est une rétrogradation. D'où l'absence de tout ON DELETE :
    -- il décrirait un événement qui n'arrive pas.
    kine_uid   text NOT NULL REFERENCES users(uid),

    -- ⚠️ UN JOURNAL, PAS UN BLOC-NOTES : des entrées datées qui s'empilent. Un
    -- texte unique réécrit donnerait l'état courant et perdrait la chronologie ;
    -- ici la dernière entrée EST l'état, les précédentes disent comment on y est
    -- arrivé. Le CHECK interdit l'entrée vide — une note sans contenu est un
    -- clic de trop, pas une information.
    contenu    text NOT NULL CHECK (btrim(contenu) <> ''),

    cree_le    timestamptz NOT NULL DEFAULT now(),
    modifie_le timestamptz NOT NULL DEFAULT now()
);

-- La lecture est TOUJOURS « cet athlète, du plus récent au plus ancien ».
CREATE INDEX kine_notes_athlete ON kine_notes (athlete_id, cree_le DESC);


-- OBJECTIFS TECHNIQUES PAR MOUVEMENT (FRE-122) — « garde les coudes hauts ».
--
-- ⚠️ PAR ATHLÈTE, PAS PAR CLUB. Une correction technique s'adresse à quelqu'un :
-- « garde les coudes hauts » vaut pour Léa parce qu'elle les baisse. La même
-- phrase servie à tout le monde deviendrait un panneau qu'on ne lit plus.
--
-- ⚠️ ET UN JOURNAL, PAS UN BLOC-NOTES — même forme que `kine_notes`, pour la
-- même raison : des entrées datées qui s'empilent. Un objectif atteint se CLÔT
-- (`clos_le`) sans s'effacer, donc on garde ce qui a été travaillé et quand.
CREATE TABLE objectifs_techniques (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

    -- ⚠️ LE MOUVEMENT EST UNE CLÉ ÉTRANGÈRE VERS LA BIBLIOTHÈQUE, ET C'EST LE
    -- POINT DÉLICAT DU TICKET. Rien ne relie une LIGNE d'exercice à la
    -- bibliothèque : `training_exercises.name` est une copie texte. Rapprocher
    -- un objectif d'une ligne ne peut donc se faire que par le NOM.
    --
    -- D'où le choix de stocker le TEXTE plutôt qu'un `library_entry_id` : la
    -- table se compare aux lignes exactement comme les lignes se comparent entre
    -- elles, sans résolution `id → nom` à chaque lecture.
    --
    -- Et d'où `ON UPDATE CASCADE` : un coach peut RENOMMER une entrée
    -- (`PATCH /library/entries/{id}`), et l'objectif doit suivre.
    --
    -- ⚠️ Mesuré le 03/09 avant de choisir : les 107 noms distincts portés par les
    -- 13 682 lignes correspondent TOUS à une entrée, même à la comparaison
    -- exacte. Le rapprochement par nom tient.
    --
    -- ⚠️ CE QUE CETTE CLÉ NE FAIT PAS : garantir que le mouvement correspond à
    -- une ligne. Un renommage ferait suivre l'objectif pendant que les lignes
    -- existantes gardent l'ancien nom — défaut ANTÉRIEUR, qui appartient aux
    -- lignes (FRE-123), pas à cette table.
    --
    -- `categorie` est CONSTANTE à 'exercices'. Elle n'existe que pour satisfaire
    -- la référence composite : la cible est `UNIQUE (category, name)`, et
    -- Postgres ne sait pas viser un index unique partiel.
    categorie  library_category NOT NULL DEFAULT 'exercices',
    mouvement  text NOT NULL,
    -- Celle de l'athlète, posée par `ff_pose_la_structure` : la bibliothèque
    -- est par structure (19/09).
    structure  text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug),

    -- Le CHECK interdit l'entrée vide, comme `kine_notes` : un objectif sans
    -- texte est un clic de trop.
    texte      text NOT NULL CHECK (btrim(texte) <> ''),

    -- ⚠️ RÉFÉRENCE `users`, PAS `coaches` — la leçon de `kine_notes`, et elle a
    -- été payée une fois. Pointer vers le RÔLE liait l'objectif à lui : retirer
    -- le rôle coach à quelqu'un était alors refusé tant que ses objectifs
    -- existaient, et le seul moyen de passer outre était de les SUPPRIMER. Une
    -- contrainte posée pour protéger forçait à détruire.
    cree_par   text NOT NULL REFERENCES users(uid),

    -- ⚠️ `clock_timestamp()` ET NON `now()`, qui rend l'heure de DÉBUT DE
    -- TRANSACTION. Deux objectifs posés dans la même transaction porteraient
    -- alors la MÊME date, et « du plus récent au plus ancien » cesserait d'être
    -- un ordre — il retomberait sur l'ordre d'insertion, par accident.
    --
    -- Découvert par une spec qui posait deux objectifs et lisait la liste : elle
    -- est rouge sur `now()`. En production chaque requête a sa transaction, donc
    -- le défaut ne s'y voyait pas — c'est-à-dire qu'il attendait le premier
    -- import ou la première écriture groupée.
    cree_le    timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- Atteint, sans effacer l'histoire. NULL = encore en travail.
    clos_le    timestamptz,

    FOREIGN KEY (structure, categorie, mouvement)
        REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE
);

-- La lecture est TOUJOURS « cet athlète, du plus récent au plus ancien » : la
-- route rend tout, l'écran regroupe par mouvement.
CREATE INDEX objectifs_techniques_athlete ON objectifs_techniques (athlete_id, cree_le DESC);


CREATE TABLE calendar_events (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id  text,
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    type       event_type NOT NULL,
    name       text NOT NULL DEFAULT '',
    start_date date NOT NULL,
    end_date   date NOT NULL,
    -- Plus de `phase` ni de CHECK qui la liait au type `cycle` (13/09) : le
    -- cycle est un fait du jour, `daily_logs.cycle_phase` (FRE-173).
    emoji      text,
    can_train  boolean,
    CHECK (end_date >= start_date),
    UNIQUE (athlete_id, legacy_id)  -- idempotence ETL (legacy_id = id event Firestore)
);
CREATE INDEX ON calendar_events (athlete_id, start_date);

-- ============================================================================
-- COMPÉTITIONS
-- Le domaine le PLUS relationnel : essais × mouvements × participants, scores
-- et classements dérivés, appariement des PR entre athlètes. C'est ici que SQL
-- paie vraiment — d'où le choix de l'y mettre plutôt que de le laisser doc.
-- ============================================================================

CREATE TABLE competitions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id    text UNIQUE,
    name         text NOT NULL,
    -- Une compét dure souvent 2 jours. L'athlète, lui, passe UN jour donné
    -- (cf. competition_participants.competes_on).
    start_date   date NOT NULL,
    end_date     date NOT NULL,
    location     text,
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    created_by   text NOT NULL REFERENCES coaches(uid) ON DELETE RESTRICT,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- Celle du coach qui l'a créée (FRE-13) : lue et éditée par sa structure.
    structure    text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug),
    CHECK (end_date >= start_date)
);
CREATE INDEX ON competitions (start_date);

-- Les mouvements disputés SONT une entité : un essai ne peut porter que sur
-- l'un d'eux (contrainte impossible à exprimer dans le doc Firestore).
CREATE TABLE competition_movements (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    -- Le NOM de l'exercice disputé (texte, comme athlete_prs.movement). brokkr
    -- valide qu'il existe dans library_entries avec category='exercices' ET
    -- competition=true (un LIFT DE COMPÉTITION — pas un exercice de renforcement ;
    -- c'est précisément le rôle du flag `competition`). Comparaison insensible casse.
    movement       text NOT NULL,
    -- Ordre de passage dans la compét (MU, puis PU, etc.).
    position       integer NOT NULL,
    UNIQUE (competition_id, movement),
    UNIQUE (competition_id, position)
);

-- Coachs co-éditeurs. Le doc d'origine stockait des EMAILS (`editorEmails`),
-- mais un éditeur est un user : on référence son uid. brokkr résout
-- email → uid à l'ajout (l'email saisi doit correspondre à un compte existant).
-- Même logique que participants→athlete.
--
-- ⚠️ CETTE RÉSOLUTION N'EST PLUS UNIVOQUE, et ce commentaire a promis le
-- contraire jusqu'au 06/09 : il invoquait l'unicité de `users.email`, RETIRÉE
-- le 22/08 (FRE-77, cf. la table `users`). Firebase autorise deux comptes à
-- partager une adresse ; deux uid peuvent donc répondre au même email. Aucun
-- doublon en production à ce jour (vérifié par `verifier_invariants.py`), mais
-- la résolution doit rester déterministe si le cas se présente.
CREATE TABLE competition_editors (
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    editor_uid     text NOT NULL REFERENCES coaches(uid) ON DELETE CASCADE,
    PRIMARY KEY (competition_id, editor_uid)
);

-- Les catégories dépendent du SEXE : une femme ne peut pas être en -101.
-- Référentiel + FK composite → la base l'impose, plus l'UI seule.
CREATE TABLE weight_categories (
    gender gender NOT NULL,
    code   text NOT NULL,
    max_kg numeric,              -- NULL = catégorie ouverte (« + »)
    position integer NOT NULL,
    PRIMARY KEY (gender, code)
);

CREATE TABLE competition_participants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id  uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    -- NULL = invité hors plateforme. Sinon, lien vers l'athlète : c'est CE
    -- lien qui rend possible « les PR en compétition d'Aubin ».
    athlete_id      uuid REFERENCES athletes(id) ON DELETE SET NULL,
    -- Nom de l'athlète tel qu'il concourt (utile pour les invités sans compte).
    name            text NOT NULL,
    -- Le jour où CET athlète passe, dans une compét qui peut durer 2 jours.
    competes_on     date,
    bodyweight_kg   numeric,      -- snapshot légitime : le poids DU JOUR
    gender          gender,
    weight_category text,
    -- Le flight ne se stocke pas ici : il se déduit de la catégorie
    -- (`competition_flight_categories`).
    UNIQUE (competition_id, name),
    -- Si le sexe est NULL la contrainte ne s'applique pas (MATCH SIMPLE).
    FOREIGN KEY (gender, weight_category) REFERENCES weight_categories(gender, code)
);
CREATE INDEX ON competition_participants (athlete_id);

-- Les flights d'une compétition (« groupes » sur les affiches françaises), dans
-- l'ordre où ils passent (FRE-204). Un flight réunit des catégories ; un athlète
-- passe dans celui de sa catégorie.
CREATE TABLE competition_flights (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    name           text NOT NULL CONSTRAINT competition_flights_nom_non_vide CHECK (btrim(name) <> ''),
    position       integer NOT NULL,
    UNIQUE (competition_id, name),
    UNIQUE (competition_id, position),
    UNIQUE (id, competition_id)
);

-- ⚠️ Une catégorie appartient à UN flight par compétition : c'est la clé
-- primaire. `competition_id` est recopié pour la porter, et la FK composite vers
-- le flight le tient cohérent.
CREATE TABLE competition_flight_categories (
    competition_id  uuid NOT NULL,
    flight_id       uuid NOT NULL,
    gender          gender NOT NULL,
    weight_category text NOT NULL,
    PRIMARY KEY (competition_id, gender, weight_category),
    FOREIGN KEY (flight_id, competition_id) REFERENCES competition_flights(id, competition_id) ON DELETE CASCADE,
    FOREIGN KEY (gender, weight_category) REFERENCES weight_categories(gender, code)
);
CREATE INDEX ON competition_flight_categories (flight_id);

-- Référentiel des motifs d'invalidation (règlement FNSL). `is_auto` = faute
-- qui invalide automatiquement (3 cartons rouges), affichée avec ⚠ dans l'UI.
CREATE TABLE norep_reasons (
    id      text PRIMARY KEY,     -- 'unknown', 'too_heavy', 'other', …
    label   text NOT NULL,
    is_auto boolean NOT NULL DEFAULT false
);

CREATE TABLE competition_attempts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id uuid NOT NULL REFERENCES competition_participants(id) ON DELETE CASCADE,
    -- FK, pas du texte libre : impossible de tenter un mouvement hors compét.
    movement_id    uuid NOT NULL REFERENCES competition_movements(id) ON DELETE CASCADE,
    attempt_index  integer NOT NULL CHECK (attempt_index >= 1),
    weight_kg      numeric,
    result         attempt_result,          -- NULL = pas encore tenté
    -- Feuille de match : 3 charges préparées en amont, `selected_tier` dit
    -- laquelle le coach a validée (celle-ci pilote weight_kg pendant le live).
    weight_pessimistic numeric,
    weight_realistic   numeric,
    weight_optimistic  numeric,
    selected_tier  attempt_tier,
    -- `result` dit CE QUI s'est passé (validé / non validé) ; `norep_reason`
    -- dit POURQUOI c'est non validé — un code du règlement FNSL, pas du texte.
    norep_reason   text REFERENCES norep_reasons(id) ON DELETE RESTRICT,
    var_used       boolean,       -- les juges ont eu recours à la VAR
    UNIQUE (participant_id, movement_id, attempt_index),
    CHECK (norep_reason IS NULL OR result = 'norep')
);
CREATE INDEX ON competition_attempts (participant_id);

-- Qui du staff est dispo, jour par jour, pour tenir la compétition.
--
-- ⚠️ CETTE TABLE A MANQUÉ ICI PENDANT DES SEMAINES (FRE-80), alors qu'elle porte
-- des lignes en production et que `competitions.py` l'interroge. Le coût n'était
-- pas théorique : le bac à sable, construit DEPUIS ce fichier, ne l'avait pas —
-- la route de disponibilité y répondait 500 `UndefinedTable`, donc elle était
-- INTESTABLE en e2e réel. Et le test unitaire passait, parce qu'il fabriquait sa
-- propre mini-table. Un harnais qui ment coûte plus cher qu'un harnais absent.
--
-- Clé composite (compétition, coach, jour) : une réponse par jour, pas une par
-- compétition — les catégories ne passent pas toutes le même jour, et un coach
-- peut n'être là que le samedi.
CREATE TABLE competition_coach_availability (
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    coach_uid      text NOT NULL REFERENCES coaches(uid)     ON DELETE CASCADE,
    day            date NOT NULL,
    -- `pending` est un ÉTAT, pas une absence : « je n'ai pas encore répondu » ne
    -- se confond pas avec « je ne suis pas dispo ». D'où l'enum plutôt qu'un
    -- booléen nullable.
    status         coach_availability NOT NULL DEFAULT 'pending',
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (competition_id, coach_uid, day)
);
CREATE INDEX competition_coach_availability_coach_idx
    ON competition_coach_availability (coach_uid, day);

-- Le score n'est PAS stocké (il divergeait côté Firestore, au point que brokkr
-- le recalculait serveur). Ici il se dérive — et le TOTAL DU BARÈME avec lui
-- (FRE-92) : quatre places, dont une disputée entre le pull up et le chin up.
-- Le barème lui-même reste en Python (`app/scoring.py`).
CREATE VIEW competition_scores AS
WITH meilleurs AS (
    -- Le meilleur essai RÉUSSI, par participant et par mouvement.
    SELECT a.participant_id,
           upper(m.movement) AS movement,
           max(a.weight_kg)  AS weight_kg
    FROM competition_attempts a
    JOIN competition_movements m ON m.id = a.movement_id
    WHERE a.result = 'rep'
    GROUP BY a.participant_id, upper(m.movement)
)
SELECT p.id             AS participant_id,
       p.competition_id,
       -- Inchangé : le SCORE de l'épreuve additionne TOUS les mouvements
       -- disputés, quels qu'ils soient.
       COALESCE(SUM(b.weight_kg), 0) AS score,

       -- ── Ajouts FRE-92, en fin de liste pour ne pas déplacer l'existant ──
       p.athlete_id,

       -- ⚠️ LE TOTAL DU BARÈME N'EST PAS LE SCORE. Quatre places, pas tous les
       -- mouvements — et le pull up et le chin up S'EN DISPUTENT UNE, on retient
       -- le plus lourd. Le front l'ignore : il écarte purement le chin up, ce qui
       -- sous-estime le total de ONZE athlètes mesurés le 21/08.
       -- (Onze par la TABLE DES 1RM, que le RIS ne lit plus ; en compétition,
       -- aucun chin up n'a encore été disputé — la règle attend la première.)
       --
       -- ⚠️ ET IL VAUT ZÉRO QUAND LE BARÈME NE S'APPLIQUE PAS (FRE-147). Le
       -- SCORE, lui, additionne tous les mouvements disputés : une street à
       -- quatre et une SBD à trois donnent chacune leur total. Le barème, non —
       -- il note QUATRE PLACES nommées. Une compétition qui ne les dispute pas
       -- n'a pas un total au barème plus petit, elle n'en a pas : le calculer
       -- quand même donnerait un RIS bâti sur un tiers de total, et
       -- `_RIS_CANDIDATS_SQL` le retiendrait (il ne filtre que sur `> 0`).
       --
       -- ⚠️ RÈGLE POSITIVE — « la compétition dispute ce que le barème note » —
       -- et non « elle ne dispute rien d'autre » : une street qui ajoute un
       -- mouvement en bonus garde son RIS, le barème sachant l'ignorer.
       -- ⚠️ `DISTINCT upper(...)`, PAS `count(*)` : `competition_movements` est
       -- unique sur le TEXTE du mouvement, donc « SQUAT » et « Squat » peuvent
       -- y coexister et faire compter quatre places là où il y en a trois.
       CASE WHEN (SELECT count(DISTINCT upper(cm.movement)) FROM competition_movements cm
                   WHERE cm.competition_id = p.competition_id
                     AND upper(cm.movement) IN ('MUSCLE UP', 'DIPS', 'SQUAT')) = 3
             AND EXISTS (SELECT 1 FROM competition_movements cm
                          WHERE cm.competition_id = p.competition_id
                            AND upper(cm.movement) IN ('PULL UP', 'CHIN UP'))
            THEN COALESCE(SUM(b.weight_kg) FILTER (
                     WHERE b.movement IN ('MUSCLE UP', 'DIPS', 'SQUAT')), 0)
                 + COALESCE(MAX(b.weight_kg) FILTER (
                     WHERE b.movement IN ('PULL UP', 'CHIN UP')), 0)
            ELSE 0
       END AS total_bareme_kg,

       -- Les deux entrées du barème, figées le jour de la compétition. C'est ce
       -- couple qui rend le RIS honnête, et c'est la ligne qui le garantit.
       p.bodyweight_kg,
       p.gender
FROM competition_participants p
LEFT JOIN meilleurs b ON b.participant_id = p.id
-- `p.id` est clé primaire : Postgres autorise à projeter les autres colonnes de
-- `p` sans les grouper (dépendance fonctionnelle).
GROUP BY p.id, p.competition_id;

-- CE QUI A ÉTÉ APPLIQUÉ À CETTE BASE (FRE-133).
--
-- ⚠️ ALIMENTÉE PAR LES FICHIERS EUX-MÊMES, pas par un outil : chaque migration
-- pose sa ligne avant son `COMMIT`, donc DANS sa transaction. Si elle échoue, la
-- ligne n'est pas écrite non plus — un enregistrement fait de l'extérieur
-- pourrait marquer « appliqué » une migration à moitié passée.
--
-- `scripts/migrer.py` la lit et compare au dossier `docs/migrations/`. Il
-- n'invente rien : ni ordre calculé, ni retour arrière. La chronologie est le
-- NOM du fichier, comme elle l'a toujours été.
CREATE TABLE schema_migrations (
    fichier     text PRIMARY KEY,
    applique_le timestamptz NOT NULL DEFAULT now()
);


-- ============================================================================
-- DONNÉES DE RÉFÉRENCE
-- ============================================================================

-- Catégories de poids officielles, par sexe.
INSERT INTO weight_categories (gender, code, max_kg, position) VALUES
  ('F', '-52',   52, 1), ('F', '-57',  57, 2), ('F', '-63',  63, 3),
  ('F', '-70',   70, 4), ('F', '+70', NULL, 5),
  ('M', '-66',   66, 1), ('M', '-73',  73, 2), ('M', '-80',  80, 3),
  ('M', '-87',   87, 4), ('M', '-94',  94, 5), ('M', '-101', 101, 6),
  ('M', '+101', NULL, 7);

-- Motifs d'invalidation FNSL — référentiel complet, transcrit depuis la source
-- de vérité du front (app/src/utils/norepReasons.ts). `is_auto` = faute à
-- invalidation automatique (3 cartons rouges, section 10.1). Génériques d'abord,
-- puis communs (timing/ordres), puis spécifiques par mouvement (MU/PU/DIPS/SQUAT).
INSERT INTO norep_reasons (id, label, is_auto) VALUES
  ('unknown',                    'Ne sait pas',                                     false),
  ('too_heavy',                  'Trop lourd',                                      false),
  ('other',                      'Autre',                                           false),
  ('early_start',                'Départ avant signal "start"',                     false),
  ('time_exceeded',              'Démarré après la minute',                         false),
  ('order_violation',            'Non-respect des ordres',                          true),
  ('no_box_signal',              'Pas attendu signal "box"/"rack"',                 false),
  ('mu_elbows_not_simultaneous', 'Passage non-simultané des coudes',                true),
  ('mu_elbow_drop',              'Redescente des coudes durant la transition',      false),
  ('mu_kipping',                 'Cassage hanches > 60° / kipping',                 false),
  ('mu_false_grip',              'False grip (interdit sur barre)',                 false),
  ('mu_no_full_lock',            'Pas d''extension complète des coudes en haut',    false),
  ('mu_grip_width_changed',      'Largeur de prise modifiée en cours',              false),
  ('pu_chin_below_bar',          'Menton ne dépasse pas la barre',                  true),
  ('pu_mixed_grip',              'Prise mixte',                                     false),
  ('pu_rebound',                 'Rebond (relâchement scapulaire post-start)',      false),
  ('pu_concentric_descent',      'Redescente en phase concentrique',                false),
  ('pu_kipping',                 'Kipping / flexion genoux ou hanches excessive',   false),
  ('d_amplitude_shoulder',       'Amplitude : deltoïde postérieur pas sous coude',  false),
  ('d_amplitude_hip',            'Amplitude : hanche pas sous paume (L5)',          false),
  ('d_concentric_descent',       'Redescente en phase concentrique',                false),
  ('d_no_leg_contact',           'Perte de contact jambe / poids',                  false),
  ('d_final_not_locked',         'Position finale : coudes pas verrouillés',        false),
  ('d_final_unstable',           'Position finale : charge instable',               false),
  ('s_depth',                    'Profondeur insuffisante (pli hanche pas sous genou)', false),
  ('s_concentric_descent',       'Redescente durant la phase de poussée',           false),
  ('s_foot_displacement',        'Déplacement des appuis',                          false),
  ('s_knees_not_locked',         'Genoux pas verrouillés au départ',                false),
  ('s_torso_break',              'Cassure excessive du buste vers l''avant',        false),
  ('s_low_bar_exaggerated',      'Barre basse exagérée (contact triceps)',          false),
  ('s_descent_pause',            'Temps d''arrêt en phase descendante',             false),
  ('s_final_unstable',           'Position finale : appuis ou charge instables',    false);

-- ============================================================================
-- JAMAIS MIGRÉ, ET ÇA NE VIENDRA PAS
--   Deux ensembles sont restés dans l'ancien magasin, aujourd'hui gelé. Ils
--   n'ont pas de représentation ici, et ce n'est pas un reste à faire.
--
--   `invitations` — premier système d'enrôlement, abandonné. Aucun
--     consommateur ; 20 documents de mars 2026, purement historiques.
--   `macro.dashboard` — blockPlans / weekSplit / trainingFrequency /
--     competitions : machinerie jamais surfacée. Ses deux seuls champs vivants
--     ONT été repris ici : `training_macros.training_frequency` et
--     `coach_notes` (4 notes écrites à la main). Le reste est perdu
--     volontairement.
-- ============================================================================

-- ============================================================================
-- MACRO → BLOC → SEMAINE → SÉANCE → EXERCICE
-- ============================================================================

CREATE TABLE training_macros (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    legacy_id  text NOT NULL,          -- id du doc Firestore (idempotence ETL)
    number     integer NOT NULL,
    name       text,                   -- 5 macros sur 62 en portent un
    -- Seuls rescapés de `macro.dashboard` : 23 macros ont une fréquence saisie
    -- (2 à 5 ; les 38 à 0 = non renseigné), 3 portent une note de coach. Rien ne
    -- les affiche aujourd'hui — on les transporte sans les resurfacer.
    training_frequency integer,
    coach_notes        text,
    -- Horodatage du DOCUMENT Firestore source (`update_time`), tronqué à la
    -- microseconde. C'est lui qui rend l'ETL incrémental : un document dont
    -- l'horodatage n'a pas bougé n'est pas rechargé — ni lui, ni ce qu'il
    -- porte. NULL = jamais horodaté, donc rechargé une fois.
    source_updated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- ⚠️ DEUX ENFANTS D'UN MÊME PARENT NE PORTENT PLUS LE MÊME NUMÉRO (FRE-134).
    -- `prochain_numero` rend `max + 1` : deux créations simultanées lisaient le
    -- même maximum et inséraient deux fois le même numéro, en silence — la cause
    -- de FRE-59, dont on n'avait corrigé que les effets.
    -- `DEFERRABLE INITIALLY IMMEDIATE` : IMMEDIATE pour que la violation surgisse
    -- à l'INSERT, seul moment où `prochain_numero` peut réessayer ; DEFERRABLE
    -- parce que `_recompacter` renumérote 1..n d'un seul UPDATE et traverse un
    -- état à doublon. Le mot change la GRANULARITÉ du contrôle : déférable, la
    -- contrainte est vérifiée en fin d'INSTRUCTION même en mode IMMEDIATE.
    CONSTRAINT training_macros_program_number_unique
        UNIQUE (program_id, number) DEFERRABLE INITIALLY IMMEDIATE,
    UNIQUE (program_id, legacy_id)
);
CREATE INDEX ON training_macros (program_id);

CREATE TABLE training_blocks (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Horodatage du DOCUMENT Firestore source (cf. training_macros).
    source_updated_at timestamptz,
    macro_id  uuid NOT NULL REFERENCES training_macros(id) ON DELETE CASCADE,
    legacy_id text NOT NULL,
    number    integer NOT NULL,
    name      text,                    -- 13 blocs sur 124 seulement → naviguer
                                       -- par nom n'est PAS fiable (vécu le 13/08)
    start_date date,
    end_date   date,
    -- Aucun bloc ne l'a jamais violé ; il la reçoit quand même, en même temps
    -- que `training_weeks` (FRE-138). Ses dates viennent des mêmes gestes, et
    -- une contrainte qui ne tient que sur une des deux tables laisse la moitié
    -- de la porte ouverte.
    CONSTRAINT training_blocks_dates
        CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
    -- ---- la BASE, partie CONFIGURATION (les lignes ont leurs tables) --------
    -- Lues EN BLOC par le générateur de semaine, jamais interrogées en travers :
    -- elles restent des documents, conformément à la règle du schéma.
    -- `day_split` = [{day, tiers:{MOUVEMENT: 1|2|3}}].
    day_split           jsonb,
    -- Ordre des mouvements voulu par le coach. ABSENT sur 48 des 111 BASE, et
    -- c'est le trou de FRE-29 : sans lui le rang valait Infinity pour tout le
    -- monde et la génération retombait sur l'ordre d'AJOUT, alors que l'éditeur
    -- affichait l'ordre canonique. Le front défaute désormais explicitement.
    selected_principals text[],
    -- Pas d'arrondi des charges, PAR MOUVEMENT. 4 blocs sur 111 le surchargent,
    -- et ils disent quelque chose de précis : « MUSCLE UP → 0.5 » = cet athlète a
    -- des micro-charges. ⚠️ Les valeurs mêlent VIRGULE et POINT (« 2,5 » et
    -- « 0.5 ») — le parseur doit accepter les deux.
    granularity   jsonb,
    s1_start_date date,
    s1_end_date   date,
    -- ⚠️ DEUX ENFANTS D'UN MÊME PARENT NE PORTENT PLUS LE MÊME NUMÉRO (FRE-134).
    -- `prochain_numero` rend `max + 1` : deux créations simultanées lisaient le
    -- même maximum et inséraient deux fois le même numéro, en silence — la cause
    -- de FRE-59, dont on n'avait corrigé que les effets.
    -- `DEFERRABLE INITIALLY IMMEDIATE` : IMMEDIATE pour que la violation surgisse
    -- à l'INSERT, seul moment où `prochain_numero` peut réessayer ; DEFERRABLE
    -- parce que `_recompacter` renumérote 1..n d'un seul UPDATE et traverse un
    -- état à doublon. Le mot change la GRANULARITÉ du contrôle : déférable, la
    -- contrainte est vérifiée en fin d'INSTRUCTION même en mode IMMEDIATE.
    CONSTRAINT training_blocks_macro_number_unique
        UNIQUE (macro_id, number) DEFERRABLE INITIALLY IMMEDIATE,
    UNIQUE (macro_id, legacy_id)
);
CREATE INDEX ON training_blocks (macro_id);

CREATE TABLE training_weeks (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Horodatage du DOCUMENT Firestore source (cf. training_macros).
    source_updated_at timestamptz,
    block_id  uuid NOT NULL REFERENCES training_blocks(id) ON DELETE CASCADE,
    legacy_id text NOT NULL,
    number    integer NOT NULL,
    name      text,
    hidden    boolean NOT NULL DEFAULT false,
    -- ⚠️ LE `CHECK` A MANQUÉ ICI PENDANT TOUTE LA VIE DE LA TABLE, quand
    -- `calendar_events` et `competitions` en portent un depuis leur création.
    -- L'asymétrie n'était pas un arbitrage, c'était un oubli — et il a laissé
    -- passer deux semaines qui se terminent avant d'avoir commencé, avec la même
    -- signature toutes les deux : fin juste, début en avance de 28 jours exacts.
    -- Reprises et fermées le 09/09 (FRE-138).
    --
    -- ⚠️ TOLÉRANT AU NULL, à la différence des deux autres tables où les colonnes
    -- sont obligatoires : 54 blocs sur 125 n'ont aucune date, et c'est normal.
    start_date date,
    end_date   date,
    CONSTRAINT training_weeks_dates
        CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
    -- Instantané de l'athlète À CETTE SEMAINE : la seule partie qui porte de
    -- l'information (le poids fonde la force relative). Les noms sont jetés.
    athlete_weight_kg numeric,
    athlete_height_cm numeric,
    -- ⚠️ DEUX ENFANTS D'UN MÊME PARENT NE PORTENT PLUS LE MÊME NUMÉRO (FRE-134).
    -- `prochain_numero` rend `max + 1` : deux créations simultanées lisaient le
    -- même maximum et inséraient deux fois le même numéro, en silence — la cause
    -- de FRE-59, dont on n'avait corrigé que les effets.
    -- `DEFERRABLE INITIALLY IMMEDIATE` : IMMEDIATE pour que la violation surgisse
    -- à l'INSERT, seul moment où `prochain_numero` peut réessayer ; DEFERRABLE
    -- parce que `_recompacter` renumérote 1..n d'un seul UPDATE et traverse un
    -- état à doublon. Le mot change la GRANULARITÉ du contrôle : déférable, la
    -- contrainte est vérifiée en fin d'INSTRUCTION même en mode IMMEDIATE.
    CONSTRAINT training_weeks_block_number_unique
        UNIQUE (block_id, number) DEFERRABLE INITIALLY IMMEDIATE,
    UNIQUE (block_id, legacy_id)
);
CREATE INDEX ON training_weeks (block_id);

CREATE TABLE training_sessions (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    week_id   uuid NOT NULL REFERENCES training_weeks(id) ON DELETE CASCADE,
    -- `sessionId` côté Firestore. 57 séances sur 1 805 n'en ont AUCUN (deux
    -- programmes, janvier-mars 2026, saisies à la main avant l'introduction du
    -- champ) : l'ETL leur en frappe un. C'est pourtant la clé par laquelle le
    -- front désigne une séance à écrire — l'identité y était accidentelle.
    legacy_id text NOT NULL,
    position  integer NOT NULL,
    name      text NOT NULL,
    session_date     date,
    form_of_the_day  integer,   -- 1 à 5, NULL si non renseigné (852/1 805)
    -- LE GUICHET DU COACH (12/09). La marque de relecture est une COCHE du coach,
    -- pas une déduction depuis l'ouverture d'une page. Colonnes et non table :
    -- une séance appartient à un programme, donc à un coach — le jour où deux
    -- personnes relisent la même séance, voir `signalement_vu` pour la forme.
    relue_le         timestamptz,
    relue_par        text REFERENCES users(uid) ON DELETE SET NULL,  -- l'uid qui a coché
    -- « Modifiée à », tenue par les CINQ chemins d'écriture de ligne via
    -- `app/relecture.py`. NULL = jamais horodatée (tout l'historique) : la
    -- migration n'écrit pas de fausse histoire.
    -- ⚠️ `modifiee_par` N'EST PAS DÉCORATIF : sans lui, le coach qui réordonne
    -- une séance qu'il vient de relire la ferait revenir dans sa file.
    modifiee_le      timestamptz,
    modifiee_par     text REFERENCES users(uid) ON DELETE SET NULL,
    UNIQUE (week_id, legacy_id),
    UNIQUE (week_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ON training_sessions (week_id);

-- ============================================================================
-- LA LIGNE D'EXERCICE — le grain d'écriture
-- ============================================================================

CREATE TABLE training_exercises (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
    -- ORDONNE, mais ne DÉSIGNE plus : c'est `id` qui identifie. Toute la valeur
    -- de cette migration tient dans cette distinction.
    position   integer NOT NULL,

    -- NATURE de la ligne (FRE-10). NULL = entraînement : les 9 147 lignes
    -- existantes n'ont pas ce champ, et leur en écrire un forcerait une
    -- réécriture massive pour une information qui se DÉDUIT. Un CHECK plutôt
    -- qu'un ENUM : ajouter une nature ne demandera pas de migration de type.
    kind text CHECK (kind IN ('training', 'warmup', 'rehab')),

    -- ⚠️ RÉFÉRENCE LA BIBLIOTHÈQUE depuis FRE-123 : la contrainte est posée
    -- plus bas, avec la colonne `categorie` constante qu'elle exige. NULLABLE
    -- parce que `NULL` veut dire « pas encore choisi » — ce que `''` disait
    -- avant, et qu'aucune clé étrangère n'aurait accepté.
    name    text,
    -- Variantes CUMULÉES (FRE-33) : « DS » + « PAUSE » plutôt qu'une entrée
    -- `DS PAUSE` de plus au référentiel. L'ETL absorbe la conversion depuis la
    -- chaîne — il n'y a donc PAS à migrer la forme dans Firestore d'abord.
    variant text[],
    tier    integer CHECK (tier BETWEEN 1 AND 3),
    format  text CONSTRAINT format_non_vide CHECK (btrim(format) <> ''),             -- '' | EMOM | AMRAP | CLUSTER (3,6 % des lignes)
    cluster_mode text CONSTRAINT cluster_mode_non_vide CHECK (btrim(cluster_mode) <> ''),
    cluster_rest text CONSTRAINT cluster_rest_non_vide CHECK (btrim(cluster_rest) <> ''),
    tempo   text CONSTRAINT tempo_non_vide CHECK (btrim(tempo) <> ''),

    -- ---- PRESCRIT (texte : fourchettes « 8-10 », « PDC », « 3+2 ») ---------
    sets   text CONSTRAINT sets_non_vide CHECK (btrim(sets) <> ''),
    reps   text CONSTRAINT reps_non_vide CHECK (btrim(reps) <> ''),
    reps_unit text CHECK (reps_unit IN ('count', 'sec')),
    weight text CONSTRAINT weight_non_vide CHECK (btrim(weight) <> ''),
    -- Booléen, lui : le vocabulaire est clos (la chaîne 'true' d'aujourd'hui).
    weight_locked boolean NOT NULL DEFAULT false,
    assistance text CONSTRAINT assistance_non_vide CHECK (btrim(assistance) <> ''),
    aimed_rpe  text CONSTRAINT aimed_rpe_non_vide CHECK (btrim(aimed_rpe) <> ''),
    rest       text CONSTRAINT rest_non_vide CHECK (btrim(rest) <> ''),

    -- ---- RÉALISÉ (saisi par l'athlète) ------------------------------------
    reps_done   text CONSTRAINT reps_done_non_vide CHECK (btrim(reps_done) <> ''),
    weight_done text CONSTRAINT weight_done_non_vide CHECK (btrim(weight_done) <> ''),
    rest_actual text CONSTRAINT rest_actual_non_vide CHECK (btrim(rest_actual) <> ''),
    felt_rpe    text CONSTRAINT felt_rpe_non_vide CHECK (btrim(felt_rpe) <> ''),          -- « Sub5 » et « FAIL » sont des valeurs légitimes
    -- LE RÉALISÉ PAR SÉRIE — RPE, répétitions et charge, dans le même ordre :
    -- la position i des trois tableaux décrit la MÊME série.
    --
    -- ⚠️ CE COMMENTAIRE AFFIRMAIT L'INVERSE JUSQU'AU 06/09 : « le RPE est la
    -- seule chose qui varie réellement d'une série à l'autre ». La donnée l'a
    -- démenti — 73 lignes écrivaient déjà « 10/11/12 » à la main dans
    -- `reps_done`, et le tonnage n'en lisait que la première valeur, sous-
    -- comptant en silence. On ne fabrique donc pas de la donnée qui n'existe
    -- pas : on cesse d'écraser celle qui existait.
    --
    -- ⚠️ `text[]` ET NON `numeric[]` : une série non notée reste `''` au milieu
    -- du tableau (`['10','','12']`), ce qu'un tableau de nombres ne saurait dire
    -- sans inventer un zéro.
    felt_rpe_by_set    text[],
    reps_done_by_set   text[],
    weight_done_by_set text[],
    -- Les TOURS bouclés d'un AMRAP de groupe (FRE-116) — le résultat qu'on note,
    -- là où il finissait en commentaire (« je suis a 6 ou 7 tours »). Appartient
    -- au GROUPE : brokkr l'aligne sur tous ses membres. Le tour entamé n'a pas de
    -- case (William, 16/09 : « tant pis »). `>= 0` : zéro tour est un résultat.
    tours_realises integer CHECK (tours_realises >= 0),
    -- ⚠️ `NULL` ET JAMAIS `''` — une seule façon de dire « rien » (FRE-137).
    -- La base portait les deux encodages de la même absence, et le `''`
    -- REMPLAÇAIT le `NULL` ligne après ligne : la contrainte rend le retour
    -- IMPOSSIBLE plutôt que corrigé à chaque lecture.
    --
    -- `btrim` et non `<> ''` : une case remplie d'espaces n'est pas davantage
    -- une valeur, et le front en produit.
    --
    -- ⚠️ LE ROBINET EST FERMÉ EN AMONT (`prescription.vide_vaut_absence`), sur
    -- les trois chemins d'écriture. Sans lui, cette contrainte ferait un 500 sur
    -- la génération de semaine — le producteur réel de ces vides.
    --
    -- L'état des colonnes ENCORE à migrer vit dans l'invariant
    -- `pas_de_texte_vide` (`make invariants`), pas dans un chiffre écrit ici.
    athlete_feedback text CONSTRAINT athlete_feedback_non_vide CHECK (btrim(athlete_feedback) <> ''),

    coach_note text CONSTRAINT coach_note_non_vide CHECK (btrim(coach_note) <> ''),
    link       text CONSTRAINT link_non_vide       CHECK (btrim(link) <> ''),
    -- Liaison d'un groupe de lignes (FRE-31) : des lignes CONSÉCUTIVES partageant
    -- cette clé forment un groupe. Reste du texte plutôt qu'une FK vers une table
    -- de groupes, et le DROPSET (FRE-36) n'y change rien : `group_id` SE RÉPÈTE
    -- d'une séance à l'autre — la génération recopie le même identifiant dans
    -- chaque semaine produite — donc une table indexée dessus mélangerait les
    -- semaines.
    group_id text CONSTRAINT group_id_non_vide CHECK (btrim(group_id) <> ''),
    -- NATURE du groupe (FRE-36). CHECK plutôt qu'ENUM, comme `kind` ci-dessus :
    -- ajouter une nature ne demandera pas de migration de type.
    --
    -- NULLABLE, et la reprise du 29/08 a mis une nature sur les 246 lignes
    -- groupées de l'époque : le front écrit « biset » à chaque nouveau liage, et
    -- sans reprise la base aurait porté DEUX encodages de la même chose. Le
    -- défaut de lecture (NULL → bi-set) reste comme FILET.
    --
    -- ⚠️ CE COMMENTAIRE A AFFIRMÉ « PLUS AUCUN GROUPE DE PRODUCTION N'EST À
    -- NULL » JUSQU'AU 06/09, ET C'ÉTAIT DEVENU FAUX. Vrai le 29/08 au soir,
    -- démenti dès le 01/09 : quatre groupes créés depuis n'ont aucune nature —
    -- un en séance, trois dans la BASE. Un chemin d'écriture ne la pose donc
    -- pas, et le filet de lecture masque l'écart au lieu de le signaler.
    --
    -- C'est le motif exact que FRE-143 traite : une affirmation sur la DONNÉE
    -- est un test qui n'a pas été écrit. Celle-ci en a un désormais —
    -- `scripts/verifier_invariants.py`, invariant `groupe_sans_nature`, et
    -- c'est LUI qui fait foi. Ne pas remettre de chiffre ici.
    --
    -- ⚠️ ELLE APPARTIENT AU GROUPE, et la colonne est par LIGNE : deux lignes
    -- d'un même groupe peuvent donc se contredire. Ce n'est pas théorique
    -- (`rest` et `sets` divergent sur quelques groupes réels), et c'est brokkr
    -- qui tranche (`prescription.normaliser_groupes`), pas la ligne.
    group_kind text CHECK (group_kind IN ('biset', 'dropset', 'circuit', 'emom', 'amrap')),
    -- UNBROKEN (FRE-116) : sans lâcher la barre jusqu'à la ligne SUIVANTE du
    -- groupe. Un LIEN entre deux lignes, pas une nature : c'est ce qui permet trois
    -- mouvements sans lâcher, puis deux autres, dans un seul circuit. Toujours
    -- `false` sur la dernière ligne d'un groupe et hors groupe — brokkr le range.
    unbroken boolean NOT NULL DEFAULT false,

    increment      text CONSTRAINT increment_non_vide CHECK (btrim(increment) <> ''),
    increment_unit text CHECK (increment_unit IN ('kg', 'reps', 'rpe', 'sets')),

    UNIQUE (session_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ON training_exercises (session_id);
-- Le Tracking et les records interrogent par NOM de mouvement, en travers des
-- séances : c'est le seul accès qui ne passe pas par le parent.
CREATE INDEX ON training_exercises (upper(name));

-- ============================================================================
-- LES LIGNES DE LA BASE — deux tables, colonnes NOMMÉES À L'IDENTIQUE
--
-- Le modèle de FRE-33 et FRE-31 s'est cassé sur le NOM, pas sur le stockage :
-- `movement` d'un côté, `name` de l'autre ; `variation` contre `variant`. On
-- corrigeait un arbre et on oubliait l'autre. Ici les colonnes portent les mêmes
-- noms qu'au-dessus, et le contrat partage un seul modèle de « prescription ».
--
-- Deux tables et non une : les formes divergent plus qu'il n'y paraît. `tier`
-- est sur 1 316 principes et 0 accessoire, `day` sur 1 309 accessoires et 0
-- principe, et AUCUNE ligne de BASE ne porte de donnée réalisée (ni felt_rpe, ni
-- reps_done, ni weight_done…). Une table commune coûterait sept colonnes
-- structurellement NULL et un parent polymorphe, pour traiter une cause qui
-- n'est pas là.
-- ============================================================================

CREATE TABLE training_base_principles (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id uuid NOT NULL REFERENCES training_blocks(id) ON DELETE CASCADE,
    position integer NOT NULL,
    -- ⚠️ RÉFÉRENCE LA BIBLIOTHÈQUE depuis FRE-123 : la contrainte est posée
    -- plus bas, avec la colonne `categorie` constante qu'elle exige. NULLABLE
    -- parce que `NULL` veut dire « pas encore choisi » — ce que `''` disait
    -- avant, et qu'aucune clé étrangère n'aurait accepté.
    name     text,
    variant  text[],
    tier     integer NOT NULL CHECK (tier BETWEEN 1 AND 3),
    -- NATURE de la ligne (FRE-10), comme sur `training_exercises` : NULL =
    -- entraînement. Ajoutée après coup — la BASE savait la SAISIR bien avant
    -- de savoir la stocker, et la perdait donc à chaque enregistrement.
    kind     text CHECK (kind IN ('training', 'warmup', 'rehab')),
    format   text CONSTRAINT format_non_vide CHECK (btrim(format) <> ''),
    cluster_mode text CONSTRAINT cluster_mode_non_vide CHECK (btrim(cluster_mode) <> ''),
    cluster_rest text CONSTRAINT cluster_rest_non_vide CHECK (btrim(cluster_rest) <> ''),
    tempo    text CONSTRAINT tempo_non_vide CHECK (btrim(tempo) <> ''),
    sets     text CONSTRAINT sets_non_vide CHECK (btrim(sets) <> ''),
    reps     text CONSTRAINT reps_non_vide CHECK (btrim(reps) <> ''),
    reps_unit text CHECK (reps_unit IN ('count', 'sec')),
    weight   text CONSTRAINT weight_non_vide CHECK (btrim(weight) <> ''),
    weight_locked boolean NOT NULL DEFAULT false,
    assistance text CONSTRAINT assistance_non_vide CHECK (btrim(assistance) <> ''),
    aimed_rpe  text CONSTRAINT aimed_rpe_non_vide CHECK (btrim(aimed_rpe) <> ''),
    rest       text CONSTRAINT rest_non_vide CHECK (btrim(rest) <> ''),
    coach_note text CONSTRAINT coach_note_non_vide CHECK (btrim(coach_note) <> ''),
    increment      text CONSTRAINT increment_non_vide CHECK (btrim(increment) <> ''),
    increment_unit text CHECK (increment_unit IN ('kg', 'reps', 'rpe', 'sets')),
    UNIQUE (block_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ON training_base_principles (block_id);

CREATE TABLE training_base_accessories (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id uuid NOT NULL REFERENCES training_blocks(id) ON DELETE CASCADE,
    position integer NOT NULL,
    -- Le jour de la semaine où l'accessoire tombe. Propre aux accessoires : un
    -- principe est placé par le `day_split` du bloc, pas par lui-même.
    day      text NOT NULL,
    -- ⚠️ RÉFÉRENCE LA BIBLIOTHÈQUE depuis FRE-123 : la contrainte est posée
    -- plus bas, avec la colonne `categorie` constante qu'elle exige. NULLABLE
    -- parce que `NULL` veut dire « pas encore choisi » — ce que `''` disait
    -- avant, et qu'aucune clé étrangère n'aurait accepté.
    name     text,
    variant  text[],
    -- NATURE de la ligne (FRE-10), comme sur `training_exercises` : NULL =
    -- entraînement. Ajoutée après coup — la BASE savait la SAISIR bien avant
    -- de savoir la stocker, et la perdait donc à chaque enregistrement.
    kind     text CHECK (kind IN ('training', 'warmup', 'rehab')),
    format   text CONSTRAINT format_non_vide CHECK (btrim(format) <> ''),
    cluster_mode text CONSTRAINT cluster_mode_non_vide CHECK (btrim(cluster_mode) <> ''),
    cluster_rest text CONSTRAINT cluster_rest_non_vide CHECK (btrim(cluster_rest) <> ''),
    tempo    text CONSTRAINT tempo_non_vide CHECK (btrim(tempo) <> ''),
    sets     text CONSTRAINT sets_non_vide CHECK (btrim(sets) <> ''),
    reps     text CONSTRAINT reps_non_vide CHECK (btrim(reps) <> ''),
    reps_unit text CHECK (reps_unit IN ('count', 'sec')),
    weight   text CONSTRAINT weight_non_vide CHECK (btrim(weight) <> ''),
    weight_locked boolean NOT NULL DEFAULT false,
    assistance text CONSTRAINT assistance_non_vide CHECK (btrim(assistance) <> ''),
    aimed_rpe  text CONSTRAINT aimed_rpe_non_vide CHECK (btrim(aimed_rpe) <> ''),
    rest       text CONSTRAINT rest_non_vide CHECK (btrim(rest) <> ''),
    coach_note text CONSTRAINT coach_note_non_vide CHECK (btrim(coach_note) <> ''),
    increment      text CONSTRAINT increment_non_vide CHECK (btrim(increment) <> ''),
    increment_unit text CHECK (increment_unit IN ('kg', 'reps', 'rpe', 'sets')),
    -- Groupe défini DANS la base (FRE-31). ⚠️ RÈGLE MÉTIER : ce champ n'existe
    -- que sur les accessoires. Un groupe ne concerne que du renforcement —
    -- vérifié sur les groupes réels, aucun ne porte de ligne à tier.
    group_id text CONSTRAINT group_id_non_vide CHECK (btrim(group_id) <> ''),
    -- Voir `training_exercises.group_kind` (FRE-36) : NULL = bi-set, et la nature
    -- est tranchée par le serveur pour tout le groupe.
    group_kind text CHECK (group_kind IN ('biset', 'dropset', 'circuit', 'emom', 'amrap')),
    -- UNBROKEN (FRE-116) : sans lâcher la barre jusqu'à la ligne SUIVANTE du
    -- groupe. Un LIEN entre deux lignes, pas une nature : c'est ce qui permet trois
    -- mouvements sans lâcher, puis deux autres, dans un seul circuit. Toujours
    -- `false` sur la dernière ligne d'un groupe et hors groupe — brokkr le range.
    unbroken boolean NOT NULL DEFAULT false,
    UNIQUE (block_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ON training_base_accessories (block_id);

-- ============================================================================
-- ANALYTICS — projection dérivée (pas une table de domaine)
-- ============================================================================
-- `training_sets` aplatit l'arbre d'entraînement (macro → bloc → semaine →
-- séance → exercice) en UNE table interrogeable en SQL, pour le Tracking et les
-- dashboards. Elle est RECONSTRUITE INTÉGRALEMENT par
-- scripts/etl_training_sets.py : la source de vérité reste l'arbre relationnel,
-- rien n'est perdu si on la vide. Donc pas de garde-fou anti-écrasement
-- (contrairement aux ETL de migration).
--
-- ⚠️ CE N'EST PLUS UN ETL, ET C'EST TOUT LE PROPOS (FRE-48, 17/08/2026). La
-- source était Firestore, un autre magasin : il fallait l'extraire et la parser
-- en Python. Depuis FRE-12 elle est dans CETTE base — il ne reste donc rien à
-- transporter, et un `INSERT … SELECT` remplace 421 lignes. Le parsing vit dans
-- les fonctions `ff_*` ci-dessous, au plus près de la donnée.
--
-- GRAIN : une ligne par exercice d'une séance (PAS par série) — dans la source,
-- sets/reps/weight sont portés par la ligne d'exercice ; seul le RPE existe par
-- série (`rpe_by_set`). La donnée d'origine étant saisie à la main en texte,
-- tout est parsé en tolérant : NULL si imparsable.

-- ---------------------------------------------------------------------------
-- Les parseurs de la projection. Tout est du texte à la source : un coach écrit
-- « 8-10 », « PDC », « Sub5 ». IMMUTABLE pour que le planificateur puisse les
-- évaluer d'avance ; préfixe `ff_` pour ne pas squatter un nom.
--
-- ⚠️ ÉQUIVALENCE AVEC LES PARSEURS PYTHON QU'ELLES REMPLACENT : PROUVÉE. Elles
-- ont été rejouées sur `training_sets.raw`, qui contenait l'entrée Firestore
-- exacte de chaque ligne — 9 902 lignes, zéro divergence. `raw` ayant disparu,
-- cette preuve n'est plus rejouable : ne pas « améliorer » ces fonctions à
-- l'aveugle.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ff_num(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- Premier nombre d'une saisie manuelle, virgule ou point.
    -- ⚠️ `(?:…)` NON capturant : avec une parenthèse capturante, substring()
    -- renvoie la CAPTURE et non le motif — donc la décimale seule.
    SELECT substring(replace(v, ',', '.') from '-?[0-9]+(?:\.[0-9]+)?')::numeric
$$;

CREATE OR REPLACE FUNCTION ff_reps_low(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT coalesce(
        (regexp_match(replace(v, ',', '.'),
            '^\s*([0-9]+(?:\.[0-9]+)?)\s*[-/]\s*([0-9]+(?:\.[0-9]+)?)\s*$'))[1]::numeric,
        ff_num(v))
$$;

CREATE OR REPLACE FUNCTION ff_reps_high(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT (regexp_match(replace(v, ',', '.'),
        '^\s*([0-9]+(?:\.[0-9]+)?)\s*[-/]\s*([0-9]+(?:\.[0-9]+)?)\s*$'))[2]::numeric
$$;

CREATE OR REPLACE FUNCTION ff_bodyweight(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT upper(btrim(coalesce(v, ''))) IN ('PDC', 'BW')
$$;

CREATE OR REPLACE FUNCTION ff_charge(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- « PDC » n'est pas une charge externe, mais pas un vide non plus : le flag
    -- `bodyweight` porte l'information, la colonne numérique reste NULL.
    SELECT CASE WHEN ff_bodyweight(v) THEN NULL ELSE ff_num(v) END
$$;

CREATE OR REPLACE FUNCTION ff_rpe(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- Un RPE plausible est dans 0-10 — au-delà c'est une saisie parasite.
    -- « Sub5 » et « FAIL » → NULL, le texte reste dans `felt_rpe_raw`.
    SELECT CASE WHEN ff_num(v) BETWEEN 0 AND 10 THEN ff_num(v) END
$$;

CREATE OR REPLACE FUNCTION ff_rpe_by_set(v text[]) RETURNS numeric[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- Ordre préservé, valeurs hors 0-10 écartées, tableau vide → NULL.
    SELECT nullif(array_agg(n ORDER BY ord), '{}'::numeric[])
    FROM unnest(v) WITH ORDINALITY AS t(x, ord),
         LATERAL (SELECT ff_num(t.x)) AS p(n)
    WHERE n BETWEEN 0 AND 10
$$;
-- ⚠️ UNE FONCTION PAR TYPE, PARCE QUE LES VOCABULAIRES DIFFÈRENT. `ff_rpe_by_set`
-- borne à [0, 10] et connaît `FAIL` ; des répétitions et des kilos n'ont ni l'un
-- ni l'autre. Réutiliser celle du RPE aurait silencieusement écrasé toute charge
-- au-dessus de 10 kg.
--
-- La POSITION est conservée : `['10','','12']` rend `{10,NULL,12}`, jamais
-- `{10,12}` — décaler ferait lire la troisième série à la place de la deuxième.
CREATE OR REPLACE FUNCTION ff_reps_by_set(v text[]) RETURNS numeric[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN v IS NULL THEN NULL
                ELSE (SELECT array_agg(ff_num(x) ORDER BY o)
                        FROM unnest(v) WITH ORDINALITY AS t(x, o)) END
$$;

CREATE OR REPLACE FUNCTION ff_charge_by_set(v text[]) RETURNS numeric[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN v IS NULL THEN NULL
                ELSE (SELECT array_agg(ff_charge(x) ORDER BY o)
                        FROM unnest(v) WITH ORDINALITY AS t(x, o)) END
$$;

-- LES SÉRIES TENUES (FRE-110), extraites de l'ETL le 07/09 pour que la LECTURE
-- VIVANTE du suivi les calcule à l'identique (FRE-148). Deux appelants, une
-- définition : la divergence devient impossible au lieu d'être surveillée.
CREATE OR REPLACE FUNCTION ff_series_tenues(sets text, felt_rpe_by_set text[])
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- ⚠️ « SI RIEN N'EST REMPLI, ALORS RIEN N'EST FAIT » (William, 01/09). Une
    -- case unique ne se lit PAS comme « la dernière série » : le tableau se lit
    -- position par position, donc `['FAIL']` est la série 1.
    --
    -- ⚠️ ET CE N'EST PAS UN FILTRE : la ligne reste, avec zéro série. Elle garde
    -- sa charge, son RPE, sa trace d'échec — c'est le volume qui vaut zéro, pas
    -- la séance qui disparaît.
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM unnest(coalesce(felt_rpe_by_set, '{}')) v
                      WHERE upper(btrim(v)) = 'FAIL')
        THEN (SELECT count(*)::int FROM unnest(felt_rpe_by_set) v
               WHERE btrim(v) <> '' AND upper(btrim(v)) <> 'FAIL')
        ELSE round(ff_num(sets))::int
    END
$$;

-- LE TONNAGE D'UNE LIGNE (guichet, 12/09) — déménagé de l'ETL de `training_sets`
-- pour la même raison que `ff_series_tenues` cinq jours plus tôt : une LECTURE
-- VIVANTE en a besoin. `training_sets` est reconstruite à 03:30 ; la séance
-- finie aujourd'hui n'y est pas, et c'est celle que la file du coach sert.
--
-- ⚠️ UNE SOMME DE PRODUITS, PAS UN RECTANGLE (06/09) : les reps et la charge se
-- saisissent série par série, et le produit des moyennes n'est pas la somme des
-- produits dès que la charge varie — 10×100 + 5×50 = 1 250, contre 2×7,5×75 =
-- 1 125. Les tableaux vides retombent sur les scalaires à chaque position, donc
-- `sets × reps × charge` : aucune ligne d'avant la saisie par série ne bouge.
--
-- ⚠️ `tenues = 0` REND 0, MAIS UNE LIGNE SANS CHARGE REND NULL. Toutes les
-- séries échouées, c'est ZÉRO kilo déplacé — une mesure, qui pèse dans les
-- moyennes. Une charge inconnue, c'est « on ne sait pas » — NULL, que `sum()`
-- ignore. Les confondre a coûté 2 915 lignes le 06/09.
--
-- SAUF EN ISOMÉTRIE : « 3 × 60 s @ 40 kg » n'est pas 7 200 kg, rien n'est
-- déplacé — `reps` porte alors des secondes.
CREATE OR REPLACE FUNCTION ff_tonnage(
    sets text, reps text, reps_done text, reps_unit text,
    weight text, weight_done text,
    felt_rpe_by_set text[], reps_done_by_set text[], weight_done_by_set text[]
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
        WHEN reps_unit IS DISTINCT FROM 'sec' AND t.tenues IS NOT NULL
        THEN CASE WHEN t.tenues = 0 THEN 0
                  ELSE (SELECT sum(coalesce(t.rbs[i], coalesce(t.rd, t.r))
                                 * coalesce(t.wbs[i], coalesce(t.wd, t.w)))
                          FROM generate_series(1, t.tenues) AS i)
             END
    END
    FROM (SELECT ff_series_tenues(sets, felt_rpe_by_set)  AS tenues,
                 ff_reps_by_set(reps_done_by_set)          AS rbs,
                 ff_charge_by_set(weight_done_by_set)      AS wbs,
                 ff_num(reps_done)                         AS rd,
                 ff_reps_low(reps)                         AS r,
                 ff_charge(weight_done)                    AS wd,
                 ff_charge(weight)                         AS w) t
$$;

-- LES MOYENNES D'UN RÉALISÉ SAISI PAR SÉRIE (FRE-136), extraites du navigateur
-- le 07/09. `felt_rpe`, `reps_done` et `weight_done` sont des DÉRIVÉES : le
-- chemin d'écriture les recalcule, et le rattrapage des lignes déjà écrites les
-- a appelées aussi. Deux appelants, une définition.
--
-- ⚠️ DEUX FONCTIONS ET NON UNE : le RPE a deux règles qui n'appartiennent qu'à
-- lui — `FAIL` absorbant, et l'arrondi au demi-point SUPÉRIEUR parce que
-- l'échelle ne connaît que les demis. Les faire servir aux répétitions
-- transformerait « 10, 11, 12 » en « 11 », et plafonnerait toute charge au-delà
-- de 10.
--
-- ⚠️ ÉPROUVÉES CONTRE LA RÈGLE TYPESCRIPT, cas par cas : les 21 formes de
-- `par-serie.test.ts` et de `rpe-scale.ts` exécutées des deux côtés, zéro écart.
-- `tests/test_moyennes_par_serie.py` fige cette table.

CREATE OR REPLACE FUNCTION ff_moyenne_serie(v text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- ⚠️ UNE SÉRIE VIDE N'EST PAS UNE SÉRIE À ZÉRO. `['10','','12']` dit « la
    -- deuxième n'est pas notée » ; la compter pour 0 ferait tomber la moyenne à
    -- 7,3 et le coach lirait un effondrement qui n'a pas eu lieu.
    --
    -- ⚠️ LA VIRGULE DÉCIMALE EST LA NORME DE SAISIE : la production porte
    -- « 20,4 », « 17,5 », « 12,5 ». `ff_num` la lit déjà.
    --
    -- ⚠️ AU PLUS UNE DÉCIMALE, ET SANS ZÉRO INUTILE. « 10, 11, 12 » rend « 11 »
    -- et non « 11.0 » ; « 10, 11 » rend « 10.5 ». Trois séries à 10, 11 et 11
    -- donnent 10,666… : entier, ça mentirait sur l'écart.
    --
    -- ⚠️ REND `NULL` QUAND RIEN N'EST NOTÉ — jamais `'0'`, qui se lirait « il a
    -- fait zéro » là où il faut lire « il n'a rien dit », et plus `''` depuis
    -- FRE-137 : une absence s'écrit d'une seule façon. Sans ce changement, le
    -- CHECK posé sur `reps_done` aurait fait un 500 sur le geste « j'efface mon
    -- détail par série » — cette fonction ÉCRIT la colonne.
    SELECT (SELECT trim(trailing '.' FROM
                        trim(trailing '0' FROM to_char(round(avg(n), 1), 'FM999999990.0')))
              FROM unnest(coalesce(v, '{}')) AS x,
                   LATERAL (SELECT ff_num(x)) AS p(n)
             WHERE btrim(x) <> '' AND n IS NOT NULL)
$$;


-- --------------------------------------------------------------------------- #
-- 2. LE RPE RESSENTI — ses deux règles à lui
-- --------------------------------------------------------------------------- #

CREATE OR REPLACE FUNCTION ff_moyenne_rpe(v text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- 1. un seul `FAIL` → `FAIL` (absorbant : le format est raté) ;
    -- 2. sinon moyenne (`Sub5` vaut 4) ; si < 5 → `Sub5` ; sinon arrondi au
    --    demi-point SUPÉRIEUR, l'échelle ne connaissant que les demis.
    -- Rend `NULL` si rien n'est noté (cf. `ff_moyenne_serie`). Une valeur unique
    -- est sa propre moyenne.
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM unnest(coalesce(v, '{}')) x
                      WHERE btrim(x) = 'FAIL')
        THEN 'FAIL'
        ELSE (SELECT CASE WHEN avg(n) < 5 THEN 'Sub5'
                          ELSE trim(trailing '.' FROM
                               trim(trailing '0' FROM
                                    to_char(ceil(avg(n) * 2) / 2, 'FM999999990.0'))) END
                FROM unnest(coalesce(v, '{}')) AS x,
                     LATERAL (SELECT CASE WHEN btrim(x) = 'Sub5' THEN 4
                                          ELSE ff_num(x) END) AS p(n)
               WHERE btrim(x) <> '' AND n IS NOT NULL)
    END
$$;

CREATE OR REPLACE FUNCTION ff_tempo_somme(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- Somme des CHIFFRES d'un tempo, NULL si ce n'en est pas un (FRE-103).
    --
    -- ⚠️ CONDITION D'ENTRÉE ÉTROITE EXPRÈS : sur 3 032 lignes portant un tempo,
    -- 1 462 sont TEXTUELLES (« 1CT PAUSE » 693, « DS » 305, « 3CT CONCENTRIQUE »
    -- 114), conservées volontairement par FRE-17 — « une intention, pas un
    -- rythme ». Un parseur laxiste rendrait 1 pour « 1CT PAUSE » et 130 pour
    -- « E1:30mom » : des nombres plausibles et faux, les pires de tous.
    --
    -- ⚠️ LARGEUR 3 OU 4, PAS 4 : « ABCD » est la forme MINORITAIRE. 1 055 tempos
    -- chiffrés tiennent en trois caractères contre 515 en quatre, « 300 » seul
    -- en compte 598.
    --
    -- ⚠️ LE `X` EST RECONNU MAIS NE S'ADDITIONNE PAS. Le reconnaître : « 31X1 »
    -- est canonique depuis FRE-17, 309 lignes en portent un. Ne pas le compter :
    -- « explosif » n'ajoute pas de temps sous tension.
    SELECT CASE
        WHEN upper(btrim(coalesce(v, ''))) ~ '^[0-9X]{3,4}$' THEN (
            SELECT coalesce(sum(c::numeric), 0)
            FROM regexp_split_to_table(upper(btrim(v)), '') AS c
            WHERE c ~ '^[0-9]$'
        )
    END
$$;

CREATE OR REPLACE FUNCTION ff_mechano(tempo text, reps numeric, reps_unit text)
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- MÉCANOTRANSDUCTION : le temps sous tension d'une série, en secondes.
    --
    -- ⚠️ `reps_unit = 'sec'` NE SE SCORE PAS : les « répétitions » sont alors des
    -- secondes de gainage, et multiplier une durée par une somme de durées ne
    -- veut rien dire — le résultat aurait pourtant l'air d'un score.
    --
    -- ⚠️ `reps` EST DÉJÀ LA BORNE BASSE d'une fourchette (`ff_reps_low`) : on ne
    -- crédite pas la borne haute, qui n'a pas été confirmée. Même règle que les
    -- records, au même endroit qu'eux.
    SELECT CASE
        WHEN btrim(coalesce(reps_unit, '')) = 'sec' THEN NULL
        -- ⚠️ SEULE L'ABSENCE SE TAIT — `reps = 0` REND BIEN 0. Une série
        -- rapportée à zéro répétition a un temps sous tension NUL, ce qui est un
        -- fait mesuré ; `NULL` dirait « pas de score », ce qui est faux. C'est la
        -- même distinction que le tonnage tient déjà, et que l'écran attend
        -- (`mt !== null`, pas `if (!mt)`).
        WHEN reps IS NULL THEN NULL
        ELSE ff_tempo_somme(tempo) * reps
    END
$$;

CREATE TABLE training_sets (
    id             bigserial PRIMARY KEY,
    -- Rattachement (par ids LEGACY : lisibles et stables côté Firestore)
    athlete_id     text NOT NULL,          -- athletes.legacy_id
    program_id     text NOT NULL,          -- programs.id
    macro_number   integer,
    block_number   integer,
    week_number    integer,
    session_index  integer NOT NULL,
    session_name   text,
    -- Date de la séance si l'athlète l'a lancée, sinon début de semaine (fallback)
    session_date   date,
    date_exact     boolean NOT NULL DEFAULT false,
    -- L'exercice
    exercise_index integer NOT NULL,
    -- ⚠️ RÉFÉRENCE LA BIBLIOTHÈQUE depuis FRE-123 : la contrainte est posée
    -- plus bas, avec la colonne `categorie` constante qu'elle exige. NULLABLE
    -- parce que `NULL` veut dire « pas encore choisi » — ce que `''` disait
    -- avant, et qu'aucune clé étrangère n'aurait accepté.
    exercise       text NOT NULL,          -- normalisé en MAJUSCULES
    -- La ligne SOURCE. Remplace l'ancien `raw` (jsonb) : une identité plutôt
    -- qu'une copie figée. CASCADE — la projection se nettoie d'elle-même quand
    -- un athlète ou une semaine disparaît, au lieu d'attendre un rebuild.
    exercise_id    uuid REFERENCES training_exercises(id) ON DELETE CASCADE,
    -- LISTE depuis FRE-33/FRE-50 : la source est un `text[]`, et l'ancien filtre
    -- rejetait toute liste — y compris à un seul élément. En `text`, les 4 879
    -- variantes seraient parties en silence au premier rebuild.
    variant        text[],
    assistance     text,
    tempo          text,
    format         text,                   -- '' | EMOM | AMRAP | CLUSTER
    tier           integer,
    superset_group text,                   -- groupId : même valeur = superset
    -- Nature de la LIGNE (FRE-10) : NULL/'training' = entraînement (compté en
    -- stats), 'warmup'/'rehab' = exclu des agrégats. Le tonnage reste calculé
    -- pour ces lignes (un échauffement chargé déplace un poids réel) — c'est
    -- l'agrégation qui les ignore, pas la donnée.
    kind           text,
    -- Prescription / réalisation
    -- ⚠️ LES SÉRIES TENUES depuis FRE-110, pas les prescrites : une série notée
    -- `FAIL` dans `felt_rpe_by_set` n'est pas comptée. C'est ce qui alimente le
    -- tonnage ET le volume — les deux comptaient du travail non fait.
    sets           integer,
    reps           numeric,                -- borne BASSE si plage ("8-10" → 8)
    reps_high      numeric,                -- borne haute d'une plage, sinon NULL
    reps_done      numeric,
    reps_unit      text,                   -- '' | count | sec
    bodyweight     boolean NOT NULL DEFAULT false,  -- charge "PDC" (poids du corps)
    weight_kg      numeric,                -- la PRESCRIPTION (charge visée par le coach)
    weight_done_kg numeric,                -- la charge RÉALISÉE (NULL si non saisie) — FRE-18
    aimed_rpe      numeric,
    felt_rpe       numeric,                -- NULL si non numérique (ex. "FAIL")
    felt_rpe_raw   text,                   -- la saisie brute ("Sub5", "FAIL"…)
    rpe_by_set     numeric[],
    -- Répétitions et charge par série, projetées. Elles servent la
    -- DISPERSION d'une ligne, que la moyenne écrase.
    reps_by_set    numeric[],
    weight_by_set  numeric[],
    rest_s         numeric,
    -- Dérivé : sets TENUES × reps EFFECTIVES × charge EFFECTIVE — le réalisé s'il
    -- est saisi (reps_done / weight_done_kg), sinon le prescrit (NULL si une pièce
    -- manque). ⚠️ « TENUES » depuis FRE-110 : une série notée `FAIL` ne compte pas.
    tonnage_kg     numeric,
    -- Dérivé : le même calcul avec les séries PRESCRITES — le repère du graphe.
    -- Égal à `tonnage_kg` partout où rien n'a échoué ; c'est l'ÉCART qui se lit.
    tonnage_prevu_kg numeric,
    -- Les séries PRESCRITES, pour le repère du volume en RÉPÉTITIONS : le graphe
    -- bascule entre les deux unités, et `sum(sets × reps)` baisse comme le
    -- tonnage. Sans elles, une moitié du graphe resterait inexpliquée.
    sets_prevus    integer,
    -- Dérivé : somme des chiffres du tempo × reps EFFECTIVES (FRE-103).
    -- ⚠️ NE CONCERNE QUE `kind = 'rehab'` — un agrégat doit INVERSER le filtre
    -- habituel des stats, qui exclut justement rehab. Écrit par réflexe sur le
    -- filtre courant, il rendrait invariablement zéro.
    mechano        numeric,
    athlete_feedback text,
    coach_note     text
);

CREATE INDEX ON training_sets (athlete_id, session_date);
CREATE INDEX ON training_sets (exercise);
-- ⚠️ POUR LA CASCADE, PAS POUR LES LECTURES (FRE-90). Personne n'interroge cette
-- table par `exercise_id` — l'index sert uniquement à `ON DELETE CASCADE`, que
-- Postgres n'indexe PAS tout seul (contrairement à MySQL). Sans lui, retirer un
-- exercice d'une prog balayait les 10 000 lignes.
CREATE INDEX training_sets_exercise_id ON training_sets (exercise_id);
CREATE INDEX ON training_sets (program_id, macro_number, block_number, week_number);

-- Objectifs d'un BLOC (basculés 2026-08-03). Premier morceau de l'arbre
-- d'entraînement à quitter Firestore : là-bas, un objectif était RECOPIÉ sur
-- chaque semaine du bloc (dénormalisation documentaire — 18 objectifs distincts
-- stockés en 83 exemplaires), si bien qu'éditer un objectif réécrivait N docs.
-- Ici : une ligne = un objectif, porté par le bloc, plus aucune duplication.
-- Le reste de l'arbre a suivi treize jours plus tard (FRE-12, 2026-08-16).
CREATE TABLE block_objectives (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- VRAIE clé étrangère depuis FRE-12. Cette table est née le 2026-08-03, quand
    -- l'arbre vivait encore dans Firestore : elle désignait alors le bloc par son
    -- id documentaire, en text, sans table en face, et il fallait porter AUSSI le
    -- programme et le macro pour lever l'ambiguïté (un id Firestore n'est pas
    -- unique entre programmes). Une seule condition suffit désormais.
    block_id   uuid NOT NULL REFERENCES training_blocks(id) ON DELETE CASCADE,
    -- Ordre d'affichage, autrefois implicite dans le tableau JSON Firestore.
    position   integer NOT NULL,
    -- ⚠️ RÉFÉRENCE LA BIBLIOTHÈQUE depuis FRE-123 : la contrainte est posée
    -- plus bas, avec la colonne `categorie` constante qu'elle exige. NULLABLE
    -- parce que `NULL` veut dire « pas encore choisi » — ce que `''` disait
    -- avant, et qu'aucune clé étrangère n'aurait accepté.
    exercise   text,
    variant    text,
    format     text,
    sets       text,
    reps       text,
    weight_min text,
    weight_max text,
    assistance text,
    -- ⚠️ ATTEINT OU NON — une COCHE, pas une mesure (décision de William, 03/09).
    -- « C'est une satisfaction, c'est pédagogique. Pas pour du tracking : le
    -- tableau des PR le fait. » D'où l'absence de « réalisé » en face du
    -- prescrit, qui serait la forme d'un suivi.
    --
    -- Une DATE plutôt qu'un booléen, pour le même coût : `athlete_goals` porte
    -- déjà `achieved_on` et l'app dit « Atteint le 12 août ». Un troisième
    -- vocabulaire pour la même idée se paierait à chaque lecture de code — et
    -- NULL dit « pas atteint » sans qu'on ait à l'écrire.
    atteint_le date,
    UNIQUE (block_id, position)
);
CREATE INDEX ON block_objectives (block_id);



-- --------------------------------------------------------------------------- #
-- FRE-123 — LE NOM D'EXERCICE EST UNE RÉFÉRENCE
--
-- ⚠️ UNE COLONNE `categorie` CONSTANTE PAR TABLE, ET C'EST LE PRIX DU MODÈLE.
--    `library_entries` est unique sur `(category, name)` ; une clé étrangère
--    doit référencer ce couple ENTIER, et Postgres ne sait pas viser un index
--    unique PARTIEL. Un `UNIQUE (name)` seul est impossible : « EXCENTRIQUE
--    UNIQUEMENT » existe légitimement en exercice ET en variante. C'est le même
--    arbitrage que `objectifs_techniques` a payé en FRE-122.
--
-- ⚠️ CE QU'AUCUNE CLÉ NE COUVRE : les VARIANTES, qui vivent en `text[]`.
--    Postgres ne référence pas un ÉLÉMENT de tableau — les renommer restera un
--    geste manuel, colonne par colonne.
--
-- Sans ces contraintes, un renommage depuis la bibliothèque orphelinait
-- 4 125 lignes en silence, records de compétition compris.
-- --------------------------------------------------------------------------- #

ALTER TABLE training_exercises        ADD COLUMN categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE training_sets             ADD COLUMN categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE training_base_principles  ADD COLUMN categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE training_base_accessories ADD COLUMN categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE athlete_goals             ADD COLUMN categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE athlete_prs               ADD COLUMN categorie library_category NOT NULL DEFAULT 'exercices';
ALTER TABLE block_objectives          ADD COLUMN categorie library_category NOT NULL DEFAULT 'exercices';

-- ⚠️ ET LA STRUCTURE DANS LA CLÉ (19/09) : une bibliothèque par structure, donc
--    « SQUAT » trois fois. La colonne est celle de l'ATHLÈTE, posée par la base
--    (`ff_pose_la_structure`, en fin de fichier) : une vingtaine de chemins
--    insèrent des lignes, et en oublier un rangerait une ligne SCAPPULIFT dans la
--    bibliothèque French Forge sans que la clé proteste. Un renommage ne se
--    propage plus qu'aux lignes de la structure de l'entrée.
ALTER TABLE training_exercises        ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE training_sets             ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE training_base_principles  ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE training_base_accessories ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE athlete_goals             ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE athlete_prs               ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE block_objectives          ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);

ALTER TABLE training_exercises ADD CONSTRAINT training_exercises_mouvement_fkey
  FOREIGN KEY (structure, categorie, name) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE training_sets ADD CONSTRAINT training_sets_mouvement_fkey
  FOREIGN KEY (structure, categorie, exercise) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE training_base_principles ADD CONSTRAINT training_base_principles_mouvement_fkey
  FOREIGN KEY (structure, categorie, name) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE training_base_accessories ADD CONSTRAINT training_base_accessories_mouvement_fkey
  FOREIGN KEY (structure, categorie, name) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE athlete_goals ADD CONSTRAINT athlete_goals_mouvement_fkey
  FOREIGN KEY (structure, categorie, exercise) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;
ALTER TABLE athlete_prs ADD CONSTRAINT athlete_prs_mouvement_fkey
  FOREIGN KEY (structure, categorie, movement) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;

-- LE REPOS LIBRE N'A QU'UNE ÉCRITURE (FRE-169) : NULL. `-1` était la sentinelle
-- historique — et `ff_num('-1')` vaut −1, un repos de moins une seconde que la
-- projection moyennait. Le CHECK refuse le négatif ; il laisse `0` (un repos
-- nul, réel : dropset, enchaînement) et le texte (`1'30`, `BISET`, que `ff_num`
-- rend NULL). Posé ICI et non sur la colonne parce qu'il appelle `ff_num`,
-- définie plus haut dans ce fichier que les tables ne le sont.
ALTER TABLE training_exercises ADD CONSTRAINT rest_sans_sentinelle
  CHECK (rest IS NULL OR ff_num(rest) IS NULL OR ff_num(rest) >= 0);
ALTER TABLE training_base_principles ADD CONSTRAINT rest_sans_sentinelle
  CHECK (rest IS NULL OR ff_num(rest) IS NULL OR ff_num(rest) >= 0);
ALTER TABLE training_base_accessories ADD CONSTRAINT rest_sans_sentinelle
  CHECK (rest IS NULL OR ff_num(rest) IS NULL OR ff_num(rest) >= 0);
ALTER TABLE block_objectives ADD CONSTRAINT block_objectives_mouvement_fkey
  FOREIGN KEY (structure, categorie, exercise) REFERENCES library_entries (structure, category, name) ON UPDATE CASCADE;

-- ⚠️ L'INDEX N'EST PAS UN CONFORT. `ON UPDATE CASCADE` doit retrouver les lignes
--    à réécrire ; Postgres n'indexe PAS le côté enfant tout seul, et un
--    renommage balaierait 14 922 lignes.
CREATE INDEX training_exercises_nom_idx        ON training_exercises (categorie, name);
CREATE INDEX training_sets_nom_idx             ON training_sets (categorie, exercise);
CREATE INDEX training_base_principles_nom_idx  ON training_base_principles (categorie, name);
CREATE INDEX training_base_accessories_nom_idx ON training_base_accessories (categorie, name);
CREATE INDEX athlete_goals_nom_idx             ON athlete_goals (categorie, exercise);
CREATE INDEX athlete_prs_nom_idx               ON athlete_prs (categorie, movement);
CREATE INDEX block_objectives_nom_idx          ON block_objectives (categorie, exercise);

-- --------------------------------------------------------------------------- #
-- LA STRUCTURE D'UNE LIGNE EST CELLE DE SON ATHLÈTE (19/09, une bibliothèque par
-- structure). Posée par la base, à l'insertion et quand la ligne change de
-- parent — il n'y a pas de chemin d'écriture qui l'oublie. Premier trigger du
-- projet : `verifier_schema` compare fonctions et triggers pour cette raison.
-- Un athlète qui CHANGE de structure n'est pas repris (décision du 19/09) :
-- l'invariant `lignes_dans_la_structure_de_l_athlete` le signalerait.
-- --------------------------------------------------------------------------- #
CREATE FUNCTION ff_pose_la_structure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF TG_TABLE_NAME = 'training_exercises' THEN
    SELECT a.structure INTO s
      FROM training_sessions se JOIN training_weeks w ON w.id = se.week_id
      JOIN training_blocks b ON b.id = w.block_id JOIN training_macros m ON m.id = b.macro_id
      JOIN programs p ON p.id = m.program_id JOIN athletes a ON a.id = p.athlete_id
     WHERE se.id = NEW.session_id;
  ELSIF TG_TABLE_NAME IN ('training_base_principles', 'training_base_accessories', 'block_objectives') THEN
    SELECT a.structure INTO s
      FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id
      JOIN programs p ON p.id = m.program_id JOIN athletes a ON a.id = p.athlete_id
     WHERE b.id = NEW.block_id;
  ELSIF TG_TABLE_NAME IN ('athlete_goals', 'athlete_prs', 'objectifs_techniques') THEN
    SELECT a.structure INTO s FROM athletes a WHERE a.id = NEW.athlete_id;
  ELSIF TG_TABLE_NAME = 'training_sets' THEN
    SELECT a.structure INTO s FROM athletes a WHERE a.legacy_id = NEW.athlete_id;
  END IF;
  -- Un parent introuvable garde la valeur reçue : la clé étrangère du parent
  -- refusera la ligne elle-même, avec un message qui dit la vraie cause.
  NEW.structure := coalesce(s, NEW.structure);
  RETURN NEW;
END $$;

CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF session_id ON training_exercises
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF block_id ON training_base_principles
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF block_id ON training_base_accessories
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF block_id ON block_objectives
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF athlete_id ON athlete_goals
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF athlete_id ON athlete_prs
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF athlete_id ON objectifs_techniques
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();
CREATE TRIGGER structure_de_l_athlete BEFORE INSERT OR UPDATE OF athlete_id ON training_sets
  FOR EACH ROW EXECUTE FUNCTION ff_pose_la_structure();