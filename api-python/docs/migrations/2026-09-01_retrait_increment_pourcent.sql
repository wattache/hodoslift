-- FRE-105 — l'unité d'incrément `%` n'existe plus.
--
-- ⚠️ ELLE ÉTAIT DÉJÀ CONTRAINTE EN BASE, et la première version de cette
--    migration l'ignorait : elle posait trois `ADD CONSTRAINT` et s'est cassée
--    sur « constraint … already exists » (42710). Les trois contraintes datent du
--    schéma d'origine (`2026-08-14_training_tree.sql`) et énumèrent le
--    vocabulaire, `%` compris. Il faut donc les REMPLACER, pas les ajouter.
--
--    Le réflexe qui a produit la faute : écrire la migration d'après le code
--    plutôt que d'après la base. Une lecture de `pg_constraint` avant de
--    l'écrire aurait montré ce qui existait déjà.
--
-- ⚠️ À JOUER APRÈS LE DÉPLOIEMENT DE brokkr, et l'ordre compte dans ce sens-là.
--    Le serveur cesse d'accepter `%` (les deux `Literal` de `training_line.py` et
--    `training_lecture.py`), PUIS la base cesse de le permettre. Jouée avant, la
--    contrainte serait posée pendant que l'ancien code peut encore écrire
--    l'unité : chaque tentative répondrait 500 au lieu de 422.
--
-- ⚠️ ET LA REPRISE DES DONNÉES EST VIDE, ce qui a été MESURÉ avant de décider :
--    zéro ligne sur les 17 227 des trois tables porte `increment_unit = '%'`, et
--    zéro porte la forme héritée « 5% » dans `increment`. Le mode n'a jamais
--    servi — il ne pouvait pas : la référence de calcul vivait dans un champ que
--    rien ne persistait, réparé le 26/08 puis retiré le 01/09. Le remplacement se
--    fait donc sans `NOT VALID` ni reprise : rien ne viole la nouvelle forme.
--
-- Pourquoi retiré plutôt que réparé : le pourcentage portait sur
-- `athletes.current_one_rm`, lu AU MOMENT DE LA GÉNÉRATION. Un même « +5 % »
-- produisait donc une charge différente selon le jour du clic, sans trace du 1RM
-- qui avait servi. C'est au coach de calculer son pourcentage et d'écrire les
-- kilos (décision de William, 01/09).
--
-- La forme est celle d'origine, au `%` près : NULL reste permis (774 lignes
-- d'exercice n'ont pas d'unité, et un incrément sans unité vaut des kilos), et la
-- chaîne VIDE reste refusée. Ne rien desserrer au passage — `''` n'existe nulle
-- part en base, le contrat le convertissant en NULL à l'écriture.

BEGIN;

ALTER TABLE training_exercises
  DROP CONSTRAINT training_exercises_increment_unit_check,
  ADD CONSTRAINT training_exercises_increment_unit_check
  CHECK (increment_unit IN ('kg', 'reps', 'rpe', 'sets'));

ALTER TABLE training_base_principles
  DROP CONSTRAINT training_base_principles_increment_unit_check,
  ADD CONSTRAINT training_base_principles_increment_unit_check
  CHECK (increment_unit IN ('kg', 'reps', 'rpe', 'sets'));

ALTER TABLE training_base_accessories
  DROP CONSTRAINT training_base_accessories_increment_unit_check,
  ADD CONSTRAINT training_base_accessories_increment_unit_check
  CHECK (increment_unit IN ('kg', 'reps', 'rpe', 'sets'));

COMMIT;
