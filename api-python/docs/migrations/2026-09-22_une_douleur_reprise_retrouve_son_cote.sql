-- UNE DOULEUR REPRISE RETROUVE SON CÔTÉ (FRE-195).
--
-- ⚠️ CE QUE LA REPRISE A CRÉÉ ET QUE LE PRODUIT NE SAIT PAS RENDRE. Deux des
-- huit douleurs reprises portent une zone SANS côté — `forearm` et `hands` —
-- parce que la phrase d'origine ne le disait pas. Or la planche anatomique n'a
-- de tracé sans côté que pour la nuque : ces deux codes ne s'allument nulle
-- part, et la figure ne peut pas non plus les produire. C'était une distinction
-- qui n'existait qu'en base.
--
-- ⚠️ DEUX LIGNES : ON CORRIGE, ON NE DÉVELOPPE PAS. Faire rendre « côté non
-- précisé » à la figure était l'autre issue ; pour deux lignes elle coûte une
-- feature et une route d'écriture de plus. L'échelle du dépôt dit de compter
-- avant de ménager.
--
-- LE CÔTÉ VIENT DE L'ATHLÈTE, PAS D'UNE DÉDUCTION. William a répondu « droite »
-- pour son avant-bras. Celle de Lionel (« Douleur sur le coté de la main »)
-- reste SANS CÔTÉ : il ne l'a pas dite, et on ne l'invente pas — elle se
-- corrigera quand il l'aura précisé.

BEGIN;

-- ⚠️ `zone = 'forearm'` SUFFIT À DÉSIGNER LA BONNE LIGNE, et c'est plus sûr
-- qu'un détour par le nom de l'athlète : une seule douleur porte ce code (les
-- autres avant-bras sont latéralisés, `forearm:gauche` pour David).
UPDATE douleurs SET zone = 'forearm:droite' WHERE zone = 'forearm';

-- ── La vérification de sortie : elle LÈVE, elle n'affiche pas ────────────────
DO $$
DECLARE sans_cote int; droite int;
BEGIN
  SELECT count(*) INTO droite FROM douleurs WHERE zone = 'forearm:droite';
  IF droite < 1 THEN
    RAISE EXCEPTION 'L''avant-bras n''a pas reçu son côté — migration annulée.';
  END IF;

  -- ⚠️ IL EN RESTE UNE, ET C'EST VOULU. Voir la main de Lionel, ci-dessus. Ce
  -- compte est là pour qu'une reprise future ne la perde pas de vue.
  SELECT count(*) INTO sans_cote FROM douleurs WHERE position(':' in zone) = 0;
  RAISE NOTICE 'Douleurs encore sans côté : % (attendu : la main de Lionel).', sans_cote;
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-22_une_douleur_reprise_retrouve_son_cote.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
