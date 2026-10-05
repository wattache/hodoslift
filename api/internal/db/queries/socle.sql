-- Qui est quoi : la résolution uid → rôles, et nulle part ailleurs.
-- (Colonnes qualifiées partout : sans alias, sqlc croit `uid` ambigu entre
-- les sous-requêtes d'un SELECT sans FROM.)

-- name: EstMembre :one
-- Un lien RÉEL avec l'application : un rôle, ou une fiche athlète. Être
-- authentifié n'est pas être membre — Firebase accepte tout compte Google.
SELECT (EXISTS(SELECT 1 FROM coaches  c WHERE c.uid = @compte)
     OR EXISTS(SELECT 1 FROM kines    k WHERE k.uid = @compte)
     OR EXISTS(SELECT 1 FROM athletes a WHERE a.user_uid = @compte)
     OR EXISTS(SELECT 1 FROM users    u WHERE u.uid = @compte AND u.is_admin))::boolean AS membre;

-- name: EstCoach :one
SELECT EXISTS(SELECT 1 FROM coaches c WHERE c.uid = @compte)::boolean AS coach;

-- name: EstAdmin :one
SELECT COALESCE((SELECT u.is_admin FROM users u WHERE u.uid = @compte), false)::boolean AS admin;

-- name: StructureDuCoach :one
SELECT c.structure FROM coaches c WHERE c.uid = @compte;

-- name: StructuresDe :many
-- Les structures de ce compte, chacune avec ce qu'il y EST. « Kiné » vaut
-- aussi pour qui y SUIT un athlète sans y exercer. L'admin les voit toutes.
SELECT s.slug,
       EXISTS(SELECT 1 FROM coaches c WHERE c.uid = @compte AND c.structure = s.slug)::boolean AS est_coach,
       (EXISTS(SELECT 1 FROM kines k WHERE k.uid = @compte AND k.structure = s.slug)
        OR EXISTS(SELECT 1 FROM athletes a WHERE a.kine_uid = @compte AND a.structure = s.slug))::boolean AS est_kine,
       EXISTS(SELECT 1 FROM athletes a WHERE a.user_uid = @compte AND a.structure = s.slug)::boolean AS est_athlete,
       EXISTS(SELECT 1 FROM users u WHERE u.uid = @compte AND u.is_admin)::boolean AS est_admin
FROM structures s
ORDER BY s.slug <> @premiere::text, s.nom;
