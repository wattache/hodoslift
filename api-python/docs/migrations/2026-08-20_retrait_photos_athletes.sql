-- Retrait des photos d'athlètes — suppression des colonnes.
--
-- ⚠️ À JOUER APRÈS `scripts/purger_photos_athletes.py --appliquer`, et pas avant.
-- Ce script supprime les colonnes ; le script Python supprime les OBJETS dans le
-- bucket. Dans cet ordre, la liste des chemins à purger est encore lisible. Dans
-- l'autre, on efface l'adresse avant le fichier, et il reste dix photos de
-- visages dans un bucket sans plus rien pour dire à qui elles appartiennent.
--
-- CONTEXTE. La photo d'un athlète était téléversée du navigateur vers Firebase
-- Storage, et son autorisation calculée par des règles qui interrogeaient
-- Firestore — que brokkr entretenait par trois écritures croisées. Dix athlètes
-- sur 58 s'en servaient, et l'image n'était jamais affichée au-dessus de 56
-- pixels. Les initiales, déjà en place pour les 48 autres, font le travail.
--
-- Ce que ce retrait a permis de couper derrière lui : les règles Storage, les
-- trois écritures croisées, le client Firestore de brokkr, et les 44
-- autorisations client de `firestore.rules`.

BEGIN;

ALTER TABLE athletes DROP COLUMN IF EXISTS photo_path;
ALTER TABLE athletes DROP COLUMN IF EXISTS photo_url;

COMMIT;

-- Vérification : plus aucune colonne photo côté athlètes. `coach_profiles`
-- garde la sienne — la photo de profil d'un coach est une AUTRE fonctionnalité,
-- publique, servie par brokkr et sans rapport avec Firestore.
--
--   SELECT table_name, column_name
--   FROM information_schema.columns
--   WHERE column_name LIKE 'photo%'
--   ORDER BY 1, 2;
