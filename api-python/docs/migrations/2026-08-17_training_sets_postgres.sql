-- `training_sets` se reconstruit depuis POSTGRES, plus depuis Firestore (FRE-48).
--
-- La bascule de l'arbre d'entraînement (FRE-12, 16/08) a laissé la projection
-- analytique branchée sur Firestore, désormais figé : le Tracking est arrêté au
-- 15/08 et DIVERGE de la réalité (semaines supprimées, numéros recompactés
-- depuis). Aucune donnée n'est en jeu — cette table est DÉRIVÉE et se refait
-- intégralement à chaque passage.
--
-- CE QUI CHANGE VRAIMENT : la source et le nid sont maintenant dans LA MÊME
-- BASE. L'ETL cesse donc d'être un ETL — plus de parcours d'arbre en Python,
-- plus de transport entre deux magasins : un `INSERT … SELECT`. Le parsing
-- descend en SQL, d'où les fonctions ci-dessous.
--
-- ⚠️ ÉQUIVALENCE DES PARSEURS : PROUVÉE, PAS SUPPOSÉE. `training_sets.raw`
-- contenait l'entrée Firestore exacte de chaque ligne, et les colonnes à côté la
-- sortie du Python. Les fonctions ci-dessous ont été rejouées sur cette entrée
-- figée — 21 colonnes × 9 902 lignes, ZÉRO divergence. C'est la seule preuve qui
-- vaille, et `raw` disparaissant, elle n'est plus rejouable : ne pas la refaire à
-- l'aveugle plus tard en croyant mieux faire.
--
-- DEUX CORRECTIFS DE SCHÉMA AU PASSAGE
--   * `variant` passe en `text[]` (FRE-50). La source est un `text[]` depuis
--     FRE-33, et l'ancien filtre `_text()` rejetait TOUTE liste — y compris à un
--     seul élément. Repointer la lecture sans ce changement aurait fait
--     disparaître les 4 879 variantes, en silence.
--   * `raw` (jsonb) est remplacé par `exercise_id`. Personne ne lisait `raw`
--     (vérifié sur tout le dépôt) et une FK vaut mieux qu'une copie figée : elle
--     pointe la ligne RÉELLE, et la cascade nettoie la projection quand un
--     athlète est supprimé — là où l'ancienne table attendait le prochain
--     rebuild (cf. le commentaire de `delete_athlete.py`).

BEGIN;

-- ---------------------------------------------------------------------------
-- Les parseurs, un pour un avec ceux que portait `etl_training_sets.py`.
-- Tout est du texte à la source : un coach écrit « 8-10 », « PDC », « Sub5 ».
--
-- IMMUTABLE : le planificateur peut les évaluer d'avance. PARALLEL SAFE : ne
-- bloque pas un scan parallèle. Préfixe `ff_` pour ne pas squatter un nom.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ff_num(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- Premier nombre d'une saisie manuelle, virgule ou point.
    -- ⚠️ `(?:…)` NON capturant : avec une parenthèse capturante, substring()
    -- renvoie la CAPTURE et non le motif — donc la partie décimale seule.
    SELECT substring(replace(v, ',', '.') from '-?[0-9]+(?:\.[0-9]+)?')::numeric
$$;

CREATE OR REPLACE FUNCTION ff_reps_low(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- « 8-10 » → 8. Pas une fourchette → premier nombre trouvé.
    SELECT coalesce(
        (regexp_match(replace(v, ',', '.'),
            '^\s*([0-9]+(?:\.[0-9]+)?)\s*[-/]\s*([0-9]+(?:\.[0-9]+)?)\s*$'))[1]::numeric,
        ff_num(v))
$$;

CREATE OR REPLACE FUNCTION ff_reps_high(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- « 8-10 » → 10. NULL si ce n'est pas une fourchette.
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
    -- « Sub5 » et « FAIL » → NULL ici, le texte reste dans `felt_rpe_raw`.
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

-- ---------------------------------------------------------------------------
-- La table. DROP et non ALTER : elle est DÉRIVÉE, la recréer ne perd rien et
-- évite de traîner les colonnes de l'ancienne forme.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS training_sets;

CREATE TABLE training_sets (
    id bigserial PRIMARY KEY,

    athlete_id text NOT NULL,
    program_id text NOT NULL,
    macro_number integer,
    block_number integer,
    week_number  integer,
    session_index integer NOT NULL,
    session_name  text,
    -- Date de séance si l'athlète l'a lancée, sinon début de semaine.
    -- `date_exact` dit laquelle des deux, pour ne pas confondre les deux sens.
    session_date date,
    date_exact   boolean NOT NULL DEFAULT false,

    exercise_index integer NOT NULL,
    exercise text NOT NULL,
    -- La ligne SOURCE. Remplace l'ancien `raw` (jsonb) : une identité plutôt
    -- qu'une copie. CASCADE — la projection se nettoie d'elle-même.
    exercise_id uuid REFERENCES training_exercises(id) ON DELETE CASCADE,

    variant text[],            -- FRE-50 : liste, comme la source depuis FRE-33
    assistance text,
    tempo  text,
    format text,
    tier   integer,
    superset_group text,
    kind   text,               -- NULL = entraînement (FRE-10)

    sets integer,
    reps numeric,
    reps_high numeric,
    reps_done numeric,
    reps_unit text,

    bodyweight boolean NOT NULL DEFAULT false,
    weight_kg      numeric,
    weight_done_kg numeric,

    aimed_rpe numeric,
    felt_rpe  numeric,
    felt_rpe_raw text,         -- « Sub5 », « FAIL » : le texte, tel quel
    rpe_by_set numeric[],

    rest_s numeric,
    tonnage_kg numeric,
    athlete_feedback text,
    coach_note text
);

-- Mêmes accès qu'avant : par athlète et date (les graphes), par mouvement (le
-- sélecteur), et par position dans l'arbre.
CREATE INDEX ON training_sets (athlete_id, session_date);
CREATE INDEX ON training_sets (exercise);
CREATE INDEX ON training_sets (program_id, macro_number, block_number, week_number);

COMMIT;
