-- ===========================================================================
-- FRE-103 — LE SCORE DE MÉCANOTRANSDUCTION PASSE AU BACK
--
-- `somme des chiffres du tempo × répétitions de la série`, demandé par Thomas
-- (kiné). Livré d'abord côté front (FRE-96, `eitri/src/lib/mechano.ts`) ; la
-- définition déménage ici pour qu'il n'en existe qu'UNE — la même fonction sert
-- la lecture de l'arbre et la projection analytique.
--
-- 💡 CE QUE LE NOMBRE EST, et c'est le meilleur garde-fou pour le relire : le
-- tempo décrit des phases en secondes, donc le score est le TEMPS SOUS TENSION
-- d'une série, en secondes. Un résultat qui ne se lit pas comme une durée
-- plausible est un bug, pas une subtilité de la métrique.
--
-- À appliquer à la main sur Neon (console SQL), comme les précédentes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. LA DÉFINITION, aux côtés des autres `ff_*` (migration du 2026-08-17).
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION ff_tempo_somme(v text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- Somme des CHIFFRES d'un tempo, NULL si ce n'en est pas un.
    --
    -- ⚠️ LA CONDITION D'ENTRÉE EST ÉTROITE EXPRÈS, et le parc dit pourquoi : sur
    -- 3 032 lignes portant un tempo, 1 462 sont TEXTUELLES — « 1CT PAUSE » (693),
    -- « DS » (305), « 2CT PAUSE » (259), « 3CT CONCENTRIQUE » (114). FRE-17 les a
    -- délibérément conservées : « elles décrivent une intention, pas un rythme
    -- en quatre temps ». Elles ne doivent produire AUCUN score — surtout pas un
    -- score partiel grappillé sur les chiffres qui traînent dedans
    -- (« 1CT PAUSE » vaudrait 1, « E1:30mom » vaudrait 130). Des nombres
    -- plausibles et faux : les pires de tous.
    --
    -- ⚠️ ET LA LARGEUR EST 3 OU 4, PAS 4. « ABCD » est la forme MINORITAIRE :
    -- 1 055 tempos chiffrés tiennent en trois caractères contre 515 en quatre,
    -- et « 300 » à lui seul en compte 598. Coder « A+B+C+D » aurait écarté les
    -- deux tiers du parc.
    --
    -- ⚠️ LE `X` EST RECONNU MAIS NE S'ADDITIONNE PAS, et les deux moitiés
    -- comptent. Le reconnaître : « 31X1 » est canonique depuis FRE-17 et 309
    -- lignes en portent un — l'écarter ferait disparaître leur score. Ne pas le
    -- compter : « explosif » n'ajoute pas de temps sous tension.
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
    -- ⚠️ `reps_unit = 'sec'` NE SE SCORE PAS. Les « répétitions » sont alors des
    -- secondes de gainage : multiplier une durée par une somme de durées ne veut
    -- rien dire, et le résultat aurait pourtant l'air d'un score. Décidé avec
    -- William le 25/08 — il verra le cas avec Thomas.
    --
    -- ⚠️ ET `reps` EST DÉJÀ LA BORNE BASSE d'une fourchette (`ff_reps_low`) : sur
    -- « 8-10 » on ne crédite pas la borne haute, qui n'a pas été confirmée.
    -- C'est la règle des records, appliquée au même endroit qu'eux.
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

-- ---------------------------------------------------------------------------
-- 2. LA COLONNE, sur la PROJECTION — jamais sur la source.
--
-- ⚠️ CE CHOIX EST LE CŒUR DE LA MIGRATION. `training_sets` est reconstruite
-- INTÉGRALEMENT à chaque exécution : « la source de vérité reste l'arbre
-- relationnel ; rien n'est perdu si la table est vidée ». Y stocker un calcul ne
-- crée donc aucune seconde vérité — la valeur est refabriquée au rebuild.
--
-- Écrire ce score sur `training_exercises` serait tout autre chose : un tempo
-- corrigé après coup y laisserait un score périmé, sans que rien ne le signale.
-- C'est exactement le défaut qu'on évite ici, et c'est pourquoi la colonne est
-- ICI et pas là-bas.
--
-- Le précédent est `tonnage_kg`, métrique dérivée elle aussi, déjà en colonne.
-- ---------------------------------------------------------------------------

ALTER TABLE training_sets ADD COLUMN IF NOT EXISTS mechano numeric;

COMMENT ON COLUMN training_sets.mechano IS
    'Mécanotransduction : temps sous tension d''une série, en secondes '
    '(somme des chiffres du tempo × reps). NULL si le tempo n''est pas un '
    'rythme chiffré, ou si les reps sont des secondes. ⚠️ Ne concerne que les '
    'lignes kind = ''rehab'' : un agrégat doit INVERSER le filtre habituel des '
    'stats, qui exclut rehab.';

COMMIT;

-- ---------------------------------------------------------------------------
-- 3. Vérification, une fois le job `training-analytics-refresh` rejoué.
--
-- ⚠️ ZÉRO EST LE RÉSULTAT ATTENDU AUJOURD'HUI, et ce n'est pas un échec : la
-- production ne porte que 4 lignes `rehab`, aucune avec un tempo (relevé du
-- 25/08, FRE-96). La colonne se remplira quand Thomas saisira ses exercices
-- avec la nature « Kiné » et un tempo.
--
--   SELECT count(*) FILTER (WHERE kind = 'rehab'),
--          count(mechano) FILTER (WHERE kind = 'rehab')
--   FROM training_sets;
--
-- La fonction, elle, se vérifie sans attendre personne :
--
--   SELECT ff_mechano('4040', 6, 'count'),      -- 48
--          ff_mechano('300', 8, 'count'),       -- 24
--          ff_mechano('31X1', 6, 'count'),      -- 30  (X vaut 0)
--          ff_mechano('XXX', 6, 'count'),       -- 0   ⚠️ ZÉRO, PAS NULL
--          ff_mechano('1CT PAUSE', 6, 'count'), -- NULL
--          ff_mechano('4040', 30, 'sec');       -- NULL
-- ---------------------------------------------------------------------------
