-- UNE DOULEUR A UNE IDENTITÉ, ET DES LOGS QUI S'Y RATTACHENT (FRE-195).
--
-- Le suivi kiné existe depuis le 18/08 : `daily_logs.kine`, un objet libre où
-- l'athlète décrit ce qu'il ressent. Mesuré le 22/09, il porte 8 jours pour 7
-- athlètes — et sept de ces huit saisies précisent un côté en TEXTE LIBRE
-- (« Épaule droite », « Gêne pec gauche », « Genou gauche »), qu'aucune requête
-- ne sait relire. Une autre est en anglais.
--
-- Surtout : personne n'a saisi deux fois. Chaque signalement est un îlot, parce
-- qu'il n'existe aucun objet auquel le rattacher. C'est ce qui manque ici.
--
-- ⚠️ DEUX TABLES, ET PAS UN CHAMP DE PLUS DANS LE JSONB. La tentation était
-- d'écrire l'identifiant de la douleur dans `daily_logs.kine`, qui est déjà
-- libre. On s'en garde : FRE-193 et FRE-194 ont mesuré le mardi même ce que
-- coûte une référence sans clé étrangère — 53 tiers désignant des mouvements
-- que la bibliothèque ne connaît plus, et 37 blocs qui régénèrent sans leur
-- principal. Un `douleur_id` dans un objet libre serait la même faute, sur de
-- la donnée de santé.
--
-- ⚠️ LA CHRONICITÉ NE SE SAISIT PAS, ELLE SE DÉDUIT. Aucune colonne « récurrente » :
-- une douleur qui porte plusieurs logs EST récurrente, et une qui n'en porte
-- qu'un est ponctuelle. Un booléen à côté du compte finirait par le contredire —
-- c'est la même règle que « repos » dans la grille du cycle, qui se lit de
-- l'absence de tier au lieu de se cocher.
--
-- ⚠️ `daily_logs.kine` N'EST PAS TOUCHÉ. Les 8 saisies existantes y restent : leur
-- zone est une phrase, pas un code, et rien ne permet de deviner « Petit pec
-- gauche » en `chest:gauche` sans inventer. Le guichet du coach continue de les
-- lire comme aujourd'hui.

BEGIN;

-- LA DOULEUR SUIVIE — ce que l'athlète nomme, et retrouve d'une fois sur l'autre.
CREATE TABLE douleurs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

    -- Le nom que l'ATHLÈTE donne : « mon épaule », « la tendinite ». C'est par
    -- lui qu'il la reconnaît dans une liste, pas par le code anatomique.
    nom text NOT NULL CONSTRAINT douleurs_nom_non_vide CHECK (btrim(nom) <> ''),

    -- ⚠️ UN CODE, PAS UN LIBELLÉ : `chest:gauche`, `knees:droite`. Une des huit
    -- saisies est déjà en anglais ; stocker le mot affiché rendrait la donnée
    -- illisible d'une langue à l'autre, et impossible à regrouper. Le côté est
    -- celui DE L'ATHLÈTE, jamais celui de l'écran (cf. `lib/anatomie/zones.ts`).
    zone text NOT NULL CONSTRAINT douleurs_zone_non_vide CHECK (btrim(zone) <> ''),

    -- Depuis quand elle dure. NULL = l'athlète ne sait pas dire, ce qui est un
    -- cas réel : « 4 ans », « souvent en début de bloc » sont des réponses vraies
    -- qu'aucune date ne rend.
    debut date,
    -- Renseignée quand elle ne fait plus mal. NULL = toujours là.
    fin   date,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT douleurs_fin_apres_debut CHECK (fin IS NULL OR debut IS NULL OR fin >= debut)
);
CREATE INDEX ON douleurs (athlete_id);
-- Deux douleurs vivantes sur la même zone pour le même athlète n'ont pas de sens :
-- c'est la même, et c'est tout l'objet du rattachement. Une douleur CLOSE ne
-- bloque rien — la même épaule peut refaire mal six mois plus tard.
CREATE UNIQUE INDEX douleurs_une_vivante_par_zone
    ON douleurs (athlete_id, zone) WHERE fin IS NULL;

-- LE LOG — ce que l'athlète en dit un jour donné. Même mot que `daily_logs`,
-- et même grain : un fait, daté du jour qu'il décrit.
CREATE TABLE douleur_logs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    douleur_id uuid NOT NULL REFERENCES douleurs(id) ON DELETE CASCADE,

    -- Le jour QUE L'ATHLÈTE DÉCRIT, pas celui où il saisit : il note souvent le
    -- soir, parfois le lendemain. Même grain que `daily_logs.log_date`.
    log_date date NOT NULL,

    -- ⚠️ LA NOTE EXISTAIT DÉJÀ, sous `kine.intensite` (8 saisies sur 8, valeurs
    -- 2 à 6). Ce n'est donc pas une question neuve : c'est la même, enfin
    -- rattachée à quelque chose. `0` est une réponse — « plus mal aujourd'hui ».
    intensite smallint NOT NULL CHECK (intensite BETWEEN 0 AND 10),

    -- ⚠️ LE TEXTE RESTE, et il porte ce que la figure ne capturera jamais :
    -- « blessure fissure au ménisque », « dips » — le geste qui déclenche.
    -- `NULL` et jamais `''` : une seule façon de dire « rien » (FRE-137).
    commentaire text CONSTRAINT douleur_logs_commentaire_non_vide CHECK (btrim(commentaire) <> ''),

    created_at timestamptz NOT NULL DEFAULT now(),

    -- Un log par jour et par douleur : deux notes le même jour pour la même
    -- épaule se contrediraient, et la seconde est une correction, pas un fait de
    -- plus. L'écriture remplace.
    UNIQUE (douleur_id, log_date)
);
CREATE INDEX ON douleur_logs (douleur_id, log_date DESC);

-- ⚠️ SANS CECI LES TABLES NAISSENT INVISIBLES À L'APPLICATION. Le service se
-- connecte en `brokkr_app`, un rôle qui ne possède rien : une table créée ici
-- lui est fermée tant qu'on ne lui ouvre pas. La liste de référence vit dans
-- `nidavellir/sql/brokkr_app.sql`, et les deux doivent rester d'accord.
GRANT SELECT, INSERT, UPDATE, DELETE ON douleurs TO brokkr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON douleur_logs TO brokkr_app;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-22_les_douleurs_suivies.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
