-- UN GROUPE LIÉ PORTE SA NATURE (FRE-145).
--
-- Deux lignes liées sont un bi-set ou un dropset : il n'y a pas de troisième
-- cas. La colonne, elle, portait encore NULL sur une partie des groupes — et
-- personne ne le voyait, parce que la LECTURE rattrape (`training_tree._sortie`
-- rend « biset » pour toute colonne nulle qui porte un groupe). Deux groupes
-- identiques à l'écran, deux encodages en base.
--
-- ⚠️ CETTE REPRISE EST LA SECONDE, ET C'EST TOUT LE SUJET. La première est
--    `2026-08-29_group_kind_biset.sql`. Elle a été juste le soir même et fausse
--    trois jours après : des groupes nus sont réapparus, tous créés APRÈS elle.
--    Reprendre la donnée sans fermer le chemin d'écriture ne fait que déplacer
--    la date à laquelle l'écart revient.
--
-- ⚠️ D'OÙ L'ORDRE, QUI N'EST PAS UNE COMMODITÉ. Les deux causes sont fermées
--    AVANT ce fichier :
--      · `app/prescription.py` — `normaliser_groupes` donne `NATURE_PAR_DEFAUT`
--        à tout groupe qui arrive sans nature, quel que soit l'appelant ;
--      · `eitri/src/views/block-base-editor.tsx` — le liage d'accessoires dans
--        la BASE pose `groupKind` avec `groupId`, comme son jumeau de la SEMAINE
--        le fait depuis FRE-36. C'était le chemin qui produisait les nouvelles.
--    Jouer ce fichier avant l'un des deux garantit d'avoir à le rejouer.
--
-- ⚠️ LE COMPTE NE SE MET PAS ICI, il se lit. `make invariants` doit rendre ZÉRO
--    sur `groupe_sans_nature` après cette migration — et la tolérance de cet
--    invariant tombe à 0 dans le même commit, donc il criera tant que la reprise
--    n'est pas passée. C'est le rappel qu'on veut, et il ne se périme pas comme
--    un chiffre en commentaire.
--    (Mesure du 08/09, avant reprise, pour mémoire : onze lignes.)
--
-- ⚠️ LE GROUPE D'ABORD, LE DÉFAUT ENSUITE — ET L'ORDRE N'EST PAS COSMÉTIQUE.
--    Une première rédaction écrivait `biset` sur toute ligne nue. Elle donnait le
--    bon résultat aujourd'hui, et par ACCIDENT : la seule ligne de séance
--    concernée a une VOISINE DE GROUPE, dans la même séance, qui porte déjà
--    `biset`. Un groupe ne se répare pas en devinant ce que ses propres membres
--    disent déjà. Le jour où un membre de dropset serait nu, ce `UPDATE`
--    l'aurait retourné en bi-set sans que rien ne proteste.
--
--    (Le cas, mesuré : `biset-…-6-7`, positions 6 et 7. En Semaine 1 la 6 porte
--    `biset` et la 7 est nue — c'est la trace du liage en séance, où le front
--    n'écrit la nature que sur UNE ligne et compte sur la propagation serveur.
--    En Semaine 2, le même groupe — le `group_id` se répète d'une semaine à
--    l'autre — porte `biset` des deux côtés. Rien à y faire.)
--
--    `max(group_kind)` : le MÊME arbitrage que `_propager_la_nature` côté
--    serveur, sur le même périmètre — la séance pour une ligne, le bloc pour un
--    accessoire. Deux règles ici et là auraient été une divergence de plus.
--
-- ⚠️ `biset` SUR LES CINQ GROUPES DE BASE, ET C'EST VÉRIFIÉ À L'ÉCRAN, pas
--    déduit. J'en avais d'abord lu deux comme des DROPSETS parce que leurs deux
--    membres portent le même `name` — « signature du dropset ». La lecture était
--    fausse : je n'avais interrogé QUE la colonne `name`, et ce qui sépare les
--    deux lignes est ailleurs. À l'écran ce sont un TENU puis un DYNAMIQUE —
--    `BACK EXTENSION` variante ISO, 15" à 60 kg, puis `BACK EXTENSION`, 8 reps à
--    60 kg. Des bi-sets, confirmés sur les deux par William (09/09).
--
--    ⚠️ LA LEÇON VAUT PLUS QUE LE CAS : deux lignes de même NOM ne sont un
--    dropset que si rien d'autre ne les sépare. `variant`, `reps`, `repsUnit`,
--    la charge en font partie — un dropset, c'est le même mouvement en DESCENTE
--    de charge, pas deux régimes de contraction. Lire une seule colonne pour
--    trancher une question de métier, c'est se donner une réponse, pas la
--    trouver.
--
--    Le défaut reste `biset` pour un groupe qui n'a rien à dire, et il est juste
--    par ailleurs : la lecture le rend depuis toujours (l'écran affiche DÉJÀ
--    « BI-SET » sur ces cinq groupes — cette migration ne change rien à ce que le
--    coach voit), et l'éditeur de BASE n'offre aucune bascule dropset : 0 dropset
--    sur 15 groupes de BASE, ils n'ont jamais pu être déclarés autrement. Reste
--    une question PRODUIT — la BASE devrait-elle proposer le dropset ? — et pas
--    une dette de donnée.

BEGIN;

-- 1. HÉRITER de ce que le groupe dit déjà.
UPDATE training_exercises e
   SET group_kind = s.nature
  FROM (SELECT session_id, group_id, max(group_kind) AS nature
          FROM training_exercises
         WHERE coalesce(group_id, '') <> '' AND group_kind IS NOT NULL
         GROUP BY session_id, group_id) s
 WHERE e.session_id = s.session_id AND e.group_id = s.group_id
   AND e.group_kind IS NULL;

UPDATE training_base_accessories a
   SET group_kind = s.nature
  FROM (SELECT block_id, group_id, max(group_kind) AS nature
          FROM training_base_accessories
         WHERE coalesce(group_id, '') <> '' AND group_kind IS NOT NULL
         GROUP BY block_id, group_id) s
 WHERE a.block_id = s.block_id AND a.group_id = s.group_id
   AND a.group_kind IS NULL;

-- 2. Le DÉFAUT, pour les groupes dont AUCUN membre ne dit rien.
UPDATE training_exercises
   SET group_kind = 'biset'
 WHERE coalesce(group_id, '') <> '' AND group_kind IS NULL;

UPDATE training_base_accessories
   SET group_kind = 'biset'
 WHERE coalesce(group_id, '') <> '' AND group_kind IS NULL;

-- ⚠️ ET L'INVERSE AUSSI, tant qu'on y est : une nature SANS groupe fait croire
--    à un groupe d'un seul membre. C'est l'invariant `nature_sans_groupe`, vert
--    aujourd'hui — mais le geste « défaire le bi-set » de la BASE laissait la
--    nature derrière lui jusqu'à ce commit, et c'est exactement comme ça qu'on
--    fabrique l'écart symétrique. Le serveur le nettoie désormais à chaque
--    écriture (`normaliser_groupes`) ; ces deux ordres ferment le passé.
UPDATE training_exercises
   SET group_kind = NULL
 WHERE coalesce(group_id, '') = '' AND group_kind IS NOT NULL;

UPDATE training_base_accessories
   SET group_kind = NULL
 WHERE coalesce(group_id, '') = '' AND group_kind IS NOT NULL;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-08_un_groupe_lie_porte_sa_nature.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;


-- VÉRIFICATION, à jouer après le COMMIT — c'est l'invariant qui fait foi :
--
--   make invariants
--   → `groupe_sans_nature` et `nature_sans_groupe` à zéro.
--
--
-- ÉPROUVÉE SUR LA PRODUCTION LE 08/09, DANS UNE TRANSACTION ANNULÉE. Ce que
-- chaque ordre touche, dans l'ordre du fichier :
--
--     1. héritage, séances .............  1     ← le groupe à quatre BACK
--     2. héritage, BASE ................  0        EXTENSION, qui portait déjà
--     3. défaut, séances ...............  0        sa nature : il HÉRITE, il ne
--     4. défaut, BASE ..................  10       tombe pas sur le défaut
--     5. et 6. l'inverse ...............  0
--                                        ----
--                                         11
--
--     groupe_sans_nature : 11 → 0     nature_sans_groupe : 0 → 0
--     puis ROLLBACK, et 11 de nouveau — rien n'a été écrit.
--
-- ⚠️ CE RELEVÉ EST LA RAISON D'ÊTRE DE L'ÉTAPE 1, et il faut le lire comme tel :
--    sans elle, la ligne de séance serait passée par le défaut. Le résultat aurait
--    été le même CE JOUR-LÀ, puisque son groupe est un bi-set. C'est exactement le
--    genre de coïncidence qui fait garder une règle fausse.
