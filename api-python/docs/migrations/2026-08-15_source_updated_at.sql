-- Le repère qui rend la bascule INCRÉMENTALE et donc RÉPÉTABLE (FRE-12).
--
-- Le problème : l'ETL émet un aller-retour SQL par ligne, soit 15 034. Depuis un
-- poste de travail, l'aller-retour vers Neon (eu-central-1) coûte 29 ms mesurés —
-- donc 7 min 20 d'écriture, quand la lecture Firestore n'en prend que 12 s. Une
-- fenêtre de maintenance de quinze minutes n'y suffit pas confortablement.
--
-- La solution tient à une observation : l'arbre ne fait que 604 DOCUMENTS
-- Firestore (62 macros, 125 blocs, 417 semaines). Les séances et les exercices
-- sont imbriqués dans le document semaine — les 15 034 lignes n'existent qu'à la
-- sortie, ici. L'unité de changement est donc le document, et Firestore horodate
-- chacun d'eux tout seul : `DocumentSnapshot.update_time`, une métadonnée
-- serveur qu'aucun code applicatif ne peut oublier de mettre à jour.
--
-- On la range ici. La passe suivante saute tout document dont l'horodatage n'a
-- pas bougé — et sauter une semaine, c'est sauter ses séances et ses exercices,
-- c'est-à-dire l'essentiel du volume.
--
-- ⚠️ PRÉCISION. Firestore rend des nanosecondes, Postgres stocke la
-- microseconde. L'ETL tronque donc à la microseconde AVANT d'écrire, sinon la
-- comparaison au retour serait toujours fausse et le delta ne sauterait jamais
-- rien — une panne silencieuse qui ne se verrait qu'au chronomètre.
--
-- NULL = jamais horodaté (lignes chargées avant cette colonne) : elles seront
-- rechargées une fois, puis porteront leur repère.
--
-- À APPLIQUER AVEC `psql -v ON_ERROR_STOP=1`.

BEGIN;

ALTER TABLE training_macros ADD COLUMN source_updated_at timestamptz;
ALTER TABLE training_blocks ADD COLUMN source_updated_at timestamptz;
ALTER TABLE training_weeks  ADD COLUMN source_updated_at timestamptz;

COMMIT;
