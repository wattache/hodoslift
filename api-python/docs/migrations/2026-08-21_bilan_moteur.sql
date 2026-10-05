-- LE MOTEUR DE BILANS — remplace les deux tables du 21/08 matin.
-- Spec complète : docs/bilan-kine.md.
--
-- ⚠️ CE QUI CHANGE, ET POURQUOI. La première version écrivait les 32 tests dans
-- le code (`app/referentiel_bilan.py`), au motif que personne n'aurait
-- d'interface pour les éditer. La kiné doit justement pouvoir composer ses
-- bilans — un cycliste n'a pas les mêmes tests qu'un streetlifteur — donc le
-- référentiel devient de la DONNÉE. Les 32 tests restent : ils deviennent le
-- contenu du premier modèle, semé par `scripts/semer_modele_bilan.py`.
--
-- ⚠️ DROP SANS PRÉCAUTION : ces tables n'ont jamais porté une seule ligne (le
-- front n'existait pas encore). Aucune reprise, aucune rétrocompatibilité — et
-- c'est le seul moment où ce sera vrai, d'où l'intérêt de refondre maintenant
-- plutôt qu'après le premier bilan de Cyssi.

BEGIN;

DROP TABLE IF EXISTS bilan_resultats;
DROP TABLE IF EXISTS bilans;

-- ══════════════════════════════════════════════════════════════════════════
-- LE MODÈLE — composé par la kiné
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE bilan_modeles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nom         text NOT NULL,          -- « Bilan complet », « Cycliste »
    description text,
    cree_par    text REFERENCES kines(uid) ON DELETE SET NULL,
    -- Archivé = retiré des choix à la création d'un bilan. Les instances
    -- passées restent lisibles : on ne retire jamais un point d'une courbe de
    -- santé parce que le modèle a vieilli.
    archive     boolean NOT NULL DEFAULT false,
    cree_le     timestamptz NOT NULL DEFAULT now(),
    modifie_le  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bilan_rubriques (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modele_id  uuid NOT NULL REFERENCES bilan_modeles(id) ON DELETE CASCADE,
    libelle    text NOT NULL,           -- « Tests de mobilité »
    ordre      integer NOT NULL
);

CREATE INDEX bilan_rubriques_modele ON bilan_rubriques (modele_id, ordre);

CREATE TABLE bilan_tests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rubrique_id  uuid NOT NULL REFERENCES bilan_rubriques(id) ON DELETE CASCADE,
    libelle      text NOT NULL,
    protocole    text,                  -- départ, exécution, consignes

    -- LA PRESCRIPTION — des CHAMPS, pas de la prose. C'est ce qui rend une
    -- variation détectable : « 15 kg » écrit dans le protocole ne se compare
    -- pas, un nombre si.
    mesure       text NOT NULL DEFAULT 'aucune'
                 CHECK (mesure IN ('aucune', 'reps', 'secondes')),
    -- ⚠️ DIT S'IL Y A DEUX RÉSULTATS, pas si le geste a un côté. Le formulaire
    -- d'origine demandait « Droite/Gauche » à l'érecteur du rachis et au
    -- transverse — des tests de TRONC, où la case était un artefact de
    -- copier-coller. Les laisser bilatéraux remplirait `mesure_droite` au
    -- hasard sur ces tests-là, pour des années.
    bilateral    boolean NOT NULL DEFAULT false,
    charge_kg    numeric,
    -- Ce avec quoi la charge est produite. NULL = fonte nue. Sans ce champ,
    -- 25 kg d'élastique et 25 kg de kettlebell seraient le même nombre — or ce
    -- n'est ni le même effort ni le même matériel à sortir.
    materiel     text,
    -- Angles de prise de vue. Sert dès maintenant à l'écran (l'athlète doit
    -- savoir comment se filmer) et devient indispensable au lot C.
    vues         text[] NOT NULL DEFAULT '{}',
    cible        text,                  -- « 30 s », affiché sur les maintiens

    ordre        integer NOT NULL,
    -- ⚠️ RETRAIT DOUX. Retirer un test le fait disparaître des FUTURS bilans ;
    -- les résultats passés restent, et restent lisibles grâce à l'instantané
    -- ci-dessous. Une suppression franche effacerait des mesures d'athlètes.
    retire       boolean NOT NULL DEFAULT false
);

CREATE INDEX bilan_tests_rubrique ON bilan_tests (rubrique_id, ordre);

-- ══════════════════════════════════════════════════════════════════════════
-- L'INSTANCE — passée par un athlète
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE bilans (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id  uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

    -- Le modèle peut disparaître sans emporter les bilans : SET NULL, et le nom
    -- recopié pour que l'instance reste intelligible seule.
    modele_id   uuid REFERENCES bilan_modeles(id) ON DELETE SET NULL,
    modele_nom  text NOT NULL,

    bilan_date  date NOT NULL,
    -- Qui l'a conduit. NULL si l'athlète l'a rempli seul — et SET NULL au
    -- départ du kiné : le bilan appartient à l'athlète, pas au praticien.
    kine_uid    text REFERENCES kines(uid) ON DELETE SET NULL,

    -- ⚠️ `en_cours` EST LA RÈGLE, PAS L'EXCEPTION. 32 tests avec du matériel ne
    -- se remplissent pas d'une traite : sans reprise, on perd tout à l'abandon.
    -- Seul un bilan `finalise` entre dans une comparaison — un bilan en cours
    -- est un état de saisie, pas une mesure.
    statut      text NOT NULL DEFAULT 'en_cours'
                CHECK (statut IN ('en_cours', 'finalise')),

    -- ⚠️ L'HISTORIQUE MÉDICAL VIT ICI, PAS SUR `athletes`, ET C'EST DÉLIBÉRÉ.
    -- Porté par la fiche athlète, il ferait basculer TOUTE la table athlètes
    -- dans le périmètre des données de santé — donc dans le périmètre HDS
    -- (FRE-58), donc une migration totale le jour venu. Ici le périmètre
    -- médical se réduit aux tables de ce fichier : le déplacement devient
    -- chirurgical.
    --
    -- Effet de bord heureux : chaque bilan garde l'instantané de ce qui était
    -- connu À SA DATE, médicalement plus honnête qu'un champ écrasé. Un nouveau
    -- bilan pré-remplit depuis le précédent ; l'athlète corrige.
    antecedents text,
    notes       text,

    cree_le     timestamptz NOT NULL DEFAULT now(),
    modifie_le  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bilans_athlete_date ON bilans (athlete_id, bilan_date DESC);

CREATE TABLE bilan_resultats (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bilan_id      uuid NOT NULL REFERENCES bilans(id) ON DELETE CASCADE,

    -- L'identité STABLE du test, pour comparer d'un bilan à l'autre. NULL si le
    -- test a été supprimé franchement du modèle : le résultat survit, lisible
    -- par son instantané — il cesse seulement d'être comparé.
    test_id       uuid REFERENCES bilan_tests(id) ON DELETE SET NULL,

    -- ══════════════════════════════════════════════════════════════════════
    -- ⚠️ L'INSTANTANÉ — LA DÉCISION QUI PROTÈGE LES DONNÉES (spec §3.1)
    --
    -- Ce qui a été DEMANDÉ, figé au remplissage. SANS LUI, CHAQUE RETOUCHE DU
    -- MODÈLE RÉÉCRIT SILENCIEUSEMENT LE PASSÉ : la kiné fait passer le grip de
    -- 15 à 20 kg — geste parfaitement légitime — et les résultats déjà
    -- enregistrés se mettent à dire autre chose. Aucune alerte, aucune trace :
    -- juste une courbe devenue fausse.
    --
    -- Figer le référentiel réglerait le problème mais interdirait l'édition,
    -- qui est la demande. L'instantané tient les deux : le modèle vit
    -- librement, le résultat reste vrai. Corollaire : la comparaison entre deux
    -- bilans se VÉRIFIE sur l'instantané (même unité, même charge) au lieu
    -- d'être supposée.
    -- ══════════════════════════════════════════════════════════════════════
    test_libelle     text NOT NULL,
    rubrique_libelle text,
    -- ⚠️ LE PROTOCOLE AUSSI, ET LE FRONT L'A RÉVÉLÉ. L'écran de saisie doit
    -- afficher ce que l'athlète a à faire — or l'athlète n'a pas accès au
    -- catalogue des modèles (réservé à la kiné) : sans ces colonnes, il n'y a
    -- AUCUN chemin pour lui montrer les consignes. Et c'est cohérent avec le
    -- reste : un résultat obtenu sous une consigne doit garder cette consigne,
    -- sinon on relit demain une mesure d'hier avec les instructions d'après.
    protocole        text,
    vues             text[] NOT NULL DEFAULT '{}',
    cible            text,
    mesure           text NOT NULL CHECK (mesure IN ('aucune', 'reps', 'secondes')),
    bilateral        boolean NOT NULL,
    ordre            integer,           -- l'ordre du bilan tel qu'il était

    ressenti      text CHECK (ressenti IN ('ras', 'douleur', 'gene')),
    detail        text,

    -- ⚠️ NULL ≠ 0, ET LA DISTINCTION EST CLINIQUE.
    --   NULL = test NON RÉALISÉ (matériel absent, douleur qui l'empêche, pas eu
    --          le temps) ;
    --   0    = test réalisé, échec complet.
    -- Les confondre fausserait toute lecture d'évolution : un test sauté ferait
    -- un creux dans la courbe, indiscernable d'une régression. C'est le défaut
    -- le plus récurrent du projet — le vide et l'absence traités pareil.
    mesure_gauche numeric,
    mesure_droite numeric,

    -- ⚠️ LA CHARGE RÉELLEMENT UTILISÉE, parce que LA RÉALITÉ DÉVIE. Le protocole
    -- dit 15 kg ; la salle n'a qu'un disque de 12. Enregistrer le résultat comme
    -- s'il valait 15 serait un mensonge silencieux, propagé par chaque
    -- comparaison. Pré-remplie depuis le modèle, modifiable.
    charge_kg     numeric,
    materiel      text,

    modifie_le    timestamptz NOT NULL DEFAULT now()
);

-- Un test ne peut pas avoir deux résultats dans le même bilan. C'est ce qui rend
-- la saisie IDEMPOTENTE : un bilan en cours enregistre à chaque frappe, donc la
-- même ligne est réécrite des dizaines de fois.
CREATE UNIQUE INDEX bilan_resultats_unicite
    ON bilan_resultats (bilan_id, test_id) WHERE test_id IS NOT NULL;

CREATE INDEX bilan_resultats_bilan ON bilan_resultats (bilan_id);

COMMIT;

-- Vérification :
--
--   SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name LIKE 'bilan%'
--   ORDER BY table_name, ordinal_position;
--
-- Puis semer le premier modèle :
--   uv run python scripts/semer_modele_bilan.py --apply
