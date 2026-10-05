-- ═══════════════════════════════════════════════════════════════════════════
-- PLUSIEURS IMAGES PAR TEST — FRE-99, lot B (26/08/2026)
--
-- Le formulaire papier de Thomas le faisait déjà : un mouvement se montre en
-- deux ou trois photos — le départ, le passage, l'arrivée — et une seule image
-- oblige à choisir laquelle des trois compte le plus. C'est le genre de choix
-- qu'on ne devrait pas avoir à faire.
--
-- ⚠️ DEUX TABLES DE LIAISON, PAS UN `uuid[]`. Un tableau se serait écrit en une
-- ligne mais aurait perdu la clé étrangère : Postgres ne contraint pas les
-- éléments d'un tableau. Une référence vers un média disparu serait alors
-- possible, et rien ne le dirait avant l'affichage.
--
-- ⚠️ ET LEURS SUPPRESSIONS EN CASCADE DIFFÈRENT, VOLONTAIREMENT :
--
--   · côté MODÈLE, `ON DELETE CASCADE` — le catalogue est vivant, retirer une
--     image en défait le lien, c'est tout ;
--   · côté RÉSULTAT, `ON DELETE RESTRICT` — un bilan passé est une mesure datée
--     sous une consigne donnée. Le jour où une route de suppression de média
--     existera (elle n'existe pas : la clé Scaleway ne porte pas ce droit),
--     elle devra REFUSER d'effacer ce qu'un bilan montre encore, au lieu de
--     vider une consigne du passé en silence.
--
-- L'ordre est porté explicitement : « départ, passage, arrivée » n'est pas la
-- même chose que « arrivée, départ, passage ».
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE bilan_test_medias (
    test_id  uuid NOT NULL REFERENCES bilan_tests(id)       ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES bilan_medias_demo(id) ON DELETE CASCADE,
    ordre    integer NOT NULL,
    -- La même image deux fois dans un test est une erreur de manipulation, pas
    -- une intention : la clé primaire la rend impossible.
    PRIMARY KEY (test_id, media_id)
);

CREATE TABLE bilan_resultat_medias (
    resultat_id uuid NOT NULL REFERENCES bilan_resultats(id)   ON DELETE CASCADE,
    media_id    uuid NOT NULL REFERENCES bilan_medias_demo(id) ON DELETE RESTRICT,
    ordre       integer NOT NULL,
    PRIMARY KEY (resultat_id, media_id)
);

-- ── REPRISE DE L'EXISTANT ──────────────────────────────────────────────────
-- Les liens uniques déjà posés deviennent des listes d'un élément. Aucune perte
-- possible : on lit avant de supprimer, dans la même transaction.
INSERT INTO bilan_test_medias (test_id, media_id, ordre)
SELECT id, media_demo_id, 0 FROM bilan_tests WHERE media_demo_id IS NOT NULL;

-- ⚠️ GARDÉ PAR UN TEST DE CATALOGUE : la migration précédente
-- (`2026-08-26_image_dans_le_bilan.sql`) a peut-être été appliquée, peut-être
-- pas. Sans cette précaution, rejouer les deux dans l'ordre marche et ne les
-- jouer que dans le désordre casse — un piège pour rien.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'bilan_resultats' AND column_name = 'media_demo_id') THEN
        INSERT INTO bilan_resultat_medias (resultat_id, media_id, ordre)
        SELECT id, media_demo_id, 0 FROM bilan_resultats WHERE media_demo_id IS NOT NULL;
    END IF;
END $$;

ALTER TABLE bilan_tests     DROP COLUMN IF EXISTS media_demo_id;
ALTER TABLE bilan_resultats DROP COLUMN IF EXISTS media_demo_id;

COMMIT;

-- ── VÉRIFICATION (lecture seule) ───────────────────────────────────────────
-- Ce qui a été repris, des deux côtés. Zéro est normal si aucune photo n'était
-- encore rattachée.
--
-- SELECT (SELECT count(*) FROM bilan_test_medias)     AS liens_modele,
--        (SELECT count(*) FROM bilan_resultat_medias) AS liens_bilans;
