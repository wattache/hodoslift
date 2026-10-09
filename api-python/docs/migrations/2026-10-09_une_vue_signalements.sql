-- UN SIGNALEMENT EST UN ATHLÈTE ET UN JOUR, PAS UNE DOULEUR (FRE-195), et il
-- s'agrégeait trois fois à l'identique : le tableau des signalements, la file
-- du guichet, la coche. La règle `recurrente = logs > 1` vivait dans chacune.
-- Ici, une fois (FRE-218).
--
-- ⚠️ `recurrente` compte TOUT l'historique de la douleur, pas la fenêtre lue :
-- une épaule notée en janvier et en juin est récurrente en juin.

BEGIN;

CREATE VIEW signalements AS
SELECT d.athlete_id, l.log_date,
       jsonb_agg(jsonb_build_object(
           'id', d.id::text, 'nom', d.nom, 'zone', d.zone,
           'intensite', l.intensite, 'commentaire', l.commentaire,
           'logs', n.logs, 'recurrente', n.logs > 1
       ) ORDER BY l.intensite DESC, d.nom) AS douleurs,
       -- Le repère de « noté après coché » : l'upsert rafraîchit `modifie_le`
       -- quand on réécrit la même journée.
       max(l.modifie_le) AS note_le
  FROM douleur_logs l
  JOIN douleurs d ON d.id = l.douleur_id
  JOIN LATERAL (SELECT count(*) AS logs FROM douleur_logs x WHERE x.douleur_id = d.id) n ON true
 GROUP BY d.athlete_id, l.log_date;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-09_une_vue_signalements.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
