-- UN GROUPE LIÉ PORTE SA NATURE, ET CETTE FOIS LA CAUSE EST FERMÉE (FRE-145).
--
-- La reprise du 08/09 avait vidé l'écart ; il est revenu. Le chemin resté
-- ouvert est celui du grain de la ligne : `_propager_la_nature` écrivait la
-- nature qu'on lui donnait, `NULL` compris, là où `normaliser_groupes` retombe
-- depuis toujours sur le défaut pour les écritures en masse. Une règle tenue
-- d'un côté et pas de l'autre — et c'est par le côté nu qu'elle est passée.
--
-- Le geste qui y arrive est le LIAGE. L'écran pose le lien sur les deux lignes
-- et la nature sur une seule, en deux patchs indépendants que rien n'ordonne :
-- celui qui ne porte que le lien ne lit pas toujours la nature de son voisin.
-- Depuis le commit qui accompagne cette migration, il pose le défaut au lieu du
-- vide, et le patch de nature requalifie ensuite le groupe entier.
--
-- ⚠️ LA NATURE VIENT DU GROUPE AVANT DE VENIR DU DÉFAUT. Une ligne nue dont le
-- voisin sait ce qu'il est n'a pas à devenir un bi-set : elle adopte la nature
-- du groupe, et c'est le cas réel — un bi-set à deux membres dont un seul est
-- qualifié. Le défaut ne sert qu'aux groupes entièrement nus, où il n'y a rien
-- à adopter et où la lecture inventait déjà « bi-set ».
--
-- ⚠️ LE GROUPE EST (PARENT, group_id), JAMAIS `group_id` SEUL. La génération
-- RECOPIE le même identifiant dans chaque semaine produite : un regroupement
-- sur la seule colonne mélangerait des séances entières et propagerait la
-- nature de l'une à l'autre.
--
-- ⚠️ LES DEUX TABLES, parce que l'invariant `groupe_sans_nature` compte les
-- deux et qu'une demi-reprise est le défaut que ce projet répète. Les
-- accessoires de BASE sont à zéro aujourd'hui ; la requête n'y écrira rien, et
-- elle sera là le jour où ce ne sera plus vrai.

BEGIN;

UPDATE training_exercises e
   SET group_kind = coalesce(
         (SELECT max(v.group_kind) FROM training_exercises v
           WHERE v.session_id = e.session_id AND v.group_id = e.group_id),
         'biset')
 WHERE coalesce(e.group_id, '') <> '' AND e.group_kind IS NULL;

UPDATE training_base_accessories a
   SET group_kind = coalesce(
         (SELECT max(v.group_kind) FROM training_base_accessories v
           WHERE v.block_id = a.block_id AND v.group_id = a.group_id),
         'biset')
 WHERE coalesce(a.group_id, '') <> '' AND a.group_kind IS NULL;

-- ⚠️ ELLE LÈVE, ELLE N'AFFICHE PAS. Un vérificateur qui sort vert pour la
-- mauvaise raison est pire que pas de vérificateur : il rassure. C'est le même
-- compte que l'invariant `groupe_sans_nature` (`make invariants`), joué ici à
-- la sortie du bloc — le seul endroit où il peut encore annuler l'écriture.
DO $$
DECLARE reste int;
BEGIN
  SELECT (SELECT count(*) FROM training_exercises
           WHERE coalesce(group_id, '') <> '' AND group_kind IS NULL)
       + (SELECT count(*) FROM training_base_accessories
           WHERE coalesce(group_id, '') <> '' AND group_kind IS NULL)
    INTO reste;
  IF reste <> 0 THEN
    RAISE EXCEPTION 'Il reste % ligne(s) groupée(s) sans nature — migration annulée.', reste;
  END IF;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-21_la_nature_suit_le_groupe.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
