-- ===========================================================================
-- L'AUTEUR D'UNE NOTE EST UNE PERSONNE, PAS UN RÔLE
--
-- Signalé par William le 26/08, en une phrase qui dit tout : « je ne peux pas
-- supprimer un kiné s'il a des notes, mais je peux le supprimer même s'il a
-- uploadé des photos ? »
--
-- Les deux comportements étaient incohérents entre eux, et mauvais tous les
-- deux — pour la même raison, qui n'est ni RESTRICT ni SET NULL :
--
-- ⚠️ LES DEUX CLÉS POINTAIENT VERS `kines(uid)`, C'EST-À-DIRE VERS UN RÔLE.
-- Or on ne supprime jamais un `users` dans ce produit : on retire une ligne
-- `kines`, ce qui est une RÉTROGRADATION. La personne, elle, reste. Faire
-- dépendre l'auteur d'une note du rôle qu'il occupait revient à dire que
-- Thomas n'a jamais écrit ces notes le jour où il cesse d'être kiné.
--
-- Conséquences observées, chacune absurde à sa façon :
--
--   · `kine_notes` en RESTRICT — retirer le rôle est REFUSÉ tant que des notes
--     existent. Le seul moyen de passer outre est donc de SUPPRIMER des notes
--     cliniques. Une contrainte posée pour protéger la donnée forçait à la
--     détruire ;
--
--   · `bilan_medias_demo` en SET NULL — l'attribution disparaît alors que la
--     personne est toujours là, dans `users`, à un `SELECT` de distance.
--
-- LA CORRECTION EST LA MÊME DES DEUX CÔTÉS : pointer vers `users(uid)`. Le
-- retrait d'un rôle ne touche alors plus rien, l'attribution survit, il n'y a
-- plus de RESTRICT à contourner ni de NULL à expliquer.
--
-- ⚠️ AUCUNE DONNÉE NE BOUGE : les uid sont les mêmes chaînes des deux côtés.
-- Seule la contrainte change de cible.
--
-- À appliquer à la main sur Neon.
-- ===========================================================================

-- --- Les notes de suivi (FRE-102) -----------------------------------------
BEGIN;

ALTER TABLE kine_notes
    DROP CONSTRAINT IF EXISTS kine_notes_kine_uid_fkey;

-- ⚠️ PLUS DE ON DELETE DU TOUT, et c'est le fond de la correction. `users` n'est
-- jamais supprimé : une clause de suppression décrirait un événement qui
-- n'arrive pas, et inviterait à la « corriger » un jour sans comprendre
-- pourquoi elle était là.
ALTER TABLE kine_notes
    ADD CONSTRAINT kine_notes_auteur_fkey
    FOREIGN KEY (kine_uid) REFERENCES users(uid);

COMMENT ON COLUMN kine_notes.kine_uid IS
    'Auteur de la note — une PERSONNE (users), pas un rôle. Retirer le rôle '
    'kiné ne touche donc pas les notes : elles restent attribuées.';

-- --- Les médias de démonstration (FRE-99) ---------------------------------
ALTER TABLE bilan_medias_demo
    DROP CONSTRAINT IF EXISTS bilan_medias_demo_cree_par_fkey;

-- SET NULL conservé ICI, et pour une raison qui tient encore : `users` n'est
-- jamais supprimé non plus, mais `cree_par` est déjà nullable — une photo
-- importée par un script n'a pas d'auteur. La clause décrit donc un cas réel.
ALTER TABLE bilan_medias_demo
    ADD CONSTRAINT bilan_medias_demo_auteur_fkey
    FOREIGN KEY (cree_par) REFERENCES users(uid) ON DELETE SET NULL;

COMMENT ON COLUMN bilan_medias_demo.cree_par IS
    'Qui a téléversé — une PERSONNE (users), pas un rôle. NULL si importé sans '
    'auteur identifié.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Vérification : retirer le rôle kiné de quelqu'un qui a des notes ne doit plus
-- rien refuser.
--
--   DELETE FROM kines WHERE uid = '<uid>';   -- doit PASSER
--   SELECT count(*) FROM kine_notes WHERE kine_uid = '<uid>';  -- inchangé
-- ---------------------------------------------------------------------------
