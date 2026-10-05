-- LE GUICHET DU COACH — la file de travail qui se vide (brief du 12/09).
--
-- L'écran d'accueil du coach sert UN dossier à la fois et le clôt d'un geste.
-- Trois notions manquaient à la base pour que ce geste existe, et aucune ne se
-- déduit de ce qui est déjà là :
--
--   1. LA MARQUE DE RELECTURE — le coach coche qu'il a vu une séance. C'est une
--      décision, pas une déduction depuis l'ouverture d'une page. Deux colonnes
--      sur `training_sessions` et non une table : une séance appartient à un
--      programme, donc à UN coach. Le jour où deux personnes relisent la même
--      séance, ça devient une table — et c'est exactement le cas du signalement
--      (point 3), qui montre la forme à suivre.
--
--   2. L'HORODATAGE DE MODIFICATION — sans lui, « une séance re-modifiée par
--      l'athlète redevient non lue » est impossible à dire : il faut comparer
--      « relue à » et « modifiée à », et la seconde n'existait pas.
--
--      ⚠️ PAS `source_updated_at`. Il existe sur macros, blocs et semaines, mais
--      c'est un reste de l'ETL Firestore coupé le 20/08 : AUCUNE écriture ne le
--      met à jour. S'en servir donnerait un vérificateur vert pour la mauvaise
--      raison — ce que ce dépôt considère comme pire que pas de vérificateur.
--
--      ⚠️ `modifiee_par` N'EST PAS DÉCORATIF. Sans lui, un coach qui réordonne
--      les lignes d'une séance qu'il vient de relire la fait redevenir non lue
--      par son propre geste. La règle d'inclusion dans la file compare les deux
--      uid avec `IS DISTINCT FROM` : `modifiee_par` est NULL sur tout
--      l'historique, et `NULL <> 'uid'` vaut NULL — la séance ne reviendrait
--      jamais.
--
--      ⚠️ ET LA MIGRATION N'ÉCRIT PAS DE FAUSSE HISTOIRE : les séances
--      existantes gardent `modifiee_le = NULL`. Un `DEFAULT now()` rétroactif
--      affirmerait qu'elles ont toutes bougé aujourd'hui.
--
--   3. LA COCHE DU SIGNALEMENT, PAR LECTEUR. Le kiné et le coach voient le MÊME
--      signalement (`_SIGNALEMENTS_SQL` filtre sur `kine_uid = uid OR coach_uid
--      = uid`). Une colonne unique sur `daily_logs` laisserait l'un le faire
--      disparaître de la file de l'autre. Donc une table, clé (athlète, jour,
--      QUI a coché). Mesuré le 12/09 : 2 des 4 signalements de production ont
--      deux lecteurs distincts, et un troisième a un coach qui est aussi le kiné.
--
--      `kine_modifie_le` porte sur l'OBJET `kine`, pas sur la ligne :
--      `daily_logs` transporte aussi le poids, le sommeil, l'eau. Branché sur
--      la ligne, une pesée du matin décocherait la douleur de la veille.
--
-- ET UNE FONCTION, `ff_tonnage` : la définition du tonnage vivait en ligne dans
-- l'ETL de `training_sets`, table reconstruite à 03:30 — une séance finie
-- aujourd'hui n'y est pas, et c'est précisément celle que la file doit servir.
-- La lecture vivante doit donc calculer, et calculer PAREIL : la formule
-- déménage dans une fonction que l'ETL appelle aussi. Même geste que
-- `ff_series_tenues` le 07/09 — deux appelants, une définition.
--
-- ⚠️ AUCUNE LIGNE EXISTANTE N'EST MODIFIÉE : quatre colonnes nullables, une
-- table vide, une fonction. Le rattrapage par `UPDATE` massif qui poserait
-- `relue_le` sur l'existant est REFUSÉ — il affirmerait que William a relu
-- 2 473 séances, ce qui est faux, et la colonne porterait ce mensonge pour
-- toujours. La borne de mise en service vit dans le code (`app/relecture.py`).

BEGIN;

ALTER TABLE training_sessions
    ADD COLUMN relue_le     timestamptz,
    ADD COLUMN relue_par    text REFERENCES users(uid) ON DELETE SET NULL,
    ADD COLUMN modifiee_le  timestamptz,
    ADD COLUMN modifiee_par text REFERENCES users(uid) ON DELETE SET NULL;

ALTER TABLE daily_logs
    ADD COLUMN kine_modifie_le timestamptz;

CREATE TABLE signalement_vu (
    athlete_id uuid NOT NULL,
    log_date   date NOT NULL,
    uid        text NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    vu_le      timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (athlete_id, log_date, uid),
    FOREIGN KEY (athlete_id, log_date)
        REFERENCES daily_logs (athlete_id, log_date) ON DELETE CASCADE
);

-- ⚠️ SANS CE GRANT, LA TABLE NAÎT INVISIBLE À L'APPLICATION : brokkr écrit sous
-- le rôle `brokkr_app`, pas sous le propriétaire. `test_migrer.py` l'exige pour
-- chaque table créée, et la liste de référence est `nidavellir/sql/brokkr_app.sql`.
GRANT SELECT, INSERT, UPDATE, DELETE ON signalement_vu TO brokkr_app;

CREATE OR REPLACE FUNCTION ff_tonnage(
    sets text, reps text, reps_done text, reps_unit text,
    weight text, weight_done text,
    felt_rpe_by_set text[], reps_done_by_set text[], weight_done_by_set text[]
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
        WHEN reps_unit IS DISTINCT FROM 'sec' AND t.tenues IS NOT NULL
        THEN CASE WHEN t.tenues = 0 THEN 0
                  ELSE (SELECT sum(coalesce(t.rbs[i], coalesce(t.rd, t.r))
                                 * coalesce(t.wbs[i], coalesce(t.wd, t.w)))
                          FROM generate_series(1, t.tenues) AS i)
             END
    END
    FROM (SELECT ff_series_tenues(sets, felt_rpe_by_set)  AS tenues,
                 ff_reps_by_set(reps_done_by_set)          AS rbs,
                 ff_charge_by_set(weight_done_by_set)      AS wbs,
                 ff_num(reps_done)                         AS rd,
                 ff_reps_low(reps)                         AS r,
                 ff_charge(weight_done)                    AS wd,
                 ff_charge(weight)                         AS w) t
$$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-12_le_guichet_du_coach.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION :
--   SELECT count(*) FROM training_sessions WHERE relue_le IS NOT NULL
--       OR modifiee_le IS NOT NULL;                        -- attendu : 0
--   SELECT count(*) FROM signalement_vu;                   -- attendu : 0
--   SELECT ff_tonnage('3','8',NULL,'count','60',NULL,NULL,NULL,NULL);  -- 1440
