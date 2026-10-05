-- Le rôle KINÉ entre dans le modèle (FRE-52, socle de FRE-51).
--
-- CE QUE CETTE MIGRATION POSE, ET RIEN DE PLUS : un rôle, et un lien nominatif
-- vers les athlètes suivis. La règle « les lignes rehab sont réservées au kiné »
-- est FRE-53 et n'a aucune trace ici — ni colonne, ni contrainte. Le kiné obtenu
-- par cette migration LIT le programme de ses athlètes et n'écrit rien.
--
-- POURQUOI UNE TABLE ET PAS UN BOOLÉEN `users.is_kine`. Même décision que pour
-- `coaches`, pour la même raison et une de plus :
--   * être kiné = AVOIR UNE LIGNE. Un booléen sur `users` peut diverger de la
--     réalité des liens ; une ligne référencée par une FK ne le peut pas ;
--   * la table est la CIBLE des FK « ce champ doit être un kiné »
--     (`athletes.kine_uid` ci-dessous), ce qu'un booléen ne sait pas faire ;
--   * ⚠️ et surtout, pour les ORGANISATIONS (FRE-64). Le jour où coachs, kinés
--     et athlètes seront regroupés en organisations, `kines` se DISSOUDRA dans
--     une adhésion (rôle porté par le lien d'appartenance) — une table se
--     dissout, un flag sur `users` se serait traîné. La symétrie exacte avec
--     `coaches` est voulue : la future migration doit pouvoir traiter les deux
--     d'un seul geste.
--
-- UN SEUL KINÉ PAR ATHLÈTE EN V1 (décision FRE-51). D'où une colonne sur
-- `athletes` et non une table de liaison : « en suivi kiné » est un lien
-- nominatif, pas une collection. Une table de liaison serait la bonne forme pour
-- du N-N — on la fera le jour où le besoin existe, pas par anticipation.
--
-- ON DELETE RESTRICT, comme `athletes.coach_uid`. Retirer le rôle à un kiné qui
-- suit encore des athlètes ÉCHOUE plutôt que de détacher ses suivis en silence :
-- c'est ce qui donne le 409 de `PUT /users/{uid}/kine`, exactement comme pour le
-- retrait d'un coach. Le geste « détache d'abord, rétrograde ensuite » est
-- explicite, et c'est le bon.
--
-- ADDITIVE : aucune table existante n'est réécrite, la colonne naît NULL partout
-- (« pas de suivi kiné » est l'état de tout le monde au moment où ceci
-- s'applique). Sans effet sur la production tant qu'aucun code ne l'écrit.
--
-- ⚠️ ORDRE : cette migration AVANT le déploiement qui la référence — le job
-- nocturne partage l'image du service, et `require_program_access` lira
-- `kine_uid` dès la première requête.
--
-- À APPLIQUER AVEC `psql -v ON_ERROR_STOP=1` — sans ce drapeau, psql sort en
-- code 0 même après un ROLLBACK, et la suite du runbook s'enchaînerait sur une
-- migration qui n'a pas pris.

BEGIN;

-- Rôle KINÉ. Copie conforme de `coaches` : clé = uid, table d'EXTENSION 1:1 de
-- `users` (pas de kiné sans compte), et point d'accroche pour de futurs attributs.
CREATE TABLE kines (
    uid        text PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Le kiné qui SUIT cet athlète. NULL = pas de suivi kiné, l'état de tout le monde
-- aujourd'hui. Écrit par le COACH de l'athlète (il choisit à qui il confie le
-- suivi), jamais par le kiné lui-même : on ne se donne pas ses propres patients.
ALTER TABLE athletes
    ADD COLUMN kine_uid text REFERENCES kines(uid) ON DELETE RESTRICT;

-- Le kiné interroge « MES athlètes » — un accès par le rôle, comme `coach_uid`.
CREATE INDEX ON athletes (kine_uid);

COMMIT;
