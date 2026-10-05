-- LES COLONNES DU SUIVI KINÉ QUITTENT `daily_logs` (FRE-195).
--
-- La reprise (`…_reprise_du_kine.sql`) a vidé `kine` et `kine_modifie_le` ; le
-- contrat ne les expose plus et l'upsert ne les écrit plus. Elles ne portent
-- plus rien et personne ne les lit.
--
-- ⚠️ CE QU'ON GAGNE À LES RETIRER, et c'est la raison de cette migration plutôt
-- qu'un simple oubli : une colonne vide mais présente reste une SECONDE façon
-- d'écrire une douleur. Il suffit d'un `INSERT` de reprise, d'un script, d'une
-- route rajoutée par distraction — et la donnée atterrit là où aucun écran ne
-- la lit. « Quand une distinction n'est exprimable nulle part, la rendre
-- IMPOSSIBLE vaut mieux que la faire vivre. »
--
-- La contrainte `daily_logs_kine_objet` part avec la colonne : c'est un CHECK
-- de colonne, Postgres le supprime en même temps. Aucune vue, aucun index,
-- aucune clé étrangère ne les mentionne (vérifié en lecture sur la production
-- le 22/09, avant d'écrire ce fichier).
--
-- ⚠️ LE NOM DU FICHIER EST CE QUI L'ORDONNE, et `plus_` trie APRÈS
-- `les_douleurs_suivies_reprise_du_kine`. Nommée « le_journal… », cette
-- migration serait passée AVANT la reprise qu'elle suppose jouée — le piège
-- déjà tombé le même jour avec `les_douleurs_ouvertes…`, placée avant la
-- création des tables qu'elle ouvrait.

BEGIN;

-- ── La garde d'ENTRÉE : on ne perd pas de donnée sans le savoir ──────────────
--
-- ⚠️ ELLE LÈVE, ELLE N'AFFICHE PAS. Rejouée sur une base où la reprise n'aurait
-- pas tourné — une restauration, un bac à sable resté en arrière — ce DROP
-- effacerait des signalements pour de bon. Le coût d'une migration qui refuse
-- de partir est une minute ; celui d'un `DROP COLUMN` sur de la donnée de santé
-- n'a pas de plancher.
DO $$
DECLARE restant int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'daily_logs' AND column_name = 'kine') THEN
    RAISE NOTICE 'Colonnes déjà absentes : rien à faire.';
    RETURN;
  END IF;

  SELECT count(*) INTO restant
    FROM daily_logs WHERE kine IS NOT NULL OR kine_modifie_le IS NOT NULL;
  IF restant > 0 THEN
    RAISE EXCEPTION
      '% ligne(s) portent encore du suivi kiné — jouer la reprise AVANT ce DROP.',
      restant;
  END IF;
END $$;

ALTER TABLE daily_logs
  DROP COLUMN IF EXISTS kine,
  DROP COLUMN IF EXISTS kine_modifie_le;

-- ── La vérification de SORTIE ───────────────────────────────────────────────
DO $$
DECLARE presentes int;
BEGIN
  SELECT count(*) INTO presentes FROM information_schema.columns
   WHERE table_name = 'daily_logs' AND column_name IN ('kine', 'kine_modifie_le');
  IF presentes > 0 THEN
    RAISE EXCEPTION '% colonne(s) du suivi kiné subsistent.', presentes;
  END IF;
  RAISE NOTICE 'daily_logs ne porte plus que des MESURES et la phase du cycle.';
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-22_plus_de_colonnes_kine_dans_le_journal.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
