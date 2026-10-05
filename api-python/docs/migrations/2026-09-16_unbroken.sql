-- UNBROKEN : « SANS LÂCHER LA BARRE » ENTRE DEUX LIGNES D'UN GROUPE (FRE-116).
--
-- Un circuit MUSCLE UP → PULL UP → DIPS BAR → SQUAT → PUSH UPS peut vouloir que
-- les trois premiers s'enchaînent sans lâcher la barre, et pas les deux derniers.
-- La nature `set_barre`, posée le même jour, ne savait pas le dire : un groupe
-- est une suite PLATE, il ne contient pas de sous-groupe. William, 16/09 : « et
-- comment je mets plusieurs set sur barre dans un seul circuit ? ».
--
-- D'où un LIEN plutôt qu'une nature : un booléen sur la ligne, qui dit « sans
-- lâcher jusqu'à la SUIVANTE du groupe ». Il vaut dans un circuit, un bi-set, un
-- EMOM ou un AMRAP — et `set_barre` devient un circuit dont tous les liens sont
-- unbroken. On la retire.
--
-- ⚠️ `set_barre` NE PORTE AUCUNE LIGNE : la garde ci-dessous le vérifie AU MOMENT
-- d'appliquer, plutôt que de le supposer. Un groupe qui l'aurait reçue entre-temps
-- arrête la migration au lieu de violer le nouveau CHECK en plein milieu.
--
-- ⚠️ `NOT NULL DEFAULT false` : « lié » ou « pas lié », il n'y a pas de troisième
-- état. Sur la dernière ligne d'un groupe, ou hors groupe, brokkr le remet à
-- `false` (`prescription.normaliser_groupes`, `_ranger_les_liens`) : un lien vers
-- rien ne se garde pas.
--
-- Sur les deux tables qui portent des groupes : la séance et les accessoires de
-- BASE (d'où la génération le recopie). Les principes de BASE n'ont pas de groupe.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT (SELECT count(*) FROM training_exercises WHERE group_kind = 'set_barre')
       + (SELECT count(*) FROM training_base_accessories WHERE group_kind = 'set_barre')
    INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION '% ligne(s) portent la nature set_barre — à reprendre en circuit avant ce retrait.', n;
  END IF;
END $$;

ALTER TABLE training_exercises DROP CONSTRAINT training_exercises_group_kind_check;
ALTER TABLE training_exercises ADD CONSTRAINT training_exercises_group_kind_check
  CHECK (group_kind IN ('biset', 'dropset', 'circuit', 'emom', 'amrap'));

ALTER TABLE training_base_accessories DROP CONSTRAINT training_base_accessories_group_kind_check;
ALTER TABLE training_base_accessories ADD CONSTRAINT training_base_accessories_group_kind_check
  CHECK (group_kind IN ('biset', 'dropset', 'circuit', 'emom', 'amrap'));

ALTER TABLE training_exercises        ADD COLUMN unbroken boolean NOT NULL DEFAULT false;
ALTER TABLE training_base_accessories ADD COLUMN unbroken boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-16_unbroken.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
