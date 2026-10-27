-- Une douleur porte PLUSIEURS zones, et une zone peut appartenir à plusieurs
-- douleurs (FRE-196). « Épaule + biceps » est une seule douleur ; un claquage du
-- biceps trois mois plus tard en est une autre, sur une zone déjà prise.
--
-- ⚠️ DESTRUCTIVE : `douleurs.zone` disparaît. Le brokkr d'avant la lit : jouer
-- cette migration puis `make livrer` dans la foulée.
BEGIN;

-- ⚠️ UNE TABLE, PAS UN `text[]` : un tableau vide se confond avec l'absence
-- (`if supports:`), et une douleur sans zone serait invisible sur la figure sans
-- être close. Le serveur refuse la dernière zone retirée ; `make invariants`
-- le vérifie (`douleur_sans_zone`).
CREATE TABLE douleur_zones (
    douleur_id uuid NOT NULL REFERENCES douleurs(id) ON DELETE CASCADE,
    zone text NOT NULL CONSTRAINT douleur_zones_zone_non_vide CHECK (btrim(zone) <> ''),
    PRIMARY KEY (douleur_id, zone)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON douleur_zones TO brokkr_app;

INSERT INTO douleur_zones (douleur_id, zone) SELECT id, zone FROM douleurs;

-- Deux douleurs vivantes peuvent partager une zone.
DROP INDEX douleurs_une_vivante_par_zone;

CREATE OR REPLACE VIEW signalements AS
SELECT d.athlete_id, l.log_date,
       jsonb_agg(jsonb_build_object(
           'id', d.id::text, 'nom', d.nom, 'zones', z.zones,
           'intensite', l.intensite, 'commentaire', l.commentaire,
           'logs', n.logs, 'recurrente', n.logs > 1,
           'exercices', l.exercices
       ) ORDER BY l.intensite DESC, d.nom) AS douleurs,
       max(l.modifie_le) AS note_le
  FROM douleur_notes l
  JOIN douleurs d ON d.id = l.douleur_id
  JOIN LATERAL (SELECT count(*) AS logs FROM douleur_logs x WHERE x.douleur_id = d.id) n ON true
  JOIN LATERAL (SELECT coalesce(jsonb_agg(dz.zone ORDER BY dz.zone), '[]'::jsonb) AS zones
                  FROM douleur_zones dz WHERE dz.douleur_id = d.id) z ON true
 GROUP BY d.athlete_id, l.log_date;

ALTER TABLE douleurs DROP COLUMN zone;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-27_une_douleur_porte_plusieurs_zones.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
