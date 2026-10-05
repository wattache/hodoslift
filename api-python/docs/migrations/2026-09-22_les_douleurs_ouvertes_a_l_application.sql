-- OUVRIR LES DEUX TABLES DE DOULEURS À L'APPLICATION (FRE-195).
--
-- CE QUI S'EST PASSÉ. `…_les_douleurs_suivies.sql` a créé `douleurs` et
-- `douleur_logs` sans leur `GRANT`. Le service se connecte en `brokkr_app`, un
-- rôle qui ne possède rien : les deux tables existent et lui sont FERMÉES.
-- Mesuré en production le 22/09 — aucun privilège, là où `daily_logs` en porte
-- quatre.
--
-- Rien n'est perdu : les tables sont vides, et le seul effet est qu'aucune route
-- de douleur ne peut encore répondre. Le garde qui l'a trouvé est
-- `test_une_migration_qui_CREE_une_table_pose_son_GRANT` — il lit les fichiers
-- de migration et exige, pour chaque table créée, son `GRANT` dans le même
-- fichier.
--
-- ⚠️ POURQUOI UN FICHIER DE PLUS PLUTÔT QUE DE CORRIGER LE PREMIER. La première
-- est déjà enregistrée dans `schema_migrations` : la corriger ne la rejouerait
-- pas, et la production resterait fermée. Le `GRANT` a donc été ajouté aux DEUX
-- endroits — dans la migration d'origine, pour que toute base NEUVE (tests, bac
-- à sable) naisse correcte, et ici, pour rattraper celles qui l'ont déjà jouée.
--
-- ⚠️ ET DANS `nidavellir/sql/brokkr_app.sql` AUSSI, qui est la liste de
-- référence du rôle : une base restaurée d'un dump repart de là.
--
-- ⚠️ CONDITIONNELLE, PARCE QUE L'ORDRE LA MET AVANT LA CRÉATION. Les migrations
-- se jouent dans l'ordre du NOM, et « ouvertes » précède « suivies » : sur une
-- base NEUVE, ce fichier passe avant que les tables existent. Il ne doit donc
-- rien exiger — la migration d'origine porte désormais ses propres `GRANT`, et
-- une base neuve n'a rien à rattraper. Ce fichier ne sert qu'aux bases qui ont
-- joué la PREMIÈRE version, sans les droits.

BEGIN;

DO $$
DECLARE presentes int; manquants int;
BEGIN
  SELECT count(*) INTO presentes FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name IN ('douleurs', 'douleur_logs');

  IF presentes = 0 THEN
    RAISE NOTICE 'Tables de douleurs absentes : base neuve, rien à rattraper.';
    RETURN;
  END IF;

  GRANT SELECT, INSERT, UPDATE, DELETE ON douleurs TO brokkr_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON douleur_logs TO brokkr_app;

  -- ⚠️ ELLE LÈVE, ELLE N'AFFICHE PAS. Un `GRANT` qui ne prend pas laisserait
  -- les routes en échec à la première écriture, et le message parlerait de
  -- permission au milieu d'un geste d'athlète — pas au moment de la migration.
  SELECT count(*) INTO manquants
    FROM (VALUES ('douleurs'), ('douleur_logs')) AS t(nom),
         (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(droit)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.role_table_grants g
      WHERE g.grantee = 'brokkr_app' AND g.table_name = t.nom
        AND g.privilege_type = p.droit);
  IF manquants > 0 THEN
    RAISE EXCEPTION '% privilège(s) manquant(s) pour brokkr_app — migration annulée.', manquants;
  END IF;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-22_les_douleurs_ouvertes_a_l_application.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
