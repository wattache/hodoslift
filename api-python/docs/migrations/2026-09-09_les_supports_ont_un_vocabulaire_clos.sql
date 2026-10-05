-- LES SUPPORTS ONT UN VOCABULAIRE CLOS, ET LA BASE LE DIT (FRE-140).
--
-- `library_entries.supports` n'accepte que {MU, PU, DIP, SQ} — les quatre
-- groupes principaux qu'un renforcement peut soutenir. C'était vrai dans le
-- contrat Pydantic seulement, et de la pire façon : il ÉCARTAIT en silence un
-- groupe inconnu et répondait 200. Le client croyait avoir enregistré deux
-- groupes, la base en avait un.
--
-- ⚠️ SEUL VOCABULAIRE CLOS DU PROJET À TRONQUER. Tous les autres — `kind`,
--    `reps_unit`, `group_kind`, `increment_unit`, `event_type` — refusent, et
--    portent leur CHECK. Celui-ci n'avait ni l'un ni l'autre.
--
-- ⚠️ LA REPRISE EST VIDE, ET C'EST MESURÉ : 29 entrées portent des supports en
--    production, et leurs valeurs sont {MU: 10, PU: 7, DIP: 10, SQ: 8}. Aucune
--    hors vocabulaire — la contrainte se pose sans rien reprendre.
--
-- ⚠️ `<@` ET PAS UNE ÉNUMÉRATION DE `ANY` : c'est l'inclusion de tableaux, donc
--    « tous les éléments de `supports` sont dans cette liste ». Un tableau VIDE
--    est inclus dans n'importe quoi, donc accepté — et c'est voulu, `[]` veut
--    dire « renseigné, aucun groupe », ce que 0 entrée porte aujourd'hui mais
--    que le contrat permet.

BEGIN;

ALTER TABLE library_entries
  ADD CONSTRAINT library_entries_supports CHECK (
      supports IS NULL OR supports <@ ARRAY['MU', 'PU', 'DIP', 'SQ']::text[]);

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-09_les_supports_ont_un_vocabulaire_clos.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;


-- VÉRIFICATION, après le COMMIT :
--
--   make schema-verifier   → le fichier de référence décrit bien la base,
--                            contraintes comprises (depuis FRE-133).
