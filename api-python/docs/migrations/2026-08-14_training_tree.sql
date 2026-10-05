-- Migration : l'ARBRE D'ENTRAÎNEMENT quitte Firestore (FRE-12).
--
-- Dernier domaine documentaire. macro → bloc → semaine → séance → exercice, plus
-- la BASE d'un bloc. Conception, mesures et décisions dans le ticket FRE-12.
--
-- ┌─ CE QUI CHANGE VRAIMENT ──────────────────────────────────────────────────┐
-- │ Un exercice cesse d'être une POSITION pour devenir une IDENTITÉ.          │
-- │ Aujourd'hui c'est un index dans un tableau JSON : réordonner une séance   │
-- │ décale l'historique, et le front s'en protège par des clés reconstruites  │
-- │ à la volée. Surtout, l'écriture REMPLACE le tableau `sessions` entier —   │
-- │ d'où deux défauts sans rapport apparent : une valeur invalide fait tomber │
-- │ la SEMAINE entière (incident du 11/08 : 3 semaines, 73 exercices, un      │
-- │ athlète bloqué sur sa séance du jour), et « ce kiné ne peut éditer que    │
-- │ les lignes rehab » est inapplicable (FRE-13). Une ligne = une row les     │
-- │ règle tous les deux.                                                      │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- CE QUI RESTE DU TEXTE, ET POURQUOI CE N'EST PAS UN RENONCEMENT
--   `sets`, `reps`, `weight`, `rest`, les RPE : text. La convention du schéma le
--   dit déjà — « text là où le DOMAINE est non numérique (fourchettes "6/8",
--   sentinelles "Sub5") ». Un coach écrit « 8-10 », « PDC », « 3+2 » ; typer ces
--   colonnes en numeric REFUSERAIT des saisies légitimes. Le parsing vit dans la
--   projection `training_sets`, qui est faite pour ça.
--   On resserre en revanche ce qui a un VOCABULAIRE CLOS : `kind`, `reps_unit`,
--   `increment_unit`, `weight_locked` (bool), `hidden` (bool), les dates.
--
-- CE QUI N'EST PAS PORTÉ (mesuré sur la donnée réelle le 2026-08-14)
--   `linkedPrincipal`      0 / 8 670 lignes  — jamais écrit, une seule fois
--   `incrementRef`         2 / 8 527         — l'unité `%` n'est quasi pas employée
--   `tracked`/`trackedSource`                — hors contrat, vestige d'un vieux front
--   `blockObjectives`                        — déjà en Postgres depuis le 03/08
--   `macro.dashboard`                        — sauf trainingFrequency et coachNotes
--   `week.currentOneRM`    26 / 415          — ce N'EST PAS un historique : onze
--     semaines de janvier à mars portent les MÊMES chiffres, deux sont à zéro, et
--     une contredit le profil actuel. C'est une copie de la Table RM figée au
--     moment où le document a été écrit. Le transporter inviterait quelqu'un, dans
--     six mois, à le prendre pour une série temporelle et à calculer dessus.
--     L'historique fiable des 1RM vit dans `athlete_prs` et le Tracking.
--   `week.athlete`                           — nom/prénom jetés (duplication de
--     `athletes`), poids et TAILLE conservés : c'est la mesure DE CETTE
--     SEMAINE-LÀ, et elle fonde la force relative.
--
-- ⚠️ UN ID FIRESTORE N'EST PAS UNIQUE ENTRE PROGRAMMES. Un programme a été
--   dupliqué en recopiant ses documents AVEC leurs ids (macro parent compris) :
--   le même `block_id` vit sous deux programmes. C'est le piège qui avait cassé
--   `block_objectives` (cf. son commentaire). Ici l'unicité porte donc sur
--   (parent, legacy_id) — jamais sur legacy_id seul.
--
-- ⚠️ ORDRE : cette migration AVANT tout déploiement qui la référence, et l'ETL
--   de chargement APRÈS. Elle est purement additive (aucune table existante
--   touchée), donc sans effet sur la production tant que rien ne l'écrit.

BEGIN;

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
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (program_id, legacy_id)
);
CREATE INDEX ON training_macros (program_id);

CREATE TABLE training_blocks (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    macro_id  uuid NOT NULL REFERENCES training_macros(id) ON DELETE CASCADE,
    legacy_id text NOT NULL,
    number    integer NOT NULL,
    name      text,                    -- 13 blocs sur 124 seulement → naviguer
                                       -- par nom n'est PAS fiable (vécu le 13/08)
    start_date date,
    end_date   date,
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
    UNIQUE (macro_id, legacy_id)
);
CREATE INDEX ON training_blocks (macro_id);

CREATE TABLE training_weeks (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id  uuid NOT NULL REFERENCES training_blocks(id) ON DELETE CASCADE,
    legacy_id text NOT NULL,
    number    integer NOT NULL,
    name      text,
    hidden    boolean NOT NULL DEFAULT false,
    start_date date,
    end_date   date,
    -- Instantané de l'athlète À CETTE SEMAINE : la seule partie qui porte de
    -- l'information (le poids fonde la force relative). Les noms sont jetés.
    athlete_weight_kg numeric,
    athlete_height_cm numeric,
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

    name    text NOT NULL,
    -- Variantes CUMULÉES (FRE-33) : « DS » + « PAUSE » plutôt qu'une entrée
    -- `DS PAUSE` de plus au référentiel. L'ETL absorbe la conversion depuis la
    -- chaîne — il n'y a donc PAS à migrer la forme dans Firestore d'abord.
    variant text[],
    tier    integer CHECK (tier BETWEEN 1 AND 3),
    format  text,             -- '' | EMOM | AMRAP | CLUSTER (3,6 % des lignes)
    cluster_mode text,
    cluster_rest text,
    tempo   text,

    -- ---- PRESCRIT (texte : fourchettes « 8-10 », « PDC », « 3+2 ») ---------
    sets   text,
    reps   text,
    reps_unit text CHECK (reps_unit IN ('count', 'sec')),
    weight text,
    -- Booléen, lui : le vocabulaire est clos (la chaîne 'true' d'aujourd'hui).
    weight_locked boolean NOT NULL DEFAULT false,
    assistance text,
    aimed_rpe  text,
    rest       text,

    -- ---- RÉALISÉ (saisi par l'athlète) ------------------------------------
    reps_done   text,
    weight_done text,
    rest_actual text,
    felt_rpe    text,          -- « Sub5 » et « FAIL » sont des valeurs légitimes
    -- RPE par SÉRIE — la seule chose qui varie réellement d'une série à l'autre
    -- (40 % des lignes en portent). Le reste (sets/reps/charge) décrit la ligne :
    -- exploser en lignes-séries fabriquerait de la donnée qui n'existe pas.
    felt_rpe_by_set text[],
    athlete_feedback text,

    coach_note text,
    link       text,
    -- Liaison bi-set (FRE-31) : des lignes CONSÉCUTIVES partageant cette clé
    -- forment un groupe. Reste du texte plutôt qu'une FK vers une table de
    -- groupes : 1,9 % des lignes en portent une, et un groupe n'a aujourd'hui
    -- aucun attribut propre. À revoir si le DROPSET (FRE-36) lui en donne.
    group_id text,

    increment      text,
    increment_unit text CHECK (increment_unit IN ('kg', '%', 'reps', 'rpe', 'sets')),

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
    name     text NOT NULL,
    variant  text[],
    tier     integer NOT NULL CHECK (tier BETWEEN 1 AND 3),
    format   text,
    cluster_mode text,
    cluster_rest text,
    tempo    text,
    sets     text,
    reps     text,
    reps_unit text CHECK (reps_unit IN ('count', 'sec')),
    weight   text,
    weight_locked boolean NOT NULL DEFAULT false,
    assistance text,
    aimed_rpe  text,
    rest       text,
    coach_note text,
    increment      text,
    increment_unit text CHECK (increment_unit IN ('kg', '%', 'reps', 'rpe', 'sets')),
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
    name     text NOT NULL,
    variant  text[],
    format   text,
    cluster_mode text,
    cluster_rest text,
    tempo    text,
    sets     text,
    reps     text,
    reps_unit text CHECK (reps_unit IN ('count', 'sec')),
    weight   text,
    weight_locked boolean NOT NULL DEFAULT false,
    assistance text,
    aimed_rpe  text,
    rest       text,
    coach_note text,
    increment      text,
    increment_unit text CHECK (increment_unit IN ('kg', '%', 'reps', 'rpe', 'sets')),
    -- Bi-set défini DANS la base (FRE-31). ⚠️ RÈGLE MÉTIER : ce champ n'existe
    -- que sur les accessoires. Un bi-set ne concerne que du renforcement —
    -- vérifié sur les 84 groupes réels, aucun ne porte de ligne à tier.
    group_id text,
    UNIQUE (block_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ON training_base_accessories (block_id);

COMMIT;
