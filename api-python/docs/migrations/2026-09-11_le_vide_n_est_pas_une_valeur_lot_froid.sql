-- LE VIDE N'EST PAS UNE VALEUR — lot FROID (FRE-137, lot 2).
--
-- ⚠️ CE N'ÉTAIT PAS « DEUX ENCODAGES QUI COHABITENT », C'ÉTAIT LE `''` QUI
--    REMPLAÇAIT LE `NULL`. Mesuré le 11/09, réparti par semaine d'entraînement :
--
--      semaine du   lignes   tempo ''   tempo NULL
--      2026-10         171        154            0
--      2026-09         849        638           18
--      2026-08       3 174        841        1 498
--      2026-07       2 546         20        1 796
--      2026-06       1 979          0        1 381
--
--    Les NULL sont l'héritage de l'ETL Firestore ; la bascule est nette en août,
--    quand eitri s'est mis à écrire via brokkr.
--
-- ⚠️ LE ROBINET EST FERMÉ AVANT CETTE MIGRATION, et l'ordre n'est pas
--    négociable : `prescription.vide_vaut_absence` convertit depuis le lot 1.
--    Jouer ceci pendant que l'écriture reposait des `''` aurait nettoyé une
--    flaque sous un robinet ouvert — sur `weight`, `sets` et `reps`, c'est
--    quotidien.
--
-- ⚠️ TROIS CHEMINS D'ÉCRITURE Y MÈNENT, pas deux : le PATCH d'une ligne, le POST
--    d'un exercice, et `inserer_ligne` (création d'arbre, `PUT /weeks/content`,
--    génération de semaine, duplication). Le deuxième a été trouvé par une spec,
--    pas par la lecture du code.
--
-- ⚠️ LOT « FROID » : du texte libre que personne ne dérive. Ni le tonnage, ni les
--    records, ni l'ETL ne lisent ces trois colonnes — c'est ce qui en fait le bon
--    endroit pour éprouver le geste avant les colonnes chaudes.
--
-- AVANT (relevé du 11/09, `SELECT count(*) … WHERE btrim(x) = ''`) :
--    coach_note        5 206
--    athlete_feedback    540
--    link              4 579
--
-- ⚠️ ET LE COMPTE NE SE RECOPIE PAS DANS UN COMMENTAIRE DE CODE. C'est
--    l'invariant `pas_de_texte_vide` (`make invariants`) qui porte l'état — un
--    chiffre gravé ailleurs vieillit en silence, et celui de `supports` a menti
--    deux jours après avoir été écrit.

BEGIN;

UPDATE training_exercises SET coach_note       = NULL WHERE btrim(coach_note) = '';
UPDATE training_exercises SET athlete_feedback = NULL WHERE btrim(athlete_feedback) = '';
UPDATE training_exercises SET link             = NULL WHERE btrim(link) = '';

-- Le CHECK est ce qui rend le retour IMPOSSIBLE plutôt que corrigé à chaque
-- lecture. `btrim` et non `<> ''` : une case remplie d'espaces n'est pas
-- davantage une valeur qu'une case vide, et le front en produit.
ALTER TABLE training_exercises
    ADD CONSTRAINT coach_note_non_vide       CHECK (btrim(coach_note) <> ''),
    ADD CONSTRAINT athlete_feedback_non_vide CHECK (btrim(athlete_feedback) <> ''),
    ADD CONSTRAINT link_non_vide             CHECK (btrim(link) <> '');

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-11_le_vide_n_est_pas_une_valeur_lot_froid.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION :
--   SELECT count(*) FROM training_exercises
--    WHERE btrim(coach_note) = '' OR btrim(athlete_feedback) = ''
--       OR btrim(link) = '';                                  -- attendu : 0
-- et la base doit REFUSER un retour en arrière :
--   UPDATE training_exercises SET coach_note = '' WHERE id = (
--     SELECT id FROM training_exercises LIMIT 1);              -- refusé
--
-- ⚠️ APRÈS AVOIR JOUÉ : `make invariants`, puis le harnais réel. Et surveiller
--    les 500 pendant une journée de saisie — c'est le seul moment où un chemin
--    d'écriture oublié se manifesterait.
