-- LOT 2 — LES ORTHOGRAPHES (FRE-11) : 4 noms, 304 lignes.
--
-- Deuxième des cinq lots. Ici on FUSIONNE, mais sans arbitrage : ce sont trois
-- mouvements écrits chacun de deux façons, et personne ne conteste qu'il
-- s'agisse du même geste.
--
--   HIP THRUST (14)             → HIPTHRUST (120)      avec et sans espace
--   PULL OVER (12)              → PULLOVER (188)       idem
--   ELEVATIONS FRONTALES (95)   → FRONT RAISE          pluriel et singulier
--   ELEVATION FRONTALE (15)     → FRONT RAISE          d'un même mouvement
--
-- ⚠️ CE LOT EST LE PREMIER À MÉLANGER DES HISTORIQUES, et c'est ce qui le
--    distingue du lot 1. Une fois les 14 séances de « HIP THRUST » versées dans
--    « HIPTHRUST », plus rien ne dit lesquelles venaient d'où. C'est voulu — un
--    seul mouvement doit avoir une seule courbe — mais ce n'est pas réversible
--    par un simple renommage inverse.
--
-- ⚠️ LE SENS DE LA FUSION SUIT L'USAGE, PAS L'ORTHOGRAPHE « CORRECTE » : c'est
--    la forme en UN SEUL MOT qui l'emporte des deux côtés (120 contre 14, 188
--    contre 12), sur décision de William le 04/09 — « comme pour PULLOVER, je
--    préfère conserver HIPTHRUST en un seul mot ». Fusionner vers la forme
--    minoritaire aurait réécrit dix fois plus de lignes pour le même résultat.
--
-- ⚠️ IL N'Y A AUCUNE CLÉ ÉTRANGÈRE SUR LE NOM D'EXERCICE (cf. lot 1) : chaque
--    colonne est pilotée explicitement, trames de bloc comprises — elles
--    portent 33 de ces noms.
--
-- ⚠️ `FRONT RAISE` EST UNE CIBLE LIBRE VISÉE PAR DEUX SOURCES. L'unicité
--    `(category, name)` interdit de renommer les deux entrées : on renomme la
--    plus utilisée et on supprime l'autre, ses lignes ayant déjà rejoint la
--    cible. L'ordre compte, d'où le bloc 3 en dernier.
--
-- Rejouable : chaque UPDATE est borné par un nom source qui n'existe plus après
-- coup. Un second passage ne touche rien.
--
-- Après application, l'invariant de la série doit tenir :
--    SELECT count(*) FROM training_exercises te
--      LEFT JOIN library_entries le
--             ON le.category = 'exercices' AND le.name = te.name
--     WHERE le.id IS NULL AND coalesce(btrim(te.name), '') <> '';   -- → 0

BEGIN;

CREATE TEMP TABLE carte (source text PRIMARY KEY, cible text NOT NULL) ON COMMIT DROP;

INSERT INTO carte (source, cible) VALUES
  ('HIP THRUST',           'HIPTHRUST'),
  ('PULL OVER',            'PULLOVER'),
  ('ELEVATIONS FRONTALES', 'FRONT RAISE'),
  ('ELEVATION FRONTALE',   'FRONT RAISE');

-- ⚠️ GARDE-FOU INVERSE DE CELUI DU LOT 1. Là-bas on refusait qu'une cible soit
--    déjà prise ; ici la fusion est le but, mais une cible doit exister SOIT en
--    bibliothèque, SOIT parmi les cibles neuves visées par ce lot. Une cible
--    qui n'est ni l'un ni l'autre serait une faute de frappe, et le lot
--    créerait un exercice fantôme sans que rien ne le signale.
DO $$
DECLARE fantome text;
BEGIN
  SELECT string_agg(DISTINCT c.cible, ', ') INTO fantome
    FROM carte c
   WHERE NOT EXISTS (SELECT 1 FROM library_entries le
                      WHERE le.category = 'exercices' AND le.name = c.cible)
     AND NOT EXISTS (SELECT 1 FROM carte c2 WHERE c2.cible = c.cible AND c2.source <> c.source);
  IF fantome IS NOT NULL THEN
    RAISE EXCEPTION 'Cible(s) inconnues et visées une seule fois : % — faute de frappe ?', fantome;
  END IF;
END $$;


-- 1. Les données. Aucune colonne n'est facultative.
UPDATE training_exercises        t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE training_sets             t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;
UPDATE training_base_principles  t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE training_base_accessories t SET name     = c.cible FROM carte c WHERE t.name     = c.source;
UPDATE athlete_goals             t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;
UPDATE athlete_prs               t SET movement = c.cible FROM carte c WHERE t.movement = c.source;
UPDATE block_objectives          t SET exercise = c.cible FROM carte c WHERE t.exercise = c.source;


-- 2. Ce qui est absorbé par une entrée DÉJÀ présente disparaît.
DELETE FROM library_entries le
 USING carte c
 WHERE le.category = 'exercices'
   AND le.name = c.source
   AND EXISTS (SELECT 1 FROM library_entries d
                WHERE d.category = 'exercices' AND d.name = c.cible);


-- 3. Les deux sources qui visent `FRONT RAISE`, cible libre : la seconde
--    disparaît, la première prend le nom.
--
-- ⚠️ L'ORDRE EST DÉTERMINISTE (`c2.source < c.source`) et non « la plus
--    utilisée » : le résultat est le même — une entrée renommée, une supprimée
--    — et une règle qui dépendrait des compteurs changerait de comportement
--    entre l'essai à blanc et l'application réelle, les coachs saisissant
--    entre-temps.
DELETE FROM library_entries le
 USING carte c
 WHERE le.category = 'exercices' AND le.name = c.source
   AND EXISTS (SELECT 1 FROM carte c2
                WHERE c2.cible = c.cible AND c2.source < c.source);

UPDATE library_entries le SET name = c.cible
  FROM carte c
 WHERE le.category = 'exercices' AND le.name = c.source;

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) aucune séance orpheline :
--    SELECT te.name, count(*) FROM training_exercises te
--      LEFT JOIN library_entries le
--             ON le.category = 'exercices' AND le.name = te.name
--     WHERE le.id IS NULL AND coalesce(btrim(te.name), '') <> ''
--     GROUP BY te.name;                                        -- → vide
--
-- b) les quatre sources ont disparu, les trois cibles existent une fois :
--    SELECT name, count(*) FROM library_entries
--     WHERE category = 'exercices'
--       AND name IN ('HIP THRUST','PULL OVER','ELEVATIONS FRONTALES','ELEVATION FRONTALE',
--                    'HIPTHRUST','PULLOVER','FRONT RAISE')
--     GROUP BY name;        -- → HIPTHRUST 1, PULLOVER 1, FRONT RAISE 1, rien d'autre
--
-- c) les totaux fusionnés :
--    SELECT name, count(*) FROM training_exercises
--     WHERE name IN ('HIPTHRUST','PULLOVER','FRONT RAISE') GROUP BY name;
--    → attendu : HIPTHRUST 134, PULLOVER 200, FRONT RAISE 110
--      (aux séances saisies depuis la mesure du 04/09 près)
--
-- d) le suivi n'a pas perdu de tonnage :
--    SELECT sum(tonnage_kg) FROM training_sets;                 -- inchangé
--
-- e) la bibliothèque perd exactement 3 entrées, pas 4 :
--    SELECT count(*) FROM library_entries WHERE category = 'exercices';  -- 110 → 107
--
--    ⚠️ QUATRE SOURCES, TROIS SUPPRESSIONS. `HIP THRUST` et `PULL OVER` sont
--       absorbées, `ELEVATION FRONTALE` aussi — mais `ELEVATIONS FRONTALES` est
--       RENOMMÉE en `FRONT RAISE` : elle survit sous un autre nom. Compter une
--       disparition par source est le piège de ce lot.
