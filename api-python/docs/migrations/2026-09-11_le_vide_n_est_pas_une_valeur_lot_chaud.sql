-- LE VIDE N'EST PAS UNE VALEUR — lot CHAUD, et les deux dérivations (FRE-137).
--
-- Ce lot solde la dette : 14 794 cases, tout ce qui reste après FROID et TIÈDE.
-- Ce sont les colonnes que le TONNAGE, les RECORDS et l'ETL traversent.
--
-- ⚠️ ET IL A FALLU CORRIGER DEUX FONCTIONS AVANT DE POSER LE MOINDRE CHECK.
--    `felt_rpe`, `reps_done` et `weight_done` ne sont pas écrites directement :
--    `training_lines.derivations()` les remplit avec `ff_moyenne_rpe` et
--    `ff_moyenne_serie`, qui rendent `''` quand rien n'est noté. Un CHECK posé
--    sans les corriger aurait fait un **500 sur le geste « j'efface mon détail
--    par série »** — un geste réel, quotidien, et le défaut aurait été livré par
--    la garde censée le réparer.
--
--    Vérifié avant d'écrire : `ff_moyenne_rpe(NULL)`, `ff_moyenne_rpe('{}')` et
--    `ff_moyenne_rpe(ARRAY['',''])` rendent tous `''`.
--
-- ⚠️ ÉQUIVALENCE `''` / `NULL` ÉPROUVÉE SUR LA VRAIE BASE avant de migrer, parce
--    que ces colonnes portent des calculs : `ff_num`, `ff_reps_low`,
--    `ff_reps_high`, `ff_bodyweight`, `ff_charge`, `ff_rpe` et
--    `ff_series_tenues` rendent la MÊME chose sur `''` et sur `NULL`. Côté
--    Python, `records.py` compare en `coalesce(btrim(x), '') <> ''` et le code
--    des groupes lit `(x or "").strip()` : les deux formes y sont déjà
--    équivalentes. Le tonnage et les records ne bougent donc pas d'un kilo.
--
-- AVANT (relevé du 11/09) :
--
--                        exercises   principles   accessories
--   group_id                 5 347            —           854
--   weight                   3 066           83           885
--   aimed_rpe                1 776          555            53
--   reps_done                  526            —             —
--   rest_actual                518            —             —
--   weight_done                455            —             —
--   rest                       400           81            13
--   felt_rpe                   130            —             —
--   reps                        34            3             4
--   sets                         8            1             2
--
--   soit 14 794 cases — la dette entière.
--
-- ⚠️ `name` N'EST PAS DANS CE LOT : elle est déjà à zéro partout, et sa clé
--    étrangère vers la bibliothèque refuse `''` (aucune entrée ne s'appelle
--    ainsi). La porte y est fermée par la FK, pas par un CHECK.

BEGIN;

-- --------------------------------------------------------------------------- #
-- 1. LES DEUX DÉRIVATIONS CESSENT DE FABRIQUER DU VIDE
--
-- Le seul changement est le `coalesce(…, '')` final, retiré : la sous-requête
-- rend déjà `NULL` quand rien n'est noté, ce qui est la réponse juste. Le
-- comportement métier ne change pas — « la colonne se vide » — seule la façon
-- de dire « vide » change, et `_sortie` la retraduit en `''` pour le front.
-- --------------------------------------------------------------------------- #

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
    -- FRE-137 : une absence s'écrit d'une seule façon.
    SELECT (SELECT trim(trailing '.' FROM
                        trim(trailing '0' FROM to_char(round(avg(n), 1), 'FM999999990.0')))
              FROM unnest(coalesce(v, '{}')) AS x,
                   LATERAL (SELECT ff_num(x)) AS p(n)
             WHERE btrim(x) <> '' AND n IS NOT NULL)
$$;

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

-- --------------------------------------------------------------------------- #
-- 2. LA FLAQUE
-- --------------------------------------------------------------------------- #

UPDATE training_exercises SET sets        = NULL WHERE btrim(sets) = '';
UPDATE training_exercises SET reps        = NULL WHERE btrim(reps) = '';
UPDATE training_exercises SET weight      = NULL WHERE btrim(weight) = '';
UPDATE training_exercises SET aimed_rpe   = NULL WHERE btrim(aimed_rpe) = '';
UPDATE training_exercises SET felt_rpe    = NULL WHERE btrim(felt_rpe) = '';
UPDATE training_exercises SET rest        = NULL WHERE btrim(rest) = '';
UPDATE training_exercises SET rest_actual = NULL WHERE btrim(rest_actual) = '';
UPDATE training_exercises SET reps_done   = NULL WHERE btrim(reps_done) = '';
UPDATE training_exercises SET weight_done = NULL WHERE btrim(weight_done) = '';
UPDATE training_exercises SET group_id    = NULL WHERE btrim(group_id) = '';

UPDATE training_base_principles SET sets      = NULL WHERE btrim(sets) = '';
UPDATE training_base_principles SET reps      = NULL WHERE btrim(reps) = '';
UPDATE training_base_principles SET weight    = NULL WHERE btrim(weight) = '';
UPDATE training_base_principles SET aimed_rpe = NULL WHERE btrim(aimed_rpe) = '';
UPDATE training_base_principles SET rest      = NULL WHERE btrim(rest) = '';

UPDATE training_base_accessories SET sets      = NULL WHERE btrim(sets) = '';
UPDATE training_base_accessories SET reps      = NULL WHERE btrim(reps) = '';
UPDATE training_base_accessories SET weight    = NULL WHERE btrim(weight) = '';
UPDATE training_base_accessories SET aimed_rpe = NULL WHERE btrim(aimed_rpe) = '';
UPDATE training_base_accessories SET rest      = NULL WHERE btrim(rest) = '';
UPDATE training_base_accessories SET group_id  = NULL WHERE btrim(group_id) = '';

-- --------------------------------------------------------------------------- #
-- 3. LA PORTE
-- --------------------------------------------------------------------------- #

ALTER TABLE training_exercises
    ADD CONSTRAINT sets_non_vide        CHECK (btrim(sets) <> ''),
    ADD CONSTRAINT reps_non_vide        CHECK (btrim(reps) <> ''),
    ADD CONSTRAINT weight_non_vide      CHECK (btrim(weight) <> ''),
    ADD CONSTRAINT aimed_rpe_non_vide   CHECK (btrim(aimed_rpe) <> ''),
    ADD CONSTRAINT felt_rpe_non_vide    CHECK (btrim(felt_rpe) <> ''),
    ADD CONSTRAINT rest_non_vide        CHECK (btrim(rest) <> ''),
    ADD CONSTRAINT rest_actual_non_vide CHECK (btrim(rest_actual) <> ''),
    ADD CONSTRAINT reps_done_non_vide   CHECK (btrim(reps_done) <> ''),
    ADD CONSTRAINT weight_done_non_vide CHECK (btrim(weight_done) <> ''),
    ADD CONSTRAINT group_id_non_vide    CHECK (btrim(group_id) <> '');

ALTER TABLE training_base_principles
    ADD CONSTRAINT sets_non_vide      CHECK (btrim(sets) <> ''),
    ADD CONSTRAINT reps_non_vide      CHECK (btrim(reps) <> ''),
    ADD CONSTRAINT weight_non_vide    CHECK (btrim(weight) <> ''),
    ADD CONSTRAINT aimed_rpe_non_vide CHECK (btrim(aimed_rpe) <> ''),
    ADD CONSTRAINT rest_non_vide      CHECK (btrim(rest) <> '');

ALTER TABLE training_base_accessories
    ADD CONSTRAINT sets_non_vide      CHECK (btrim(sets) <> ''),
    ADD CONSTRAINT reps_non_vide      CHECK (btrim(reps) <> ''),
    ADD CONSTRAINT weight_non_vide    CHECK (btrim(weight) <> ''),
    ADD CONSTRAINT aimed_rpe_non_vide CHECK (btrim(aimed_rpe) <> ''),
    ADD CONSTRAINT rest_non_vide      CHECK (btrim(rest) <> ''),
    ADD CONSTRAINT group_id_non_vide  CHECK (btrim(group_id) <> '');

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-11_le_vide_n_est_pas_une_valeur_lot_chaud.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION : `make invariants` doit tomber à ZÉRO, et `connu_viole` doit
-- alors DISPARAÎTRE — une tolérance dont la dette est payée sort en
-- `tolerance_perimee`, c'est-à-dire un échec.
--
-- ⚠️ ET LE HARNAIS RÉEL, PAS SEULEMENT LES INVARIANTS. Ce sont les colonnes que
--    le tonnage, les records et l'ETL traversent : `scripts/e2e-reel.sh`.
--
-- ⚠️ PUIS SURVEILLER DEUX GESTES EN PRODUCTION : effacer un détail par série
--    (il traverse `ff_moyenne_*`), et générer une semaine (elle traverse
--    `inserer_ligne` sur les trois tables).
