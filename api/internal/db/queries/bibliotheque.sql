-- La bibliothèque : `library_entries`, une par structure, unique par
-- (structure, category, name).

-- name: BibliothequeDe :many
SELECT id, category, name, competition, supports
FROM library_entries
WHERE structure = @dans
ORDER BY category, name;

-- name: CreerEntree :one
-- Insert atomique : conflit (structure, category, name) → aucune ligne.
INSERT INTO library_entries (structure, category, name, competition, supports, created_by)
VALUES (@dans, @categorie, @nom, @competition, @supports, @created_by)
ON CONFLICT (structure, category, name) DO NOTHING
RETURNING id;

-- name: EntreeParId :one
SELECT structure, category, name, competition, supports
FROM library_entries
WHERE id = @id;

-- name: NomDejaPris :one
SELECT EXISTS(
  SELECT 1 FROM library_entries e
  WHERE structure = @dans AND category = @categorie AND name = @nom AND id <> @id
)::boolean AS pris;

-- name: RenommerEntree :exec
UPDATE library_entries SET name = @nom WHERE id = @id;

-- name: MarquerCompetition :exec
UPDATE library_entries SET competition = @competition WHERE id = @id;

-- name: DefinirSupports :exec
-- ⚠️ Le VIDE n'existe pas en base (`library_entries_supports`) : l'appelant
-- passe NULL pour « ne soutient rien ».
UPDATE library_entries SET supports = @supports WHERE id = @id;
