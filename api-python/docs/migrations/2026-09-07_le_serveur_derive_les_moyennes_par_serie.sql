-- LE SERVEUR DÉRIVE LES MOYENNES PAR SÉRIE (FRE-136).
--
-- `felt_rpe`, `reps_done` et `weight_done` sont, depuis la saisie par série, la
-- MOYENNE des séries — calculée par le NAVIGATEUR et envoyée dans le même PATCH.
-- La règle n'existe donc qu'en TypeScript, sur une colonne qui est une DÉRIVÉE.
-- C'est la règle du projet qui manque : « une règle dupliquée se règle en
-- déplaçant le CALCUL côté serveur ».
--
-- ⚠️ CE N'EST PAS THÉORIQUE, LA VALEUR FAUSSE EST DÉJÀ ÉCRITE. Mesuré le 07/09,
--    24 h après la revue : deux lignes portent un `reps_done` qui n'est AUCUNE
--    de leurs séries — `['8','7','7']` rendu `7.3`, `['41','42']` rendu `41.5`.
--    Aucune n'est encore un lift de compétition ; la suivante le sera, et
--    `records.py` posait un record que personne n'a fait (corrigé dans le même
--    lot : chaque série tenue y est désormais un candidat).
--
-- ⚠️ DEUX FONCTIONS ET NON UNE, et ce n'est pas une duplication. Le RPE a deux
--    règles qui n'appartiennent qu'à lui : `FAIL` est ABSORBANT (une série ratée
--    rate le format entier), et la moyenne s'arrondit au demi-point SUPÉRIEUR
--    parce que l'échelle ne connaît que les demis. Des répétitions et des kilos
--    n'ont ni l'un ni l'autre — les faire passer par la règle du RPE
--    transformerait « 10, 11, 12 » en « 11 » par un arrondi qui n'a pas lieu
--    d'être, et plafonnerait toute charge au-dessus de 10.
--
-- ⚠️ EN SQL ET NON EN PYTHON, parce qu'il y a DEUX appelants : le chemin
--    d'écriture (`training_lines.py`) et le rattrapage de la partie 3 ci-dessous.
--    Une fonction, deux appels — la famille `ff_*` existe pour ça.
--
-- ⚠️ ET LE SERVEUR IGNORE LE SCALAIRE ENVOYÉ, IL NE LE REFUSE PAS. Le 422 que la
--    première rédaction proposait aurait cassé la FILE HORS-LIGNE : les patchs
--    en attente vivent sur le disque de l'athlète (IndexedDB, FRE-118) et
--    survivent aux déploiements. Un patch écrit par l'ancien front porte
--    `{tableau, scalaire}` ; le refuser au rejeu perdrait une séance saisie hors
--    ligne. Ignorer ne perd rien : le serveur écrit la valeur JUSTE à la place
--    de la moins juste.

BEGIN;

-- --------------------------------------------------------------------------- #
-- 1. LA MOYENNE D'UN RÉALISÉ — répétitions et charge
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
    -- Rend `''` quand rien n'est noté — jamais `'0'`, qui se lirait « il a fait
    -- zéro » là où il faut lire « il n'a rien dit ».
    SELECT coalesce(
        (SELECT trim(trailing '.' FROM
                     trim(trailing '0' FROM to_char(round(avg(n), 1), 'FM999999990.0')))
           FROM unnest(coalesce(v, '{}')) AS x,
                LATERAL (SELECT ff_num(x)) AS p(n)
          WHERE btrim(x) <> '' AND n IS NOT NULL),
        '')
$$;


-- --------------------------------------------------------------------------- #
-- 2. LE RPE RESSENTI — ses deux règles à lui
-- --------------------------------------------------------------------------- #

CREATE OR REPLACE FUNCTION ff_moyenne_rpe(v text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- 1. un seul `FAIL` → `FAIL` (absorbant : le format est raté) ;
    -- 2. sinon moyenne (`Sub5` vaut 4) ; si < 5 → `Sub5` ; sinon arrondi au
    --    demi-point SUPÉRIEUR, l'échelle ne connaissant que les demis.
    -- Rend `''` si rien n'est noté. Une valeur unique est sa propre moyenne.
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM unnest(coalesce(v, '{}')) x
                      WHERE btrim(x) = 'FAIL')
        THEN 'FAIL'
        ELSE coalesce(
            (SELECT CASE WHEN avg(n) < 5 THEN 'Sub5'
                         ELSE trim(trailing '.' FROM
                              trim(trailing '0' FROM
                                   to_char(ceil(avg(n) * 2) / 2, 'FM999999990.0'))) END
               FROM unnest(coalesce(v, '{}')) AS x,
                    LATERAL (SELECT CASE WHEN btrim(x) = 'Sub5' THEN 4
                                         ELSE ff_num(x) END) AS p(n)
              WHERE btrim(x) <> '' AND n IS NOT NULL),
            '')
    END
$$;


-- --------------------------------------------------------------------------- #
-- 3. LES LIGNES DÉJÀ ÉCRITES PAR LE NAVIGATEUR
--
-- ⚠️ SANS CE RATTRAPAGE, `HACK SQUAT 7.3` RESTE FAUX JUSQU'À LA PROCHAINE SAISIE
--    sur cette ligne — c'est-à-dire peut-être jamais. Elles sont dix ; le geste
--    coûte trois ordres, et il n'y a pas de meilleur moment que celui où elles
--    sont dix.
--
-- Borné aux lignes qui portent un détail par série : ailleurs le scalaire n'est
-- pas une dérivée, c'est la saisie elle-même, et la recalculer l'effacerait.
-- --------------------------------------------------------------------------- #

UPDATE training_exercises
   SET reps_done = ff_moyenne_serie(reps_done_by_set)
 WHERE cardinality(coalesce(reps_done_by_set, '{}')) > 0
   AND reps_done IS DISTINCT FROM ff_moyenne_serie(reps_done_by_set);

UPDATE training_exercises
   SET weight_done = ff_moyenne_serie(weight_done_by_set)
 WHERE cardinality(coalesce(weight_done_by_set, '{}')) > 0
   AND weight_done IS DISTINCT FROM ff_moyenne_serie(weight_done_by_set);

UPDATE training_exercises
   SET felt_rpe = ff_moyenne_rpe(felt_rpe_by_set)
 WHERE cardinality(coalesce(felt_rpe_by_set, '{}')) > 0
   AND felt_rpe IS DISTINCT FROM ff_moyenne_rpe(felt_rpe_by_set);

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) les deux fonctions sur les formes du contrat front (mêmes exemples que
--    `par-serie.test.ts` et la doc du RPE) :
--
--    SELECT ff_moyenne_serie('{"10","11","12"}'),   -- → 11
--           ff_moyenne_serie('{"10","11"}'),        -- → 10.5
--           ff_moyenne_serie('{"10","11","11"}'),   -- → 10.7
--           ff_moyenne_serie('{"17,5","17,5"}'),    -- → 17.5
--           ff_moyenne_serie('{"10","","12"}'),     -- → 11
--           ff_moyenne_serie('{"PDC","20"}'),       -- → 20
--           ff_moyenne_serie('{}'),                 -- → ''
--           ff_moyenne_rpe('{"8","8","FAIL"}'),     -- → FAIL
--           ff_moyenne_rpe('{"7","8"}'),            -- → 7.5
--           ff_moyenne_rpe('{"4","4"}'),            -- → Sub5
--           ff_moyenne_rpe('{"Sub5","6"}'),         -- → Sub5
--           ff_moyenne_rpe('{"7","7","8"}');        -- → 7.5 (7,33 → demi SUP)
--
-- b) plus aucune dérivée ne diverge de ses séries :
--
--    SELECT count(*) FROM training_exercises
--     WHERE (cardinality(coalesce(reps_done_by_set, '{}')) > 0
--            AND reps_done IS DISTINCT FROM ff_moyenne_serie(reps_done_by_set))
--        OR (cardinality(coalesce(weight_done_by_set, '{}')) > 0
--            AND weight_done IS DISTINCT FROM ff_moyenne_serie(weight_done_by_set))
--        OR (cardinality(coalesce(felt_rpe_by_set, '{}')) > 0
--            AND felt_rpe IS DISTINCT FROM ff_moyenne_rpe(felt_rpe_by_set));
--                                                              -- → 0
