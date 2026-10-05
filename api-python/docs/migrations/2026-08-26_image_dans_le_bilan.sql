-- ═══════════════════════════════════════════════════════════════════════════
-- L'IMAGE DE DÉMONSTRATION SUIT DANS LE BILAN — FRE-99, lot B (26/08/2026)
--
-- Le manque était visible à l'écran : une photo rattachée au test du MODÈLE ne
-- s'affichait pas dans le bilan, là où elle sert. C'est pourtant le seul endroit
-- où quelqu'un exécute le mouvement — la kiné compose une fois, l'athlète et le
-- praticien lisent à chaque passage.
--
-- ⚠️ ON COPIE, ON NE JOINT PAS, et c'est la règle de tout ce domaine (§3.1). Un
-- résultat porte l'INSTANTANÉ de ce qui a été demandé : libellé, protocole,
-- charge, matériel. L'image est une consigne au même titre que le protocole
-- écrit — la lire en direct du modèle ferait qu'un bilan passé montrerait la
-- consigne d'aujourd'hui à côté du texte d'hier, les deux pouvant se
-- contredire sans que rien ne le signale.
--
-- ⚠️ LA CLÉ POINTE VERS LE MÉDIA, PAS VERS LE TEST. `bilan_tests.media_demo_id`
-- change quand la kiné change d'illustration ; l'objet, lui, ne disparaît
-- jamais — aucune route ne le supprime, et la clé Scaleway de brokkr ne porte
-- pas le droit de suppression. Un instantané qui pointe vers quelque chose
-- d'immuable est un instantané qui reste vrai.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE bilan_resultats
    ADD COLUMN media_demo_id uuid REFERENCES bilan_medias_demo(id) ON DELETE SET NULL;

-- ── LE RATTRAPAGE, UNE FOIS ────────────────────────────────────────────────
-- ⚠️ CE `UPDATE` NE SE REJOUE PAS, ET IL NE FAUT PAS LE PRENDRE POUR LA RÈGLE.
-- Il n'existe que parce que la fonctionnalité arrive APRÈS les bilans : sans
-- lui, un bilan ouvert aujourd'hui resterait vide d'images alors que son test
-- en porte une, et la fonctionnalité aurait l'air cassée le jour de sa
-- livraison. Après cette migration, un bilan prend l'image qu'il trouve à SA
-- création, et plus jamais celle d'après.
--
-- Il n'écrase rien : la colonne vient d'être créée, elle est NULL partout.
-- `WHERE t.media_demo_id IS NOT NULL` évite d'écrire des NULL sur les 96
-- résultats existants pour rien.
UPDATE bilan_resultats r
   SET media_demo_id = t.media_demo_id
  FROM bilan_tests t
 WHERE t.id = r.test_id
   AND t.media_demo_id IS NOT NULL;

COMMIT;

-- ── VÉRIFICATION (lecture seule) ───────────────────────────────────────────
-- Combien de résultats ont hérité d'une image, et combien de bilans distincts
-- en profitent. Zéro est un résultat NORMAL si aucun test du modèle n'a encore
-- de photo — ce n'est pas le signe que la migration a échoué.
--
-- SELECT count(*) AS resultats_avec_image,
--        count(DISTINCT bilan_id) AS bilans_concernes
--   FROM bilan_resultats WHERE media_demo_id IS NOT NULL;
