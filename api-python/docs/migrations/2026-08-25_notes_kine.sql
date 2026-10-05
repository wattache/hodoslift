-- ===========================================================================
-- FRE-102 — LES NOTES DE SUIVI DU KINÉ, au fil de l'eau
--
-- Demande de Thomas : « pour son suivi, c'est bien d'avoir aussi des notes.
-- Comme ça le kiné prend des notes au fil de l'eau puis il sait où il en est. »
--
-- ⚠️ POURQUOI UNE TABLE ET PAS UN CHAMP SUR `bilans`. Un bilan porte déjà des
-- `notes`, mais elles sont ENFERMÉES dans une passation : elles ne s'écrivent
-- qu'à l'occasion d'un bilan et se relisent en le rouvrant. Le besoin est
-- l'inverse — noter ENTRE les bilans, quand il voit l'athlète, quand quelque
-- chose bouge, et retrouver le fil au même endroit.
--
-- ⚠️ UN JOURNAL, PAS UN BLOC-NOTES, et la phrase de Thomas le dit : « au fil de
-- l'eau » puis « il sait où il en est ». Un texte unique qu'on réécrit donne
-- l'état courant et perd la chronologie ; des entrées datées donnent les deux —
-- la dernière EST l'état, les précédentes racontent comment on y est arrivé.
--
-- ⚠️ ET DANS CE FICHIER-CI, avec les tables du bilan. Le périmètre des données
-- de santé reste ainsi circonscrit aux mêmes tables : le jour où FRE-58 impose
-- un hébergement HDS, le déplacement reste chirurgical au lieu d'emporter la
-- moitié de la base.
--
-- À appliquer à la main sur Neon (console SQL), comme les précédentes.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS kine_notes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

    -- ⚠️ L'AUTEUR EST NOT NULL, contrairement à `bilans.kine_uid` qui admet NULL
    -- pour « l'athlète l'a rempli seul ». Ici il n'y a pas d'autre auteur
    -- possible : une note de suivi est l'observation d'un praticien, et une note
    -- sans auteur ne voudrait rien dire le jour où le club aura deux kinés.
    --
    -- RESTRICT et non SET NULL : au départ d'un kiné, on refuse de perdre
    -- l'attribution en silence. Le geste devra être explicite — reprise ou
    -- suppression — et c'est une décision de personne, pas de base.
    kine_uid   text NOT NULL REFERENCES kines(uid) ON DELETE RESTRICT,

    contenu    text NOT NULL CHECK (btrim(contenu) <> ''),

    cree_le    timestamptz NOT NULL DEFAULT now(),
    modifie_le timestamptz NOT NULL DEFAULT now()
);

-- La lecture est TOUJOURS « les notes de cet athlète, du plus récent au plus
-- ancien » : l'index porte les deux colonnes dans cet ordre, sinon Postgres
-- balaie puis trie.
CREATE INDEX IF NOT EXISTS kine_notes_athlete
    ON kine_notes (athlete_id, cree_le DESC);

COMMENT ON TABLE kine_notes IS
    'Notes de suivi du kiné, hors bilan (FRE-102). ⚠️ DONNÉE DE SANTÉ : lisible '
    'du KINÉ DE CET ATHLÈTE SEUL — ni le coach, ni l''athlète. Voir FRE-58 pour '
    'le périmètre HDS.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Vérification :
--
--   SELECT count(*) FROM kine_notes;                        -- 0 au départ
--   INSERT INTO kine_notes (athlete_id, kine_uid, contenu)
--        VALUES ('…', '…', '   ');                          -- doit ÉCHOUER (CHECK)
-- ---------------------------------------------------------------------------
