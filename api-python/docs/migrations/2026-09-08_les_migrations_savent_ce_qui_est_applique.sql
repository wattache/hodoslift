-- LES MIGRATIONS SAVENT CE QUI EST APPLIQUÉ (FRE-133).
--
-- Trois lignées de schéma coexistent : la production (45 fichiers passés à la
-- main par `psql`, dans l'ordre du nom), `docs/postgres-schema.sql` (écrit APRÈS
-- coup, et c'est lui que pytest exécute), et le bac à sable du harnais réel (un
-- `pg_restore` de prod, jamais rejoué avec les migrations).
--
-- ⚠️ RIEN NE SAIT CE QUI A ÉTÉ JOUÉ, ET ÇA A UN COÛT MESURÉ. Le 07/09, deux
--    fonctions de FRE-136 manquaient au bac à sable : une spec du harnais réel a
--    rendu 500, et il a fallu appliquer la migration à la main pour comprendre.
--    Même famille que le 06/09, où 34 specs échouaient sur un `archive_le`
--    absent. Ce n'est pas de la malchance, c'est l'absence de mécanisme.
--
-- ⚠️ CHAQUE FICHIER S'ENREGISTRE LUI-MÊME, DANS SA PROPRE TRANSACTION, et c'est
--    ce qui rend la trace HONNÊTE : si la migration échoue, la ligne n'est pas
--    écrite non plus. Un outil qui enregistrerait DE L'EXTÉRIEUR pourrait
--    marquer « appliqué » une migration à moitié passée — exactement le cas
--    qu'on veut rendre impossible.
--
--    D'où la convention, à mettre dans TOUT nouveau fichier, juste avant son
--    `COMMIT` :
--
--        INSERT INTO schema_migrations (fichier)
--        VALUES ('2026-09-08_le-nom-de-ce-fichier.sql');
--
--    ⚠️ ET LA LISTE DU RATTRAPAGE CI-DESSOUS EST GÉNÉRÉE, PAS ÉCRITE. Première
--       rédaction tapée de mémoire : 16 noms inventés sur 45, et 19 fichiers
--       réels oubliés. Une liste de fichiers se lit dans le dossier.
--
-- ⚠️ LA SÉRIE N'EST PAS REJOUABLE DEPUIS ZÉRO, ET IL FAUT LE SAVOIR AVANT DE
--    L'ESSAYER. Mesuré le 08/09 sur un Postgres 16 vierge : la TOUTE PREMIÈRE
--    migration suppose déjà `athlete_prs`, la deuxième `programs`, la troisième
--    `training_sets`. Les tables d'origine n'ont jamais été créées par une
--    migration — elles le furent par le basculement Firestore → Postgres.
--
--    La base de départ d'une base NEUVE est donc `docs/postgres-schema.sql`, et
--    c'est déjà ce que fait pytest. Les migrations, elles, font AVANCER une base
--    EXISTANTE. Les deux se rejoignent par le vérificateur de schéma, qui prouve
--    qu'elles décrivent la même chose — contraintes et index compris depuis le
--    08/09.
--
--    Corollaire pour qui voudrait faire construire à la CI un Postgres neuf « à
--    partir de la série » : ça ne marchera pas, et ce n'est pas un défaut à
--    réparer. C'est le fichier qui est la référence.
--
-- ⚠️ PAS D'ALEMBIC, ET LA RAISON N'A PAS CHANGÉ : il faudrait d'abord
--    réconcilier trois lignées, sinon on en ajoute une quatrième. Cette table
--    est une CONVENTION lisible, pas un cadre — `scripts/migrer.py` la lit et
--    n'invente rien.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    -- Le NOM DU FICHIER, pas un numéro de version : c'est l'identité qu'on a
    -- déjà, elle porte sa date, et elle se retrouve dans le dépôt sans index.
    fichier     text PRIMARY KEY,
    applique_le timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE schema_migrations IS
    'Ce qui a été appliqué à CETTE base. Alimentée par une ligne à la fin de '
    'chaque fichier de migration, donc dans SA transaction (FRE-133).';


-- --------------------------------------------------------------------------- #
-- LE RATTRAPAGE — les 45 fichiers déjà passés
--
-- ⚠️ ON LES DÉCLARE APPLIQUÉS SANS LES REJOUER, et c'est le seul geste possible :
--    ils SONT dans la production, et les rejouer serait au mieux inutile, au pire
--    destructeur (les lots de renommage de FRE-11 ne sont pas tous idempotents
--    au-delà de leur garde).
--
-- ⚠️ TOUTES PORTENT LA MÊME DATE, celle du rattrapage : personne ne sait quand
--    chacune a réellement été jouée. En inventer une par fichier ferait croire à
--    une chronologie qu'on n'a pas — le nom du fichier, lui, la porte déjà.
--
--    ⚠️ CE RATTRAPAGE EST À REJOUER SUR CHAQUE BASE, y compris le bac à sable —
--    c'est même là qu'il compte le plus, puisque c'est lui qui dérive.
-- --------------------------------------------------------------------------- #

INSERT INTO schema_migrations (fichier)
SELECT f FROM unnest(ARRAY[
    '2026-07-31_athlete_prs_identity.sql',
    '2026-08-03_block_objectives.sql',
    '2026-08-03_block_objectives_path_unique.sql',
    '2026-08-09_training_sets_weight_done.sql',
    '2026-08-11_competition_coach_availability.sql',
    '2026-08-12_training_sets_kind.sql',
    '2026-08-13_coach_profiles.sql',
    '2026-08-13_coach_profiles_langues.sql',
    '2026-08-14_training_tree.sql',
    '2026-08-15_base_kind.sql',
    '2026-08-15_block_objectives_fk.sql',
    '2026-08-15_source_updated_at.sql',
    '2026-08-17_kine.sql',
    '2026-08-17_training_sets_postgres.sql',
    '2026-08-18_daily_logs_kine.sql',
    '2026-08-20_library_created_by_set_null.sql',
    '2026-08-20_retrait_photos_athletes.sql',
    '2026-08-21_bilan_kine.sql',
    '2026-08-21_bilan_moteur.sql',
    '2026-08-21_bilan_resultats_coherence.sql',
    '2026-08-22_ris_competition.sql',
    '2026-08-22_users_email_sans_unicite.sql',
    '2026-08-24_index_training_sets_exercise_id.sql',
    '2026-08-25_mechano.sql',
    '2026-08-25_notes_kine.sql',
    '2026-08-26_auteur_est_une_personne.sql',
    '2026-08-26_image_dans_le_bilan.sql',
    '2026-08-26_medias_demo.sql',
    '2026-08-26_plusieurs_images_par_test.sql',
    '2026-08-29_group_kind.sql',
    '2026-08-29_group_kind_biset.sql',
    '2026-09-01_retrait_increment_pourcent.sql',
    '2026-09-01_tonnage_series_tenues.sql',
    '2026-09-02_objectif_de_bloc_atteint.sql',
    '2026-09-02_objectifs_techniques.sql',
    '2026-09-03_archiver_un_athlete.sql',
    '2026-09-04_exercices_lot1_traductions.sql',
    '2026-09-04_exercices_lot2_orthographes.sql',
    '2026-09-04_exercices_lot3_fusions.sql',
    '2026-09-06_le_nom_d_exercice_devient_une_reference.sql',
    '2026-09-06_reps_et_charge_par_serie.sql',
    '2026-09-07_bench_rejoint_bench_press.sql',
    '2026-09-07_deadlift_de_competition_et_bareme_borne.sql',
    '2026-09-07_ff_series_tenues.sql',
    '2026-09-07_le_serveur_derive_les_moyennes_par_serie.sql'
]) AS f
ON CONFLICT (fichier) DO NOTHING;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-08_les_migrations_savent_ce_qui_est_applique.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) la table est peuplée, et le compte correspond au dépôt :
--    SELECT count(*) FROM schema_migrations;
--    ( comparer à `ls docs/migrations/*.sql | wc -l` )
--
-- b) ce qui reste à appliquer, sur N'IMPORTE QUELLE base :
--    DATABASE_URL=… uv run python -m scripts.migrer
--    → doit dire « rien à appliquer » sur la production.
