-- Migration : disponibilité des coachs sur une compétition (FRE-22).
--
-- BESOIN. Une compétition connaît ses participants, pas ses encadrants. Les
-- coachs doivent pouvoir dire qui se déplace, pour répartir à l'avance la
-- gestion des passages (annonce des barres, coaching au plateau).
--
-- PAR JOUR, pas un booléen : une compétition dure souvent deux jours et
-- `competition_participants.competes_on` dit déjà quel athlète passe quand.
-- « Qui est là samedi ? » est la question qui permet de répartir ; « qui vient
-- à la compét ? » ne permet rien.
--
-- TABLE DÉDIÉE, et pas un sous-arbre du payload compétition : `PUT
-- /competitions/{id}` est un create-or-replace qui SUPPRIME les enfants et les
-- réinsère. Une disponibilité rangée là-dedans serait effacée à la première
-- édition de la compétition par quelqu'un d'autre — le mécanisme qui a détruit
-- des prescriptions de charge (cf. FRE-18).
--
-- `pending` EST une valeur, pas une absence (décision de William, 2026-08-11) :
-- « pas encore répondu » est un état du domaine, c'est lui qui dit qui relancer.
-- Le faire porter par l'absence de ligne rendrait « jamais vu » et « ligne
-- perdue » indistinguables. Le GET complète la matrice coach × jour avec
-- `pending`, donc aucune lecture ne dépend d'un trou.
--
-- Cascades reprises de `competition_editors` : supprimer une compétition ou un
-- coach nettoie derrière lui, sans code applicatif.
--
-- ⚠️ ÉTAT D'APPLICATION : APPLIQUÉE SUR NEON le 2026-08-11. Vérifié dans la
-- foulée : 5 colonnes, enum ('pending','available','unavailable'), 0 ligne.
-- Ré-exécuter tel quel lèverait « type already exists » ; ce fichier reste la
-- trace canonique du DDL pour un environnement neuf.

BEGIN;

CREATE TYPE coach_availability AS ENUM ('pending', 'available', 'unavailable');

CREATE TABLE competition_coach_availability (
    competition_id uuid               NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    coach_uid      text               NOT NULL REFERENCES coaches(uid)     ON DELETE CASCADE,
    day            date               NOT NULL,
    status         coach_availability NOT NULL DEFAULT 'pending',
    updated_at     timestamptz        NOT NULL DEFAULT now(),
    PRIMARY KEY (competition_id, coach_uid, day)
);

-- Lecture dominante : « les dispos de CETTE compétition ». La PK couvre déjà ce
-- préfixe ; l'index inverse sert la lecture « mes compétitions » côté coach,
-- qui alimentera son calendrier.
CREATE INDEX competition_coach_availability_coach_idx
    ON competition_coach_availability (coach_uid, day);

COMMIT;
