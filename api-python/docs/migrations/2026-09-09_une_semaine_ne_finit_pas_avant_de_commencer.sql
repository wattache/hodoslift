-- UNE SEMAINE NE SE TERMINE PAS AVANT D'AVOIR COMMENCÉ (FRE-138).
--
-- `calendar_events` et `competitions` portent ce `CHECK` depuis toujours.
-- `training_weeks` et `training_blocks` ne l'ont jamais eu, et deux semaines en
-- production sont à l'envers.
--
-- ⚠️ CE N'EST PAS UNE FAUTE DE SAISIE, ET LA DONNÉE LE DIT. Les deux portent la
--    MÊME signature : `end_date` juste, `start_date` en avance de VINGT-HUIT
--    jours exactement. Deux fois le même écart, sur la même colonne, chez le
--    même athlète (WILLI LAGACHETTE, macro « Reprise ») :
--
--      bloc « Force »,   S1 : 2026-03-16 → 2026-02-22   (attendu 02-16 → 02-22)
--      bloc « Reprise », S5 : 2026-03-09 → 2026-02-15   (attendu 02-09 → 02-15)
--
--    Une main ne se trompe pas deux fois de la même façon. Quelque chose a
--    ajouté quatre semaines à un début sans toucher à la fin.
--
-- ⚠️ LA VALEUR DE REPRISE EST CORROBORÉE DEUX FOIS, INDÉPENDAMMENT, et ce n'est
--    donc pas une reconstitution :
--      · par les SEMAINES VOISINES du même bloc, contiguës de part et d'autre —
--        Force S2 commence le 02-23, soit 02-16 + 7 ; Reprise S4 commence le
--        02-02, soit 02-09 − 7 ;
--      · par le BLOC lui-même — « Force » commence le 2026-02-16, « Reprise » se
--        termine le 2026-02-15. Les deux dates manquantes, portées par un autre
--        objet que celui qu'on répare.
--    D'où `start_date = end_date - 6`, qui redonne exactement ces valeurs.
--
-- ⚠️ LA CAUSE N'EST PLUS ATTEIGNABLE PAR L'APPLICATION D'AUJOURD'HUI, mesuré :
--    les deux lignes portent `source_updated_at` au 2026-08-12, soit AVANT la
--    bascule Postgres du 16/08 — elles viennent du front v1. Les trois chemins
--    d'écriture actuels posent les deux dates ENSEMBLE et contiguës
--    (`blockWeekDates`, `generate-week`, `next-week`), et aucun écran ne patche
--    le début d'une semaine tout seul.
--
--    Ce qui reste ouvert est le SCHÉMA, pas un geste : `PATCH /weeks/{id}`
--    accepte `startDate` sans `endDate`, et rien ne l'en empêche. Le `CHECK`
--    ferme ça pour de bon — et il ferme aussi les causes qu'on n'a pas trouvées,
--    ce qu'aucune chasse au chemin d'écriture ne peut promettre.
--
-- ⚠️ ET IL A FALLU UNE GARDE AU FRONT AVANT DE LE POSER. `setS1Date` écrivait
--    chaque date de S1 indépendamment ; `blockWeekDates` reprend cette paire
--    telle quelle pour la semaine 1. Une fin saisie avant le début aurait donc
--    fait REFUSER l'écriture par la contrainte — donc `PUT /base` en 500, donc
--    la trame entière non enregistrable. C'est le défaut exact que
--    `e2e-reel/base-sans-dates` garde depuis la 3e passe de revue. La règle est
--    dans `datesDeS1` (eitri, `lib/program-selection.ts`), avec ses specs, et
--    elle part dans le même déploiement.
--
--    Mesuré avant de poser la contrainte : 0 bloc dont la S1 est inversée,
--    0 bloc inversé, 2 semaines. Rien d'autre à reprendre.

BEGIN;

UPDATE training_weeks
   SET start_date = end_date - 6
 WHERE end_date < start_date;

-- ⚠️ APRÈS la reprise, sinon la contrainte refuse la table qu'elle valide.
ALTER TABLE training_weeks
  ADD CONSTRAINT training_weeks_dates
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

-- ⚠️ `training_blocks` N'EN VIOLE AUCUNE, et il la reçoit quand même : ses dates
--    viennent des mêmes gestes, et un invariant qui ne tient que sur une des
--    deux tables laisse la moitié de la porte ouverte. Le poser pendant qu'il
--    est vert coûte un `ALTER` ; le poser après coûte une reprise.
ALTER TABLE training_blocks
  ADD CONSTRAINT training_blocks_dates
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

-- ⚠️ LES DEUX FORMES SONT TOLÉRANTES AU NULL, à la différence de
--    `calendar_events` et `competitions` où les colonnes sont obligatoires. Ici
--    54 blocs sur 125 n'ont aucune date : `end_date >= start_date` tout court
--    rendrait NULL, donc passerait — mais l'écrire explicitement dit ce qu'on
--    veut plutôt que de s'en remettre à la logique ternaire de SQL.

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-09_une_semaine_ne_finit_pas_avant_de_commencer.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;


-- VÉRIFICATION, après le COMMIT :
--
--   make invariants
--   → `dates_inversees` à zéro, et sa tolérance tombe à 0 dans le même commit.
--
--   La contrainte, elle, se vérifie toute seule : elle EXISTE ou elle n'existe
--   pas, et `make schema-verifier` compare désormais les contraintes (FRE-133).
