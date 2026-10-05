-- Migration : athlete_prs — passage à l'identité « tuple complet » + id de surface.
--
-- CONTEXTE. La table live porte encore le modèle appauvri de la 1re passe :
--   PRIMARY KEY (athlete_id, movement, reps)
-- ce qui interdit à tort deux records même mouvement/reps mais contexte différent
-- (« 4 reps à 60 » vs « 4x4 à 60 »). On bascule sur l'identité RÉELLE d'un PR — le
-- tuple complet (athlete_id, movement, sets, reps, variant, format) — et on ajoute
-- un id uuid de surface (l'API adresse/supprime un PR par cet id).
--
-- SÛRETÉ DONNÉE (vérifié sur les 159 lignes en base au 2026-07-31) :
--   * sets / format / variant / performed_on = NULL à 100 % → aucun doublon créé
--     par la nouvelle contrainte (l'ancienne PK garantissait déjà l'unicité sur le
--     sous-ensemble (athlete_id, movement, reps) — un sur-ensemble reste unique).
--   * tous les mouvements sont déjà des lifts de compétition → la règle applicative
--     competition=true ne rejette aucune donnée existante.
--   * aucune FK ne référence athlete_prs → on peut dropper l'ancienne PK sans risque.
--
-- Transactionnel : tout ou rien. gen_random_uuid() est natif en PG13+ (Neon PG16).

BEGIN;

-- 1. id de surface : DEFAULT volatile → chaque ligne existante reçoit son propre uuid.
ALTER TABLE athlete_prs
    ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();

-- 2. Bascule de la clé primaire (athlete_id, movement, reps) → id.
ALTER TABLE athlete_prs DROP CONSTRAINT athlete_prs_pkey;
ALTER TABLE athlete_prs ADD  CONSTRAINT athlete_prs_pkey PRIMARY KEY (id);

-- 3. Clé naturelle = identité métier. NULLS NOT DISTINCT (PG15+) : deux PR à sets
--    NULL collisionnent (indispensable : la donnée réelle a sets/variant/format vides).
ALTER TABLE athlete_prs
    ADD CONSTRAINT athlete_prs_identity_key
    UNIQUE NULLS NOT DISTINCT (athlete_id, movement, sets, reps, variant, format);

COMMIT;
