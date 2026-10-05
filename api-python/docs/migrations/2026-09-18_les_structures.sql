-- LES STRUCTURES : FRENCH FORGE, ET UNE SECONDE — SCAPPULIFT (FRE-13).
--
-- Hodos accueille une deuxième structure de coaching. Nico (Nicolas
-- Routier-Scappucci) y sera COACH, tout en restant ATHLÈTE chez French Forge
-- (coaché par Aubin). William est admin des deux.
--
-- ⚠️ DES COLONNES, PAS DES ADHÉSIONS (décision du 18/09, « modèle A »). Une
-- structure se lit sur ce qui existe déjà : la fiche athlète, la ligne coach, la
-- ligne kiné, la compétition. Nico s'écrit sans rien de neuf — `coaches` le dit
-- SCAPPULIFT, sa fiche athlète le dit French Forge. Une table d'adhésions à
-- rôles serait un RBAC INTERNE à une structure, et aucun cas ne le demande :
-- aucun coach ne coache dans deux structures. L'admin reste global
-- (`users.is_admin`) : c'est l'admin de la plateforme.
--
-- ⚠️ LES LIENS NOMINATIFS NE BOUGENT PAS. « Mes athlètes » (`coach_uid`,
-- `user_uid`), « mes suivis » (`kine_uid`) et l'accès à un programme
-- (`app/authz.py`) cloisonnent déjà par lien ; la structure CHOISIT ce qu'on
-- regarde, elle n'ouvre rien.
--
-- ⚠️ UN DEFAULT 'french-forge', ET C'EST UN ARBITRAGE. Sans lui, les ~150
-- insertions des fixtures de test (40 fichiers) devaient toutes nommer une
-- structure. Les QUATRE chemins d'écriture de l'application la posent
-- explicitement — création d'athlète (celle du coach), promotion coach et kiné
-- (choisie par l'admin), création de compétition (celle du créateur) — et une
-- spec par chemin prouve qu'une écriture SCAPPULIFT ne tombe pas chez French
-- Forge. Le défaut ne sert qu'à ce qui existait avant.
--
-- ⚠️ LE SLUG EST LA CLÉ, et il ne change pas : c'est ce que le front mémorise
-- sur l'appareil pour jouer l'ouverture de la bonne structure AVANT de savoir qui
-- se connecte.

BEGIN;

CREATE TABLE structures (
    slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]+$'),
    nom  text NOT NULL UNIQUE CHECK (btrim(nom) <> '')
);
GRANT SELECT ON structures TO brokkr_app;

INSERT INTO structures (slug, nom) VALUES
  ('french-forge', 'French Forge'),
  ('scappulift',   'SCAPPULIFT');

ALTER TABLE athletes     ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE coaches      ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE kines        ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);
ALTER TABLE competitions ADD COLUMN structure text NOT NULL DEFAULT 'french-forge' REFERENCES structures(slug);

-- Nico COACHE chez SCAPPULIFT. Sa fiche ATHLÈTE (`T7zpStfru2qH5kW7pksq`, coachée
-- par Aubin) reste French Forge.
--
-- ⚠️ LA GARDE VÉRIFIE, AU MOMENT D'APPLIQUER, que ce compte n'a encore RIEN
-- comme coach : ni athlète, ni programme, ni compétition. Ce qu'il aurait créé
-- entre-temps serait rangé chez French Forge par le défaut, sous un coach
-- SCAPPULIFT — la migration s'arrête plutôt que de fabriquer ce mélange.
DO $$
DECLARE n int;
BEGIN
  SELECT (SELECT count(*) FROM athletes     WHERE coach_uid  = 'f1HAcyh0Z9hHje19zNbbWvUp94c2')
       + (SELECT count(*) FROM programs     WHERE coach_uid  = 'f1HAcyh0Z9hHje19zNbbWvUp94c2')
       + (SELECT count(*) FROM competitions WHERE created_by = 'f1HAcyh0Z9hHje19zNbbWvUp94c2')
    INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Nico a déjà % objet(s) comme coach — à ranger avant de le passer SCAPPULIFT.', n;
  END IF;
END $$;

UPDATE coaches SET structure = 'scappulift' WHERE uid = 'f1HAcyh0Z9hHje19zNbbWvUp94c2';

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-18_les_structures.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
