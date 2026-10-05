-- Le coach de TEST et son terrain de jeu, dans le bac à sable.
--
-- Les specs e2e créent leurs propres macros, blocs et semaines ICI, puis les
-- suppriment. Elles ne touchent JAMAIS aux 55 programmes réels : un objet créé
-- se supprime, une donnée réelle modifiée ne se « dé-modifie » pas.
--
-- L'uid doit être celui du compte de l'émulateur Auth (`e2e-coach`) : sans quoi
-- l'authentification passe et l'autorisation refuse.
--
-- Idempotent : rejouable autant qu'on veut.

INSERT INTO users (uid, email, display_name)
VALUES ('e2e-coach', 'e2e@french-forge.test', 'Coach E2E')
ON CONFLICT (uid) DO NOTHING;

INSERT INTO coaches (uid) VALUES ('e2e-coach') ON CONFLICT (uid) DO NOTHING;

-- L'utilisateur ATHLÈTE : le second rôle du harnais. C'est `athletes.user_uid`
-- qui fait de lui « l'athlète lié » — sans ce lien, il s'authentifie mais ne
-- voit aucun programme, et le parcours athlète ne peut pas exister.
INSERT INTO users (uid, email, display_name)
VALUES ('e2e-athlete-user', 'athlete-e2e@french-forge.test', 'Athlète E2E')
ON CONFLICT (uid) DO NOTHING;

INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name, email, user_uid)
VALUES ('e2e0e2e0-0000-4000-8000-000000000001', 'e2e-athlete', 'e2e-coach', 'Athlète', 'E2E',
        'athlete-e2e@french-forge.test', 'e2e-athlete-user')
ON CONFLICT (id) DO NOTHING;

-- Le lien doit tenir même si la ligne athlète PRÉEXISTE (semée avant que le
-- second compte n'existe) : l'UPDATE rattrape ce cas, le DO NOTHING ne le
-- couvrant pas.
UPDATE athletes SET user_uid = 'e2e-athlete-user'
WHERE id = 'e2e0e2e0-0000-4000-8000-000000000001' AND user_uid IS DISTINCT FROM 'e2e-athlete-user';

INSERT INTO programs (id, coach_uid, athlete_id)
VALUES ('e2e-program', 'e2e-coach', 'e2e0e2e0-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Le KINÉ de test (FRE-65) : déclaré dans `kines`, et il SUIT l'athlète E2E —
-- c'est le lien, pas le rôle, qui lui ouvre la lecture du programme.
INSERT INTO users (uid, email, display_name)
VALUES ('e2e-kine', 'kine-e2e@french-forge.test', 'Kiné E2E')
ON CONFLICT (uid) DO NOTHING;

INSERT INTO kines (uid) VALUES ('e2e-kine') ON CONFLICT (uid) DO NOTHING;

UPDATE athletes SET kine_uid = 'e2e-kine'
WHERE id = 'e2e0e2e0-0000-4000-8000-000000000001' AND kine_uid IS DISTINCT FROM 'e2e-kine';


-- ⚠️ LA FICHE DONT LE COMPTE A CHANGÉ (FRE-76). Un athlète dont l'uid Firebase
-- change — compte Google recréé, second compte, autre fournisseur — voit sa
-- fiche rester accrochée à l'ANCIEN uid. `POST /athletes/link` refuse alors, à
-- juste titre (garde anti-usurpation), et sans porte de sortie il est dehors
-- pour de bon.
--
-- Le harnais reproduit exactement cet état : la fiche porte l'adresse du compte
-- `e2e-identite` de l'émulateur, mais elle est rattachée à `e2e-identite-ancien`
-- — un uid qui n'a plus de compte Firebase en face.
--
-- ⚠️ L'ANCIEN COMPTE PORTE UNE AUTRE ADRESSE, à dessein : `users.email` a perdu
-- son unicité (FRE-77), mais dupliquer l'adresse ici ne prouverait rien de plus
-- et ferait échouer le semis sur toute base pas encore migrée.
INSERT INTO users (uid, email, display_name)
VALUES ('e2e-identite-ancien', 'ancien-compte@french-forge.test', 'Ancien compte E2E')
ON CONFLICT (uid) DO NOTHING;

INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name, email, user_uid)
VALUES ('e2e0e2e0-0000-4000-8000-000000000002', 'e2e-identite', 'e2e-coach',
        'Identité', 'E2E', 'identite-e2e@french-forge.test', 'e2e-identite-ancien')
ON CONFLICT (id) DO NOTHING;

-- INCONDITIONNEL : le parcours e2e DÉTACHE puis RE-rattache cette fiche. Sans ce
-- retour à l'état initial, la deuxième exécution du harnais partirait d'une fiche
-- déjà rattachée au bon compte — et la spec de l'impasse n'aurait plus d'impasse
-- à éprouver. Un `ON CONFLICT DO NOTHING` ne le couvre pas : la ligne existe.
UPDATE athletes SET user_uid = 'e2e-identite-ancien'
WHERE legacy_id = 'e2e-identite' AND user_uid IS DISTINCT FROM 'e2e-identite-ancien';


-- ⚠️ LE COACH QUI EST AUSSI ATHLÈTE (FRE-142) — le cas le plus courant en
-- production, et le seul que le harnais ne construisait pas. Mesuré le 09/09 :
-- les 4 coachs sont athlètes, 1 se programme lui-même. William est les deux.
--
-- Il est le coach de SON PROPRE programme : c'est la seule forme où le serveur
-- résout `{coach, athlete}` sur un même programme et doit en faire l'UNION —
-- `perimetre.py` prend le premier rôle rencontré ? il refuse à un coach sa
-- propre prescription, et aucune des specs à un seul rôle ne bouge.
-- FRE-118 et FRE-127 ont chacune laissé passer un défaut par là.
--
-- Son programme est SÉPARÉ (`e2e-program-double`) : les autres specs nettoient
-- `e2e-program` en `afterEach`, et un décor partagé ferait mentir les deux.
INSERT INTO users (uid, email, display_name)
VALUES ('e2e-coach-athlete', 'coach-athlete-e2e@french-forge.test', 'Coach-athlète E2E')
ON CONFLICT (uid) DO NOTHING;

INSERT INTO coaches (uid) VALUES ('e2e-coach-athlete') ON CONFLICT (uid) DO NOTHING;

INSERT INTO athletes (id, legacy_id, coach_uid, first_name, last_name, email, user_uid)
VALUES ('e2e0e2e0-0000-4000-8000-000000000003', 'e2e-double', 'e2e-coach-athlete',
        'Double', 'E2E', 'coach-athlete-e2e@french-forge.test', 'e2e-coach-athlete')
ON CONFLICT (id) DO NOTHING;

UPDATE athletes SET user_uid = 'e2e-coach-athlete', coach_uid = 'e2e-coach-athlete'
WHERE id = 'e2e0e2e0-0000-4000-8000-000000000003'
  AND (user_uid IS DISTINCT FROM 'e2e-coach-athlete' OR coach_uid IS DISTINCT FROM 'e2e-coach-athlete');

INSERT INTO programs (id, coach_uid, athlete_id)
VALUES ('e2e-program-double', 'e2e-coach-athlete', 'e2e0e2e0-0000-4000-8000-000000000003')
ON CONFLICT (id) DO NOTHING;
