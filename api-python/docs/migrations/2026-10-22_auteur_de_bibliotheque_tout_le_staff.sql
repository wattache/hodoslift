-- L'auteur d'une entrée de bibliothèque est un UTILISATEUR, plus seulement un
-- coach : le kiné de la structure y écrit aussi (FRE-247). Une trace d'auteur,
-- jamais lue pour autoriser : elle se vide quand le compte part.
BEGIN;

ALTER TABLE library_entries DROP CONSTRAINT library_entries_created_by_fkey;
ALTER TABLE library_entries
  ADD CONSTRAINT library_entries_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(uid) ON DELETE SET NULL;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-22_auteur_de_bibliotheque_tout_le_staff.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
