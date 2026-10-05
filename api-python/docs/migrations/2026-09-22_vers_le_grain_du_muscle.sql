-- LA FIGURE DESCEND AU MUSCLE : UNE DOULEUR SUIT (FRE-195).
--
-- La planche anatomique dessine une zone en plusieurs tracés — trois pour
-- l'avant-bras, quatre pour les ischio-jambiers — et ces tracés portent
-- désormais un nom. « Avant-bras » n'est plus une réponse : ce sont le
-- brachio-radial, le fléchisseur radial du carpe et le fléchisseur ulnaire.
--
-- ⚠️ LE MUSCLE VIENT DE L'ATHLÈTE, PAS D'UNE DÉDUCTION. William a écrit
-- « Brachial et brachio radial, dips » en août, et confirmé le 22/09 : c'est le
-- brachio-radial, à droite. On ne remappe que ce qu'on a demandé.
--
-- ⚠️ DEUX DOULEURS RESTENT SUR L'ANCIEN VOCABULAIRE, ET C'EST ASSUMÉ :
--
--   · « Coude gauche » (David) — `forearm:gauche`. Sa phrase dit « left elbow
--     close to forearm » : le coude n'est un muscle que de DOS (l'anconé), et
--     on ne sait pas si sa douleur est devant ou derrière.
--   · « Main » (Lionel) — `hands`, et même sans côté. La main se découpe
--     maintenant en paume et cinq doigts ; « sur le coté de la main » ne dit
--     pas lequel.
--   · « Tendinite » (Aghiles) — `forearm:droite`, déclarée le 22/09 à 21h14
--     par l'application, pendant l'écriture de cette migration. Le produit
--     VIT : une migration qui suppose la base figée se fait démentir le soir
--     même.
--
-- Elles ne s'allument plus sur la figure, mais restent LISIBLES partout —
-- carte, tableau des signalements, guichet — parce que le vocabulaire de
-- LECTURE garde ses libellés de repli (`zones.test.ts` le vérifie). William
-- leur demandera ; d'ici là, aucune information n'est perdue.
--
-- Les cinq autres douleurs ne bougent pas : épaules, pectoraux et genoux sont
-- dessinés d'un seul tracé, donc leur code est resté le même.
--
-- ⚠️ LE NOM DU FICHIER EST CE QUI L'ORDONNE, et `vers_` trie APRÈS
-- `une_douleur_reprise_retrouve_son_cote`, dont celle-ci DÉPEND : c'est elle
-- qui a rendu son côté à l'avant-bras, et sans elle la ligne cherchée ici
-- porte encore `forearm`, sans côté. Nommée « les_douleurs_descendent… », elle
-- serait passée avant et aurait levé. Troisième fois que ce piège se présente
-- aujourd'hui — après `les_douleurs_ouvertes…` et `plus_de_colonnes_kine…`.

BEGIN;

-- ⚠️ `zone = 'forearm:droite'` NE SUFFIT PAS À DÉSIGNER UNE LIGNE, et c'est le
-- garde de sortie qui l'a dit — en refusant de migrer. Aghiles a déclaré une
-- « Tendinite » au même endroit le 22/09 à 21h14, par l'application, pendant
-- qu'on écrivait ceci. Sa douleur n'est pas celle de William, et on ne devine
-- pas son muscle à sa place : il a dit « avant-bras droit », pas
-- « brachio-radial ». Elle reste où elle est, comme le coude de David et la
-- main de Lionel.
--
-- ON CIBLE DONC PAR CE QUI IDENTIFIE LA DOULEUR DE WILLIAM : le commentaire que
-- la reprise du suivi kiné a recopié depuis sa saisie d'août. C'est plus sûr
-- qu'un détour par son prénom, et ça dit de quelle ligne on parle.
UPDATE douleurs SET zone = 'brachioradialis:droite'
 WHERE zone = 'forearm:droite'
   AND id IN (SELECT douleur_id FROM douleur_logs
               WHERE commentaire LIKE 'Brachial et brachio radial%');

-- ── La vérification de sortie : elle LÈVE, elle n'affiche pas ────────────────
DO $$
DECLARE migrees int; restantes int;
BEGIN
  SELECT count(*) INTO migrees FROM douleurs WHERE zone = 'brachioradialis:droite';
  IF migrees <> 1 THEN
    RAISE EXCEPTION 'Attendu 1 douleur sur le brachio-radial droit, trouvé %.', migrees;
  END IF;

  -- ⚠️ IL EN RESTE, ET C'EST VOULU : le coude de David, la main de Lionel, la
  -- tendinite d'Aghiles. Ce compte est là pour qu'une reprise future ne les
  -- perde pas de vue — voir l'en-tête.
  SELECT count(*) INTO restantes FROM douleurs
   WHERE zone IN ('forearm:gauche', 'forearm:droite', 'hands');
  RAISE NOTICE 'Douleurs encore sur l''ancien vocabulaire : % — chacune attend que son athlète dise le muscle.',
               restantes;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-22_vers_le_grain_du_muscle.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
