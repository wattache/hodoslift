-- Une douleur se signale depuis la LIGNE de séance où on l'a sentie (William,
-- 27/10). La note du jour porte alors l'exercice : quinze commentaires de
-- douleur sur quarante-et-un le nommaient déjà à la main.
--
-- ⚠️ UN CLICHÉ, ET UN LIEN QUI PEUT S'ÉTEINDRE. La semaine se régénère et sa
-- ligne meurt avec elle ; la douleur, elle, reste. Le cliché (nom, variantes,
-- format, séries, reps, charge) survit, `exercise_id` passe à NULL. Le réalisé
-- vaut quand il est saisi, sinon le prescrit — même règle que le guichet.
--
-- ⚠️ LES EXERCICES S'AJOUTENT, L'INTENSITÉ SE CORRIGE. Une note par jour et par
-- douleur (`douleur_logs`), mais l'épaule peut gêner au muscle up PUIS aux dips
-- dans la même séance : deux lignes ici, une seule note là.
BEGIN;

CREATE TABLE douleur_log_exercices (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    log_id      uuid NOT NULL REFERENCES douleur_logs(id) ON DELETE CASCADE,
    exercise_id uuid REFERENCES training_exercises(id) ON DELETE SET NULL,
    name    text NOT NULL CONSTRAINT douleur_log_exercices_name_non_vide CHECK (btrim(name) <> ''),
    variant text[] NOT NULL DEFAULT '{}',
    tempo   text CONSTRAINT douleur_log_exercices_tempo_non_vide  CHECK (btrim(tempo) <> ''),
    format  text CONSTRAINT douleur_log_exercices_format_non_vide CHECK (btrim(format) <> ''),
    sets    text CONSTRAINT douleur_log_exercices_sets_non_vide   CHECK (btrim(sets) <> ''),
    reps    text CONSTRAINT douleur_log_exercices_reps_non_vide   CHECK (btrim(reps) <> ''),
    weight  text CONSTRAINT douleur_log_exercices_weight_non_vide CHECK (btrim(weight) <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON douleur_log_exercices (log_id);
-- La même ligne signalée deux fois le même jour est UNE fois : le second envoi
-- ne fait rien (`ON CONFLICT DO NOTHING`).
CREATE UNIQUE INDEX douleur_log_exercices_une_ligne_par_note
    ON douleur_log_exercices (log_id, exercise_id) WHERE exercise_id IS NOT NULL;

-- Sans ce GRANT, la table naît invisible à l'application (rôle applicatif).
GRANT SELECT, INSERT, UPDATE, DELETE ON douleur_log_exercices TO brokkr_app;

-- UNE NOTE ET SES EXERCICES, EN UN SEUL ENDROIT. La liste des douleurs,
-- l'histoire d'une douleur et la vue `signalements` lisent la même forme ici :
-- la définir trois fois ferait trois façons de dire « sur quoi ça a fait mal ».
-- Colonnes nommées, jamais `*` : l'étoile se déplie dans l'ordre physique, qui
-- diffère entre la prod et ce fichier.
CREATE VIEW douleur_notes AS
SELECT l.id, l.douleur_id, l.log_date, l.intensite, l.commentaire, l.entrainement,
       l.created_at, l.modifie_le,
       coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                      'exerciseId', e.exercise_id::text, 'name', e.name, 'variant', e.variant,
                      'tempo', e.tempo, 'format', e.format, 'sets', e.sets, 'reps', e.reps,
                      'weight', e.weight, 'ligneVivante', e.exercise_id IS NOT NULL)
                  ORDER BY e.created_at)
             FROM douleur_log_exercices e WHERE e.log_id = l.id), '[]'::jsonb) AS exercices
  FROM douleur_logs l;
GRANT SELECT ON douleur_notes TO brokkr_app;

-- La vue qui porte le signalement au staff dit aussi SUR QUOI ça a fait mal.
CREATE OR REPLACE VIEW signalements AS
SELECT d.athlete_id, l.log_date,
       jsonb_agg(jsonb_build_object(
           'id', d.id::text, 'nom', d.nom, 'zone', d.zone,
           'intensite', l.intensite, 'commentaire', l.commentaire,
           'logs', n.logs, 'recurrente', n.logs > 1,
           'exercices', l.exercices
       ) ORDER BY l.intensite DESC, d.nom) AS douleurs,
       -- Le repère de « noté après coché » : l'upsert rafraîchit `modifie_le`
       -- quand on réécrit la même journée.
       max(l.modifie_le) AS note_le
  FROM douleur_notes l
  JOIN douleurs d ON d.id = l.douleur_id
  JOIN LATERAL (SELECT count(*) AS logs FROM douleur_logs x WHERE x.douleur_id = d.id) n ON true
 GROUP BY d.athlete_id, l.log_date;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-27_une_douleur_reperee_sur_un_exercice.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
