-- Un essai RÉUSSI porte sa charge (Euros 2026 : sept reps jugés sans annonce,
-- écrits à 0 kg, absents du score — Aubin à 264 au lieu de 544).
--
-- La réparation pose la charge du R du plan, celle que la case montrait au
-- coach quand il a jugé, et l'annonce en R. Puis la contrainte rend le défaut
-- impossible. Un no rep sans charge reste admis : il ne compte pas.
BEGIN;

UPDATE competition_attempts
   SET weight_kg = weight_realistic, selected_tier = 'realistic'
 WHERE result = 'rep' AND NOT coalesce(weight_kg, 0) > 0 AND weight_realistic > 0;

ALTER TABLE competition_attempts
  ADD CONSTRAINT rep_porte_sa_charge CHECK (result IS DISTINCT FROM 'rep' OR weight_kg > 0);

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-10_un_rep_porte_sa_charge.sql')
ON CONFLICT (fichier) DO NOTHING;
COMMIT;
