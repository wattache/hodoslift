-- LE BILAN KINÉ — deux tables. Spec complète : docs/bilan-kine.md.
--
-- Un bilan est une évaluation COMPLÈTE et OCCASIONNELLE : 32 tests protocolés, du
-- matériel, une heure. À ne pas confondre avec le signalement quotidien
-- (`daily_logs.kine`, livré le 18/08), qui est l'inverse sur tous les axes — trois
-- clics par jour, questionnaire mouvant, stockage `jsonb` libre.
--
-- ⚠️ POURQUOI DES TABLES STRUCTURÉES ICI, ALORS QUE LE QUOTIDIEN EST EN `jsonb`.
-- Le quotidien répond à « qui va mal en ce moment ? » et son questionnaire bouge
-- encore : le `jsonb` lui évite une migration à chaque reformulation. Le bilan
-- répond à « comment cet athlète évolue-t-il ? », et **la comparabilité exige la
-- structure**. Un tonnage de grip en texte libre ne se compare pas à celui d'il y
-- a six mois — c'est précisément ce que le Google Form actuel ne sait pas faire.
--
-- ⚠️ LE RÉFÉRENTIEL DES 32 TESTS N'EST PAS EN BASE, il vit dans
-- `app/referentiel_bilan.py`. Personne n'a d'interface pour l'éditer : une table
-- serait un référentiel que seul un UPDATE manuel touche, donc non relu et non
-- versionné. `bilan_resultats.test_code` n'a donc PAS de clé étrangère — c'est le
-- serveur qui valide, et une spec garantit qu'il le fait.

BEGIN;

CREATE TABLE bilans (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id    uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    bilan_date    date NOT NULL,
    -- Qui l'a conduit. NULL si l'athlète l'a rempli seul — et SET NULL au départ
    -- du kiné : le bilan appartient à l'athlète, pas au praticien.
    kine_uid      text REFERENCES kines(uid) ON DELETE SET NULL,

    -- ⚠️ `en_cours` EST LA RÈGLE, PAS L'EXCEPTION. 32 tests avec du matériel ne se
    -- remplissent pas d'une traite : sans reprise, on perd tout à l'abandon.
    -- Seul un bilan `finalise` entre dans une comparaison — un bilan en cours est
    -- un état de saisie, pas une mesure.
    statut        text NOT NULL DEFAULT 'en_cours'
                  CHECK (statut IN ('en_cours', 'finalise')),

    -- ⚠️ L'HISTORIQUE MÉDICAL VIT ICI, PAS SUR `athletes`, ET C'EST DÉLIBÉRÉ.
    -- Porté par la fiche athlète, il ferait basculer TOUTE la table athlètes dans
    -- le périmètre des données de santé — donc dans le périmètre HDS (FRE-58),
    -- donc une migration totale le jour venu. Ici le périmètre médical se réduit à
    -- DEUX tables : le déplacement devient chirurgical.
    --
    -- Effet de bord heureux : chaque bilan garde l'instantané de ce qui était
    -- connu À SA DATE, ce qui est médicalement plus honnête qu'un champ écrasé.
    -- Un nouveau bilan pré-remplit depuis le précédent ; l'athlète corrige.
    antecedents   text,
    notes         text,

    cree_le       timestamptz NOT NULL DEFAULT now(),
    modifie_le    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bilans_athlete_date ON bilans (athlete_id, bilan_date DESC);

CREATE TABLE bilan_resultats (
    bilan_id       uuid NOT NULL REFERENCES bilans(id) ON DELETE CASCADE,
    -- Le code du test, validé par le serveur contre `app/referentiel_bilan.py`.
    test_code      text NOT NULL,

    ressenti       text CHECK (ressenti IN ('ras', 'douleur', 'gene')),
    detail         text,

    -- ⚠️ NULL ≠ 0, ET LA DISTINCTION EST CLINIQUE.
    --   NULL = test NON RÉALISÉ (matériel absent, douleur qui l'empêche, pas eu
    --          le temps) ;
    --   0    = test réalisé, échec complet.
    -- Pour une kiné ces deux-là n'ont rien à voir, et les confondre fausserait
    -- toute lecture d'évolution : un test sauté ferait un creux dans la courbe,
    -- indiscernable d'une régression. C'est le défaut le plus récurrent du
    -- projet — le vide et l'absence traités pareil.
    mesure_gauche  numeric,
    mesure_droite  numeric,

    -- ⚠️ LA CHARGE RÉELLEMENT UTILISÉE, parce que LA RÉALITÉ DÉVIE. Le protocole
    -- dit 15 kg ; la salle n'a qu'un disque de 12. Enregistrer le résultat sous un
    -- test « grip 15 kg » serait un mensonge silencieux, et la comparaison d'un
    -- bilan à l'autre le propagerait. Pré-remplie depuis le référentiel,
    -- modifiable. Deux bilans se comparent si le code ET la charge coïncident —
    -- c'est VÉRIFIABLE, au lieu d'être promis.
    charge_kg      numeric,

    modifie_le     timestamptz NOT NULL DEFAULT now(),

    -- Un seul résultat par test et par bilan : c'est ce qui rend la saisie
    -- IDEMPOTENTE. Un bilan en cours enregistre à chaque frappe, donc la même ligne
    -- est réécrite des dizaines de fois ; sans cette clé, on accumulerait des
    -- doublons dont aucun ne serait « le » résultat.
    PRIMARY KEY (bilan_id, test_code)
);

COMMIT;

-- Vérification :
--
--   SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name IN ('bilans', 'bilan_resultats')
--   ORDER BY table_name, ordinal_position;
