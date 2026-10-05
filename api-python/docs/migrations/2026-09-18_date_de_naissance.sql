-- UNE DATE DE NAISSANCE, DONT L'ÂGE SE CALCULE (FRE-168).
--
-- `athletes.age` était un entier saisi à la main et jamais recalculé : faux dès
-- l'anniversaire suivant, et AUCUNE garde ne pouvait le voir — rien ne distingue
-- « 27 ans, juste » de « 27 ans, périmé ». FRE-137 avait jeté les valeurs sans
-- fermer la cause ; le champ restait saisissable, et il s'est remis à se remplir.
--
-- ⚠️ ON NE DÉDUIT PAS UNE DATE DE NAISSANCE D'UN ÂGE. Les âges présents au moment
-- d'appliquer PARTENT avec la colonne : il faudra redemander la date à ces
-- athlètes. Les compter AVANT d'appliquer (`SELECT count(age) FROM athletes`).
--
-- ⚠️ L'ÂGE SE CALCULE DANS BROKKR, À LA LECTURE (`athletes._COMMON_COLS`), et
-- pas dans le navigateur : deux définitions de « quel âge a-t-il » divergeraient
-- au premier cas limite, l'anniversaire du jour. `current_date` suit le fuseau
-- de la session, Europe/Paris (`db.py`).
--
-- Le CHECK ne borne que le passé lointain : « pas dans le futur » dépend du jour,
-- et un CHECK doit rester vrai demain pour une ligne écrite aujourd'hui. Le
-- futur est refusé à l'écriture (`AthleteProfilePatch.birthDate`).

BEGIN;

ALTER TABLE athletes
  ADD COLUMN birth_date date
    CONSTRAINT birth_date_plausible CHECK (birth_date >= DATE '1900-01-01');

ALTER TABLE athletes DROP COLUMN age;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-18_date_de_naissance.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
