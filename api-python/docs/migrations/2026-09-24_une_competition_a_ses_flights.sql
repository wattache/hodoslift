-- UNE COMPÉTITION A SES FLIGHTS, UN FLIGHT SES CATÉGORIES (FRE-204).
--
-- Un flight (« groupe » sur les affiches françaises) réunit des catégories de
-- poids ; un athlète passe dans le flight de sa catégorie. Le groupe saisi par
-- participant disparaît : aucun n'a été saisi.
--
-- Une catégorie appartient à UN flight par compétition : la clé primaire de
-- `competition_flight_categories` le garantit, avec `competition_id` recopié
-- et tenu cohérent par la FK composite vers le flight.

BEGIN;

CREATE TABLE competition_flights (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    name           text NOT NULL CONSTRAINT competition_flights_nom_non_vide CHECK (btrim(name) <> ''),
    position       integer NOT NULL,
    UNIQUE (competition_id, name),
    UNIQUE (competition_id, position),
    UNIQUE (id, competition_id)
);

CREATE TABLE competition_flight_categories (
    competition_id  uuid NOT NULL,
    flight_id       uuid NOT NULL,
    gender          gender NOT NULL,
    weight_category text NOT NULL,
    PRIMARY KEY (competition_id, gender, weight_category),
    FOREIGN KEY (flight_id, competition_id) REFERENCES competition_flights(id, competition_id) ON DELETE CASCADE,
    FOREIGN KEY (gender, weight_category) REFERENCES weight_categories(gender, code)
);
CREATE INDEX ON competition_flight_categories (flight_id);

ALTER TABLE competition_participants DROP COLUMN groupe;

GRANT SELECT, INSERT, UPDATE, DELETE ON competition_flights, competition_flight_categories TO brokkr_app;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-24_une_competition_a_ses_flights.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
