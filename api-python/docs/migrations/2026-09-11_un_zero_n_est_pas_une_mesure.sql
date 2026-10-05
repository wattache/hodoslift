-- UN ZÉRO N'EST PAS UNE MESURE — FRE-137, lot 4 (le zéro qui joue le NULL).
--
-- Même défaut que `''` contre NULL, avec un chiffre à la place : deux écritures
-- pour la même absence, dont une qui se lit comme une valeur.
--
-- ⚠️ ET C'EST LE FRONT QUI LE FABRIQUE, SANS LE VOULOIR.
--    `athlete-profile-edit.tsx` fait `parseFloat(v) || 0` : vider la case envoie
--    `0`, et le serveur l'écrivait tel quel. Personne ne pèse zéro kilo.
--
--    Le robinet est fermé dans le même commit (`athlete_profile._mesure_ou_absence`),
--    côté SERVEUR et non dans le navigateur : c'est la règle de propriété du
--    projet, et un front corrigé laisserait passer tout autre client — la file
--    hors-ligne rejoue des patchs écrits par des versions antérieures.
--
-- AVANT (relevé du 11/09, sur 70 fiches) :
--    athletes.weight_kg = 0   : 28   (NULL : 1)
--    athletes.height_cm = 0   : 29   (NULL : 1)
--    current_one_rm à 0       : chinUp 59, muscleUp 23, pullUp 16, squat 13, dip 11
--
-- ⚠️ `age` EST DANS UNE MIGRATION À PART, et pour une raison qui vaut d'être
--    écrite : cette migration-ci était EN COURS D'ÉDITION quand elle a été
--    jouée. J'y ajoutais l'`UPDATE athletes SET age = NULL` ; elle est partie
--    deux minutes plus tôt. Le registre ne garde que le NOM du fichier, donc
--    l'ajout n'aurait jamais été exécuté en production — mais une base
--    reconstruite depuis les migrations, elle, l'aurait joué. Deux bases
--    divergentes, et rien pour le dire.
--
--    D'où la règle, qui n'était pas qu'une préférence de forme : UN FICHIER DE
--    MIGRATION NE SE MODIFIE PAS, on en écrit un second. Celui-ci décrit
--    exactement ce qu'il a fait ; les âges sont dans
--    `2026-09-11_les_ages_sont_jetes.sql`.
--
-- ⚠️ `training_weeks.athlete_weight_kg` N'Y EST PAS NON PLUS, et pour la raison
--    inverse : la colonne est PROPRE (0 zéro, 508 NULL sur 619). Ce sont les
--    lectures qui fabriquent le zéro — `training_tree.read_tree` fait
--    `else 0` — et le contrat annonce `weight: float` NON nullable. Le corriger
--    est un déploiement COUPLÉ au front, donc un lot à part.
--
-- ⚠️ LE FRONT NE VOIT PAS CE CHANGEMENT : il lit déjà `athlete.weight && …` et
--    `athlete.weight ? … : null`. Zéro et `null` tombent dans la même branche, et
--    le contrat annonce `float | None` depuis toujours. Vérifié avant d'écrire.

BEGIN;

UPDATE athletes SET weight_kg = NULL WHERE weight_kg <= 0;
UPDATE athletes SET height_cm = NULL WHERE height_cm <= 0;

-- ⚠️ LA CLÉ EST RETIRÉE, PAS MISE À `null`. Un `null` JSON se relit comme une
-- valeur — c'est le même piège d'un cran plus bas.
UPDATE athletes
   SET current_one_rm = (
         SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
           FROM jsonb_each(current_one_rm) AS e(k, v)
          WHERE (v#>>'{}')::numeric > 0)
 WHERE current_one_rm IS NOT NULL
   AND EXISTS (SELECT 1 FROM jsonb_each(current_one_rm) AS e(k, v)
                WHERE (v#>>'{}')::numeric <= 0);

ALTER TABLE athletes
    ADD CONSTRAINT weight_kg_positif CHECK (weight_kg > 0),
    ADD CONSTRAINT height_cm_positif CHECK (height_cm > 0);

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-11_un_zero_n_est_pas_une_mesure.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION :
--   SELECT count(*) FROM athletes WHERE weight_kg <= 0 OR height_cm <= 0;  -- 0
--   SELECT count(*) FROM athletes, jsonb_each(current_one_rm) AS e(k, v)
--    WHERE (v#>>'{}')::numeric <= 0;                                       -- 0
-- et la base doit REFUSER un retour en arrière :
--   UPDATE athletes SET weight_kg = 0 WHERE id = (SELECT id FROM athletes LIMIT 1);
--
-- ⚠️ APRÈS AVOIR JOUÉ : surveiller le geste « vider la case poids » sur la fiche
--    athlète. Le front envoie toujours `0` ; c'est le serveur qui le traduit, et
--    c'est ce chemin-là qu'il faut voir passer.
