-- LE COMPTE ET SES RÔLES, EN UNE LIGNE (FRE-220). `users` ne porte que
-- l'identité et `is_admin` ; être coach, kiné ou athlète, c'est une ligne dans
-- `coaches`, `kines` ou `athletes`. Le profil, l'annuaire et les gardes
-- lisaient chacun ces quatre tables à leur manière — deux projections
-- identiques, quatre requêtes d'un booléen chacune, enchaînées deux ou trois
-- fois par route. Une seule lecture, ici.

BEGIN;

CREATE VIEW comptes AS
SELECT u.uid, u.email, u.display_name, u.is_admin, u.preferences,
       c.uid IS NOT NULL AS est_coach,
       c.structure       AS coach_structure,
       k.uid IS NOT NULL AS est_kine,
       k.structure       AS kine_structure,
       -- `athletes.user_uid` est UNIQUE : au plus une fiche, pas de LIMIT 1.
       a.legacy_id       AS athlete_id,
       (SELECT array_agg(DISTINCT x.structure ORDER BY x.structure)
          FROM athletes x WHERE x.user_uid = u.uid) AS athlete_structures
FROM users u
LEFT JOIN coaches  c ON c.uid = u.uid
LEFT JOIN kines    k ON k.uid = u.uid
LEFT JOIN athletes a ON a.user_uid = u.uid;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-09_une_vue_comptes.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
