-- LE SUIVI KINÉ DEVIENT DES DOULEURS SUIVIES (FRE-195) — reprise des 8 saisies.
--
-- CE QUE CETTE MIGRATION CORRIGE, ET C'EST UN DÉFAUT DE CONCEPTION, pas une
-- dette : la feature a été livrée À CÔTÉ du suivi kiné au lieu de le remplacer.
-- Deux écrans demandaient la même chose — « Quelles douleurs as-tu ? » en texte
-- libre dans le formulaire du jour, et la figure du corps dans l'onglet
-- Douleurs. C'est la règle dupliquée que ce dépôt interdit.
--
-- ⚠️ LE BLOC `kine` NE PORTE QUE DE LA DOULEUR. Ses quatre clés — `intensite`,
-- `douleurs`, `depuis`, `debut` — parlent toutes de ça et de rien d'autre. Ce
-- n'était donc pas un formulaire voisin : c'était le même.
--
-- ⚠️ ET LES 8 SAISIES SONT CONVERTIBLES, contrairement à ce qu'affirmait la
-- migration `…_les_douleurs_suivies.sql` (« rien ne permet de deviner sans
-- inventer »). C'était faux : six se lisent sans hésiter, et les deux autres
-- passent sans côté — le modèle l'accepte. La phrase d'origine et le « depuis »
-- (« 4 ans », « souvent en début de bloc ») partent dans le commentaire du log,
-- donc rien n'est perdu.
--
-- QUI EST CONCERNÉ, mesuré le 22/09 : 7 athlètes, 5 coachs, 2 structures, et
-- 4 signalements DÉJÀ COCHÉS par 3 personnes différentes. Le circuit est vivant,
-- ce n'est pas un essai isolé — d'où le soin porté à ne rien lui faire perdre.

BEGIN;

-- ── 0. « Noté après coché » a besoin d'un horodatage de MODIFICATION ─────────
--
-- ⚠️ `created_at` NE SUFFIT PAS, et c'est le cœur du guichet : corriger sa note
-- doit rappeler le staff qui l'avait déjà lue. Un upsert sur le même jour ne
-- change pas la date de CRÉATION — la file resterait vide alors que l'athlète
-- vient de dire que ça a empiré. C'est le rôle que tenait `kine_modifie_le` sur
-- `daily_logs`, et il se reporte ici.
--
-- `clock_timestamp()` et non `now()` : l'instant réel de l'écriture, pas le
-- début de transaction — sans quoi « modifié après coché » serait indécidable
-- quand les deux tombent dans la même (cf. `app/relecture.py`).
ALTER TABLE douleur_logs
  ADD COLUMN modifie_le timestamptz NOT NULL DEFAULT clock_timestamp();

-- ── 1. Les douleurs, une par signalement distinct ────────────────────────────
--
-- ⚠️ MATHIEU A SIGNALÉ DEUX JOURS DE SUITE, « Gêne pec gauche » puis « Petit pec
-- gauche ». C'est UNE douleur et DEUX logs — exactement ce que le produit ne
-- savait pas dire, et le cas qui justifie la feature. L'unicité par zone
-- vivante les réunit d'elle-même.
CREATE TEMP TABLE reprise (
    phrase     text PRIMARY KEY,
    zone       text NOT NULL,
    nom        text NOT NULL
) ON COMMIT DROP;

INSERT INTO reprise (phrase, zone, nom) VALUES
  ('Épaule droite',                              'deltoids:droite', 'Épaule droite'),
  ('Épaule gauche face antérieur',               'deltoids:gauche', 'Épaule gauche'),
  ('Petit pec gauche',                           'chest:gauche',    'Pec gauche'),
  ('Gêne pec gauche',                            'chest:gauche',    'Pec gauche'),
  ('Genou gauche, blessure fissure au ménisque', 'knees:gauche',    'Genou gauche'),
  ('left elbow close to forearm',                'forearm:gauche',  'Coude gauche'),
  -- ⚠️ SANS CÔTÉ : la phrase ne le dit pas, et on ne l'invente pas. Le modèle
  -- accepte une zone sans latéralité ; l'athlète la précisera s'il le souhaite.
  ('Brachial et brachio radial, dips',           'forearm',         'Avant-bras'),
  ('Douleur sur le coté de la main',             'hands',           'Main');

INSERT INTO douleurs (athlete_id, nom, zone, debut, created_at)
SELECT DISTINCT ON (d.athlete_id, r.zone)
       d.athlete_id, r.nom, r.zone,
       -- `kine->>'debut'` est une vraie date quand elle existe (4 saisies sur 8).
       CASE WHEN d.kine->>'debut' ~ '^\d{4}-\d{2}-\d{2}$'
            THEN (d.kine->>'debut')::date END,
       -- ⚠️ `kine_modifie_le` EST NULL SUR LES SAISIES D'AVANT LE GUICHET : la
       -- colonne date du 12/09, les deux premiers signalements du 18/08 n'en
       -- portent pas. La migration n'écrit pas de fausse histoire — elle prend
       -- l'instant de la reprise quand la date d'origine manque.
       coalesce(min(d.kine_modifie_le) OVER (PARTITION BY d.athlete_id, r.zone), now())
  FROM daily_logs d
  JOIN reprise r ON r.phrase = btrim(d.kine->>'douleurs')
 WHERE d.kine IS NOT NULL
 ORDER BY d.athlete_id, r.zone, d.log_date;

-- ── 2. Les logs, un par jour signalé ─────────────────────────────────────────
INSERT INTO douleur_logs (douleur_id, log_date, intensite, commentaire, created_at)
SELECT dl.id, d.log_date,
       coalesce((d.kine->>'intensite')::int, 0),
       -- ⚠️ LA PHRASE D'ORIGINE EST GARDÉE, et le « depuis » avec : « 4 ans »,
       -- « souvent en début de bloc depuis plusieurs semaines », « aux dips ».
       -- La figure ne capturera jamais ça, et c'est ce que le kiné lit.
       nullif(btrim(concat_ws(' · ',
              nullif(btrim(d.kine->>'douleurs'), ''),
              nullif(btrim(d.kine->>'depuis'), ''))), ''),
       coalesce(d.kine_modifie_le, now())
  FROM daily_logs d
  JOIN reprise r ON r.phrase = btrim(d.kine->>'douleurs')
  JOIN douleurs dl ON dl.athlete_id = d.athlete_id AND dl.zone = r.zone
 WHERE d.kine IS NOT NULL
ON CONFLICT (douleur_id, log_date) DO NOTHING;

-- ── 3. La coche du guichet se détache de `daily_logs` ────────────────────────
--
-- ⚠️ SA CLÉ ÉTRANGÈRE POINTAIT SUR LE JOURNAL QUOTIDIEN, où le signalement
-- vivait. Il vit désormais dans `douleur_logs`, et 5 des 8 jours concernés
-- n'ont AUCUNE autre donnée — ni poids, ni sommeil : leur ligne de journal
-- disparaît plus bas, et la coche partirait avec elle.
--
-- La coche reste ce qu'elle est — « j'ai vu ce que cet athlète a signalé ce
-- jour-là » — et se rattache donc à l'ATHLÈTE. Elle survit à l'effacement du
-- signalement, ce qui est juste : on l'a bien lu.
ALTER TABLE signalement_vu DROP CONSTRAINT signalement_vu_athlete_id_log_date_fkey;
ALTER TABLE signalement_vu ADD CONSTRAINT signalement_vu_athlete_id_fkey
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;

-- ── 4. Le bloc `kine` s'efface, son contenu est ailleurs ─────────────────────
UPDATE daily_logs SET kine = NULL, kine_modifie_le = NULL WHERE kine IS NOT NULL;

-- ⚠️ ET LES LIGNES DEVENUES VIDES S'EN VONT. Une journée qui ne portait qu'un
-- signalement n'a plus rien à dire : la garder ferait une ligne de journal sans
-- aucune mesure, que le tracker compterait comme un jour renseigné.
DELETE FROM daily_logs
 WHERE weight_kg IS NULL AND sleep_hours IS NULL AND water_liters IS NULL
   AND calories IS NULL AND kine IS NULL AND cycle_phase IS NULL;

-- ── La vérification de sortie : elle LÈVE, elle n'affiche pas ────────────────
DO $$
DECLARE reste int; douleurs_creees int; logs_crees int;
BEGIN
  SELECT count(*) INTO reste FROM daily_logs WHERE kine IS NOT NULL;
  IF reste > 0 THEN
    RAISE EXCEPTION '% suivi(s) kiné non repris — migration annulée.', reste;
  END IF;

  SELECT count(*) INTO douleurs_creees FROM douleurs;
  SELECT count(*) INTO logs_crees FROM douleur_logs;
  -- 7 douleurs pour 8 saisies : les deux de Mathieu se réunissent.
  IF douleurs_creees < 7 OR logs_crees < 8 THEN
    RAISE EXCEPTION 'Reprise incomplète : % douleur(s), % log(s) — attendu au moins 7 et 8.',
                    douleurs_creees, logs_crees;
  END IF;
  RAISE NOTICE 'Reprise : % douleurs, % logs.', douleurs_creees, logs_crees;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-22_les_douleurs_suivies_reprise_du_kine.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
