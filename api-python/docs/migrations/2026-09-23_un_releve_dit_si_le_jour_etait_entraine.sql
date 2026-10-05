-- UN RELEVÉ DE DOULEUR DIT SI LE JOUR ÉTAIT ENTRAÎNÉ (FRE-197).
--
-- « Je me souviens que j'ai déjà eu des douleurs même hors training,
-- persistantes » (William, 23/09). Distinguer une douleur qui suit une séance
-- d'une douleur de fond est ce que le kiné cherche en premier — et la base ne
-- sait pas y répondre.
--
-- ⚠️ ON AURAIT PU LE DÉRIVER, ET CE SERAIT FAUX NEUF FOIS SUR ONZE. Mesuré le
-- 23/09 sur les 11 relevés de production : 2 tombent un jour portant des séries
-- réalisées, 9 non. Mais « aucune trace ce jour-là » ne veut pas dire « repos » :
--
--   · William, 18/08 — rien ce jour-là, mais une séance LA VEILLE ;
--   · AnaÏs, 15/09 — dernière séance 25 jours avant ;
--   · Jean-Maxime, 02/09 — aucune séance connue à ±7 jours.
--
-- Une séance peut être saisie plus tard, ou pas du tout. Dériver confondrait
-- « je n'ai pas bougé » et « je n'ai pas encore noté » — la confusion vide/NULL
-- de ce dépôt, appliquée à la seule question qui intéresse l'athlète.
--
-- ⚠️ `boolean` NULLABLE, ET LES TROIS ÉTATS SONT VOULUS :
--     true  → il y a eu entraînement ce jour-là
--     false → journée sans entraînement
--     NULL  → l'athlète ne l'a pas dit
--
-- Une case à cocher n'aurait que deux états et rangerait « pas répondu » avec
-- « repos » : les onze relevés déjà en base deviendraient onze journées de
-- repos que personne n'a déclarées. NULL est la seule valeur honnête pour ce
-- qui n'a pas été demandé.

BEGIN;

ALTER TABLE douleur_logs ADD COLUMN entrainement boolean;

COMMENT ON COLUMN douleur_logs.entrainement IS
  'Déclaré par l''athlète : true = jour entraîné, false = jour sans, NULL = non dit.';

-- ── La vérification de sortie : elle LÈVE, elle n'affiche pas ────────────────
DO $$
DECLARE renseignes int; total int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'douleur_logs' AND column_name = 'entrainement') THEN
    RAISE EXCEPTION 'La colonne `entrainement` n''a pas été créée.';
  END IF;

  -- ⚠️ AUCUN RELEVÉ EXISTANT N'EST RENSEIGNÉ, ET C'EST LE POINT. On ne remplit
  -- pas rétroactivement : personne n'a répondu à une question qu'on ne posait
  -- pas. Ce compte le fige, pour qu'une reprise future ne s'y trompe pas.
  SELECT count(*) INTO renseignes FROM douleur_logs WHERE entrainement IS NOT NULL;
  SELECT count(*) INTO total FROM douleur_logs;
  IF renseignes <> 0 THEN
    RAISE EXCEPTION '% relevé(s) renseignés alors que la colonne vient de naître.', renseignes;
  END IF;
  RAISE NOTICE '% relevés, tous à NULL : la question n''avait pas été posée.', total;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-23_un_releve_dit_si_le_jour_etait_entraine.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
