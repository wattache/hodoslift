-- UN ADMIN OUVRE UN ACCÈS SUPPORT À UN ATHLÈTE (FRE-202).
--
-- Le support aux coachs et au kiné passait par un geste qui n'existe plus : se
-- mettre coach de l'athlète. Depuis les structures (FRE-13), un coach n'a
-- qu'une structure, et une fiche ne se rattache pas à un coach d'une autre.
--
-- Un accès support est un LIEN, pas un rôle : un admin, un athlète, une fin.
-- Tant qu'il court, l'admin a sur CET athlète les droits de son coach et de son
-- kiné (`authz`). Il expire seul, et la ligne reste : c'est la trace de qui a
-- ouvert quelle fiche, et quand.
--
-- ⚠️ PAS « assistances » : la bibliothèque a déjà une catégorie de ce nom, les
-- élastiques (RB20, RB25…), et l'écran de séance une colonne « Assistance ».

BEGIN;

CREATE TABLE acces_support (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    uid        text NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    debut      timestamptz NOT NULL DEFAULT now(),
    fin        timestamptz NOT NULL,
    CONSTRAINT acces_support_fin_apres_debut CHECK (fin > debut)
);
CREATE INDEX ON acces_support (uid, athlete_id, fin);

GRANT SELECT, INSERT, UPDATE, DELETE ON acces_support TO brokkr_app;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-24_un_admin_ouvre_un_acces_support.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
