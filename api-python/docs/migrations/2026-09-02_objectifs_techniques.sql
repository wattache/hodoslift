-- FRE-122 — les objectifs techniques par mouvement.
--
-- ⚠️ À JOUER AVANT DE DÉPLOYER brokkr : sans la table, la route répond 500 sur
--    sa première lecture. La base doit OFFRIR avant que le code ne demande —
--    l'inverse du retrait de `%` (FRE-105), où c'est le serveur qui restreignait
--    et devait donc passer en second. La règle : celui des deux qui RESTREINT
--    passe en dernier.
--
-- ⚠️ AUCUNE REPRISE DE DONNÉES : table neuve, personne n'écrit encore dedans.
--
-- ⚠️ ET UNE CLÉ ÉTRANGÈRE VERS LA BIBLIOTHÈQUE, dont la cible est COMPOSITE.
--    `library_entries` porte `UNIQUE (category, name)` et rien sur `name` seul —
--    vérifié dans `pg_constraint` avant d'écrire ce fichier, la leçon des deux
--    migrations fausses du 01/09. D'où la colonne `categorie`, constante à
--    'exercices', qui n'existe que pour satisfaire la référence.
--
-- Après application : `make schema-verifier` doit repasser au vert.

BEGIN;

CREATE TABLE objectifs_techniques (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

    -- ⚠️ LE MOUVEMENT EST UNE CLÉ ÉTRANGÈRE VERS LA BIBLIOTHÈQUE, ET C'EST LE
    -- POINT DÉLICAT DU TICKET. Rien ne relie une LIGNE d'exercice à la
    -- bibliothèque : `training_exercises.name` est une copie texte. Rapprocher
    -- un objectif d'une ligne ne peut donc se faire que par le NOM.
    --
    -- D'où le choix de stocker le TEXTE plutôt qu'un `library_entry_id` : la
    -- table se compare aux lignes exactement comme les lignes se comparent entre
    -- elles, sans résolution `id → nom` à chaque lecture.
    --
    -- Et d'où `ON UPDATE CASCADE` : un coach peut RENOMMER une entrée
    -- (`PATCH /library/entries/{id}`), et l'objectif doit suivre.
    --
    -- ⚠️ Mesuré le 02/09 avant de choisir : les 107 noms distincts portés par les
    -- 13 682 lignes correspondent TOUS à une entrée, même à la comparaison
    -- exacte. Le rapprochement par nom tient.
    --
    -- ⚠️ CE QUE CETTE CLÉ NE FAIT PAS : garantir que le mouvement correspond à
    -- une ligne. Un renommage ferait suivre l'objectif pendant que les lignes
    -- existantes gardent l'ancien nom — défaut ANTÉRIEUR, qui appartient aux
    -- lignes (FRE-123), pas à cette table.
    --
    -- `categorie` est CONSTANTE à 'exercices'. Elle n'existe que pour satisfaire
    -- la référence composite : la cible est `UNIQUE (category, name)`, et
    -- Postgres ne sait pas viser un index unique partiel.
    categorie  library_category NOT NULL DEFAULT 'exercices',
    mouvement  text NOT NULL,

    -- Le CHECK interdit l'entrée vide, comme `kine_notes` : un objectif sans
    -- texte est un clic de trop.
    texte      text NOT NULL CHECK (btrim(texte) <> ''),

    -- ⚠️ RÉFÉRENCE `users`, PAS `coaches` — la leçon de `kine_notes`, et elle a
    -- été payée une fois. Pointer vers le RÔLE liait l'objectif à lui : retirer
    -- le rôle coach à quelqu'un était alors refusé tant que ses objectifs
    -- existaient, et le seul moyen de passer outre était de les SUPPRIMER. Une
    -- contrainte posée pour protéger forçait à détruire.
    cree_par   text NOT NULL REFERENCES users(uid),

    -- ⚠️ `clock_timestamp()` ET NON `now()`, qui rend l'heure de DÉBUT DE
    -- TRANSACTION. Deux objectifs posés dans la même transaction porteraient
    -- alors la MÊME date, et « du plus récent au plus ancien » cesserait d'être
    -- un ordre — il retomberait sur l'ordre d'insertion, par accident.
    --
    -- Découvert par une spec qui posait deux objectifs et lisait la liste : elle
    -- est rouge sur `now()`. En production chaque requête a sa transaction, donc
    -- le défaut ne s'y voyait pas — c'est-à-dire qu'il attendait le premier
    -- import ou la première écriture groupée.
    cree_le    timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- Atteint, sans effacer l'histoire. NULL = encore en travail.
    clos_le    timestamptz,

    FOREIGN KEY (categorie, mouvement)
        REFERENCES library_entries (category, name) ON UPDATE CASCADE
);

-- La lecture est TOUJOURS « cet athlète, du plus récent au plus ancien » : la
-- route rend tout, l'écran regroupe par mouvement.
CREATE INDEX objectifs_techniques_athlete ON objectifs_techniques (athlete_id, cree_le DESC);

COMMIT;
