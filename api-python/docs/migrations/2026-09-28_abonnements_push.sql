-- LES ABONNEMENTS AUX NOTIFICATIONS PUSH (28/09) : « me prévenir quand mon
-- coach génère une nouvelle semaine », activable depuis la page Profil.
--
-- Un abonnement Web Push est PAR NAVIGATEUR : l'endpoint est fourni par le
-- service de push du navigateur, et c'est lui la clé. Une personne peut en
-- avoir plusieurs (téléphone, ordinateur), et le même endpoint ne peut
-- appartenir qu'à une personne à la fois — se reconnecter sous un autre compte
-- sur le même appareil le RÉATTRIBUE (ON CONFLICT DO UPDATE côté route).
--
-- `p256dh` et `auth` sont les clés de chiffrement du navigateur (RFC 8291) :
-- sans elles, rien ne peut lui être envoyé. Un endpoint que le service de push
-- déclare mort (404 / 410 à l'envoi) est supprimé par brokkr.

BEGIN;

CREATE TABLE push_subscriptions (
    endpoint   text PRIMARY KEY,
    uid        text NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    p256dh     text NOT NULL,
    auth       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON push_subscriptions (uid);
-- Sans ce GRANT, la table naît invisible à l'application (rôle applicatif).
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO brokkr_app;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-28_abonnements_push.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
