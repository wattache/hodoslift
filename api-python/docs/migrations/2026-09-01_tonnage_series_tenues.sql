-- FRE-110 — le tonnage compte les séries TENUES, et garde le prescrit en repère.
--
-- Vérifié sur la vraie base avant d'écrire ce fichier (`information_schema`) :
-- `training_sets` ne porte aujourd'hui que `tonnage_kg`, aucune contrainte sur
-- ces colonnes. C'est la seule chose à ajouter.
--
-- ⚠️ À JOUER AVANT DE DÉPLOYER brokkr, et l'ordre est l'INVERSE de celui du
--    retrait de `%` ce matin. Ici la base doit OFFRIR avant que le code ne
--    demande : sans la colonne, le job nocturne tombe en `UndefinedColumn` et
--    l'agrégat du Suivi aussi (`sum(tonnage_prevu_kg)`). Là-bas le serveur
--    devait cesser d'accepter avant que la base ne cesse de permettre. La règle
--    n'est pas « toujours avant » ni « toujours après » : c'est celui des deux
--    qui RESTREINT qui passe en second.
--
-- ⚠️ AUCUNE DONNÉE N'EST TOUCHÉE, et c'est ce qui rend ce ticket sans risque.
--    `training_sets` est une PROJECTION dérivée, reconstruite intégralement à
--    chaque passage du job (`DELETE` puis `INSERT … SELECT` depuis l'arbre) : la
--    source de vérité reste `training_exercises`, et rien n'est perdu si la table
--    est vidée. La colonne sort donc NULL sur les 13 500 lignes existantes, puis
--    se remplit au premier rebuild — inutile de la peupler ici.
--
-- CE QUI CHANGE DE SENS, EN REVANCHE, et il vaut mieux le savoir : `sets` porte
-- désormais les séries TENUES. Une série notée `FAIL` dans `felt_rpe_by_set`
-- n'est plus comptée, ce qui corrige le tonnage ET le volume — les deux
-- créditaient un travail qui n'a pas eu lieu.
--
-- Mesuré avant de changer : 81 lignes concernées, 36 731 kg comptés pour 9 093
-- réellement tenus, soit -0,32 % du tonnage total (8 736 745 kg). Concentré :
-- 51 de ces lignes tombent à zéro, et six athlètes portent l'essentiel de
-- l'écart — leurs courbes baisseront visiblement sur les semaines concernées.
-- C'est exactement pour ça que `tonnage_prevu_kg` existe : sans second repère,
-- une semaine d'échecs se lit « il n'est pas venu » alors que l'athlète était
-- là, sous une barre trop lourde.

-- ⚠️ `IF NOT EXISTS` PARCE QUE CE FICHIER A DÉJÀ ÉTÉ JOUÉ UNE FOIS, incomplet.
-- Il ne portait que `tonnage_prevu_kg` : `sets_prevus` a été ajouté au code
-- APRÈS, en dessinant le graphe (le volume en répétitions avait besoin du même
-- repère), et cette migration n'a pas été reprise. Le rebuild suivant est tombé
-- en `UndefinedColumn` — transaction annulée, aucune donnée perdue, mais le
-- Suivi serait resté sur une projection périmée si personne n'avait regardé.
--
-- La leçon est celle de la matinée, à l'envers : ce matin la migration avait été
-- écrite d'après le code sans lire la base ; ici le code a bougé après la
-- migration sans qu'elle suive. Dans les deux cas c'est `make schema-verifier`
-- qui tranche — il compare `docs/postgres-schema.sql` à la vraie base, colonnes
-- comprises. À jouer APRÈS toute migration, avant de déployer.

BEGIN;

ALTER TABLE training_sets
  ADD COLUMN IF NOT EXISTS tonnage_prevu_kg numeric,
  ADD COLUMN IF NOT EXISTS sets_prevus      integer;

COMMIT;

-- Puis, pour que le Suivi ne serve pas des NULL jusqu'à 3 h 30 :
--     DATABASE_URL=… uv run python -m scripts.etl_training_sets --apply
