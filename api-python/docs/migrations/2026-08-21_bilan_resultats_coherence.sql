-- LA BASE GARANTIT LA FORME D'UN RÉSULTAT, PAS SEULEMENT LE ROUTEUR.
--
-- ⚠️ POURQUOI CE N'EST PAS REDONDANT AVEC LES GARDES HTTP. `patch_resultat`
-- refuse déjà une mesure droite sur un test sans côté, et une mesure sur un test
-- qui n'en attend pas. Mais une garde de routeur ne protège que le chemin qu'on
-- a écrit : un script de reprise, un correctif SQL passé à la main un soir de
-- panne, ou une route ajoutée demain par habitude écrivent sans la croiser. Les
-- specs de schéma de ce projet le disent depuis le début — « les garanties qu'on
-- cherche ici doivent tenir même si une route se trompe ».
--
-- Et le coût d'une donnée mal formée est ici particulièrement sournois : une
-- `mesure_droite` posée au hasard sur un test de TRONC ne se voit sur aucun
-- écran (l'interface n'affiche qu'un champ pour ces tests), donc personne ne la
-- corrige — jusqu'au jour où une comparaison la ramasse.
--
-- ⚠️ POSÉ MAINTENANT PARCE QUE `bilan_resultats` EST VIDE. Les modèles, eux, sont
-- déjà composés (2 modèles, 33 tests le 21/08) : la fenêtre pour contraindre sans
-- reprise de données se referme au premier bilan passé. Vérifié avant d'écrire :
-- zéro ligne, donc zéro violation possible.

-- Un test sans côté n'a pas de valeur droite.
BEGIN;

ALTER TABLE bilan_resultats
    ADD CONSTRAINT bilan_resultats_cote_droit_si_bilateral
    CHECK (bilateral OR mesure_droite IS NULL);

-- Un test qui ne se mesure pas ne porte aucun nombre : seul le ressenti et le
-- commentaire y ont un sens. Sans cette contrainte, la valeur dormirait en base,
-- invisible à l'écran — donc jamais corrigée.
ALTER TABLE bilan_resultats
    ADD CONSTRAINT bilan_resultats_mesures_si_mesurable
    CHECK (mesure <> 'aucune'
           OR (mesure_gauche IS NULL AND mesure_droite IS NULL));

COMMIT;

-- Vérification :
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'bilan_resultats'::regclass AND contype = 'c';
