-- UN TABLEAU DE SUPPORTS VIDE N'EXISTE PLUS (FRE-157).
--
-- ⚠️ LE VIDE ET LE NUL SE CONFONDAIENT À UNE FRONTIÈRE, encore une fois — dans
--    le fichier que FRE-140 venait justement de durcir. `routers/library.py`
--    fait `if supports:` à la lecture, et en Python un tableau VIDE est faux :
--    la clé était donc omise de la réponse, exactement comme pour un NULL.
--
-- ⚠️ ET C'EST LA DISTINCTION QU'ON SUPPRIME, PAS LA LECTURE QU'ON RÉPARE. Le
--    ticket proposait de rendre `[]` visible. Mesuré avant de trancher : le
--    front ne PEUT PAS produire `[]` (`views/library.tsx` omet la clé quand la
--    sélection est vide), et rien ne l'affiche différemment d'un NULL. « Renseigné,
--    aucun groupe » n'est donc exprimable ni à l'écriture, ni à l'écran : c'est
--    une distinction fantôme, et la préserver aurait demandé de la porter dans
--    trois couches pour que personne ne s'en serve.
--
--    On rend le vide IMPOSSIBLE. `if supports:` cesse alors de mentir sans qu'on
--    y touche, ce qui vaut mieux qu'une lecture corrigée au-dessus d'une donnée
--    ambiguë.
--
-- ⚠️ LE CHIFFRE GRAVÉ DANS LA MIGRATION PRÉCÉDENTE ÉTAIT FAUX. Elle affirme
--    « 29 entrées portent des supports » : mesuré le 09/09, c'est 24 remplies
--    plus 5 vides. Le commentaire comptait des tableaux vides comme des supports.
--    Règle maison : un commentaire qui affirme un état de la DONNÉE cite
--    l'invariant qui le garde, jamais un chiffre — d'où la contrainte ci-dessous
--    plutôt qu'un décompte remis à jour.
--
-- Les 5 entrées concernées, toutes de catégorie `exercices` : HSPU,
-- HIP ADDUCTION, SPLIT SQUAT, FRONT LEVER, WALL SIT. Aucune ne perd
-- d'information : un tableau vide n'en portait aucune.

BEGIN;

UPDATE library_entries
   SET supports = NULL
 WHERE supports IS NOT NULL AND cardinality(supports) = 0;

-- La contrainte de FRE-140 acceptait `[]` sans le vouloir : un tableau vide est
-- sous-ensemble de n'importe quel autre, donc `<@` le laissait passer.
ALTER TABLE library_entries DROP CONSTRAINT library_entries_supports;
ALTER TABLE library_entries ADD CONSTRAINT library_entries_supports CHECK (
    supports IS NULL
    OR (cardinality(supports) > 0
        AND supports <@ ARRAY['MU', 'PU', 'DIP', 'SQ']::text[]));

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-09_un_support_vide_n_existe_pas.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION :
--   SELECT count(*) FROM library_entries
--    WHERE supports IS NOT NULL AND cardinality(supports) = 0;   -- attendu : 0
-- et une tentative d'écriture doit être refusée par la base :
--   UPDATE library_entries SET supports = '{}' WHERE name = 'HSPU';  -- refusé
