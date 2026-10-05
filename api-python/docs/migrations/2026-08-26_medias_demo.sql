-- ===========================================================================
-- FRE-99 — LES MÉDIAS DE DÉMONSTRATION DU KINÉ (lot B)
--
-- La spec les annonce depuis le premier jour (`docs/bilan-kine.md` §3.6) sans
-- qu'ils aient jamais été créés : Thomas compose ses tests avec un protocole
-- écrit, et 39 photos qui vivent encore dans un PDF.
--
-- ⚠️ DEUX FAMILLES DE MÉDIAS, DEUX TABLES, ET C'EST TOUT LE SUJET. Celle-ci ne
-- porte QUE de la démonstration : le mouvement montré, identique pour tous,
-- sans personne d'identifiable. Les médias d'ATHLÈTE — son corps pendant le
-- test — sont du lot C, dans une table et un seau séparés, après FRE-58. Une
-- seule table ferait basculer les démonstrations dans le régime des données de
-- santé et annulerait la compartimentation que tout ce fichier construit.
--
-- ⚠️ IMAGES SEULEMENT POUR L'INSTANT, et le CHECK le dit. La spec prévoyait
-- `('image', 'video')`, mais une vidéo ne vivra PAS dans le seau : elle est
-- transcodée et servie par api.video, donc désignée par un identifiant chez eux,
-- pas par un chemin d'objet. Faire porter deux natures d'adresse au même champ
-- `chemin` serait exactement le genre d'ambiguïté qu'on paye deux ans plus tard.
-- « video » rejoindra le vocabulaire avec la colonne qui lui convient.
--
-- ⚠️ ET LE SEAU EST PRIVÉ, contrairement à ce qu'annonçait la spec (« objet du
-- bucket public »). Choix de William du 25/08 : la lecture passe donc par une
-- URL signée, pas par un lien direct. Le champ ne change pas, sa lecture si.
--
-- À appliquer à la main sur Neon, comme les précédentes.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bilan_medias_demo (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Chemin de l'objet DANS LE SEAU PRIVÉ (`french-forge-kine-prive`). Le nom
    -- du seau n'est PAS stocké ici : il vient de l'environnement, donc changer
    -- d'hébergeur ne demande pas de réécrire des lignes.
    chemin  text NOT NULL CHECK (btrim(chemin) <> ''),

    type    text NOT NULL DEFAULT 'image' CHECK (type IN ('image')),

    -- Ce que la photo montre, quand ce n'est pas évident. NULL est le cas
    -- courant : une image de départ de mouvement se passe de légende.
    legende text,

    -- ⚠️ SET NULL et non RESTRICT, à l'inverse de `kine_notes.kine_uid`. Une
    -- note de suivi sans auteur ne veut rien dire — c'est une observation
    -- clinique. Une photo de démonstration, si : elle montre un mouvement, pas
    -- un praticien. Elle doit survivre au départ de qui l'a téléversée.
    cree_par text REFERENCES kines(uid) ON DELETE SET NULL,
    cree_le  timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ SET NULL ICI AUSSI, et pour une raison différente : supprimer un média ne
-- doit pas emporter le TEST. Le protocole écrit reste utilisable sans image —
-- c'est même ainsi que les 32 tests fonctionnent aujourd'hui.
ALTER TABLE bilan_tests
    ADD COLUMN IF NOT EXISTS media_demo_id uuid
    REFERENCES bilan_medias_demo(id) ON DELETE SET NULL;

COMMENT ON TABLE bilan_medias_demo IS
    'Médias de DÉMONSTRATION du bilan kiné (FRE-99, lot B) — le mouvement '
    'montré, sans personne d''identifiable. ⚠️ NE JAMAIS y déposer de média '
    'D''ATHLÈTE : ceux-là sont du lot C, table et seau séparés, après FRE-58.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Vérification :
--
--   SELECT count(*) FROM bilan_medias_demo;                    -- 0 au départ
--   INSERT INTO bilan_medias_demo (chemin, type)
--        VALUES ('x.png', 'video');                            -- doit ÉCHOUER
--   INSERT INTO bilan_medias_demo (chemin) VALUES ('   ');     -- doit ÉCHOUER
-- ---------------------------------------------------------------------------
