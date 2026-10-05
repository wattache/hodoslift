-- LE DELTOÏDE SE LIT EN DEUX FAISCEAUX (FRE-195).
--
-- La planche dessine l'épaule dans les DEUX vues : de face on voit le deltoïde
-- antérieur, de dos le postérieur. Le tracé est unique de chaque côté, mais il
-- ne montre pas le même muscle selon qu'on regarde devant ou derrière — la vue
-- suffit donc à les distinguer, et c'est le seul endroit du vocabulaire où
-- elle porte l'information.
--
-- ⚠️ LE DELTOÏDE MOYEN RESTE INDISTINGUABLE : la planche ne le dessine pas à
-- part, il est pris dans les deux autres. On ne le nomme donc pas.
--
-- LES TROIS DOULEURS EXISTANTES SONT ANTÉRIEURES, ET CHACUNE POUR UNE RAISON :
--
--   · Jean-Maxime l'a ÉCRIT en août — « Épaule gauche face antérieur » ;
--   · William l'a dit le 23/09 en relisant sa fiche ;
--   · Laura l'a confirmé le 23/09 par William.
--
-- ⚠️ AUCUNE N'EST DEVINÉE. C'est la règle qui a laissé le coude de David, la
-- main de Lionel et la tendinite d'Aghiles sur l'ancien vocabulaire : on ne
-- choisit pas un muscle à la place d'un athlète.

BEGIN;

-- ⚠️ LE GARDE D'ENTRÉE COMPTE AVANT D'ÉCRIRE, et il a déjà servi : le 22/09,
-- une migration de ce lot a levé parce qu'un athlète avait déclaré une douleur
-- pendant qu'on l'écrivait. La production VIT. Trois épaules sont confirmées ;
-- une quatrième voudrait dire qu'on s'apprête à renommer le muscle de
-- quelqu'un qui n'a rien demandé.
DO $$
DECLARE combien int;
BEGIN
  SELECT count(*) INTO combien FROM douleurs WHERE zone LIKE 'deltoids:%';
  IF combien <> 3 THEN
    RAISE EXCEPTION
      '% épaule(s) sur l''ancien code, 3 attendues et confirmées — une de plus a été déclarée depuis.',
      combien;
  END IF;
END $$;

UPDATE douleurs
   SET zone = replace(zone, 'deltoids:', 'deltoid-anterior:')
 WHERE zone LIKE 'deltoids:%';

-- ── La vérification de sortie : elle LÈVE, elle n'affiche pas ────────────────
DO $$
DECLARE migrees int; restantes int;
BEGIN
  SELECT count(*) INTO migrees FROM douleurs WHERE zone LIKE 'deltoid-anterior:%';
  IF migrees <> 3 THEN
    RAISE EXCEPTION 'Attendu 3 épaules sur le deltoïde antérieur, trouvé %.', migrees;
  END IF;

  SELECT count(*) INTO restantes FROM douleurs WHERE zone LIKE 'deltoids%';
  IF restantes <> 0 THEN
    RAISE EXCEPTION '% épaule(s) restent sur l''ancien code.', restantes;
  END IF;
  RAISE NOTICE '3 épaules passées sur le deltoïde antérieur.';
END $$;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-23_le_deltoide_a_deux_faces.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
