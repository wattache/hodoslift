-- UN RÈGLEMENT PAR COMPÉTITION. Les motifs de « no rep » étaient ceux de la FNSL,
-- et seulement eux ; FinalRep (rulebook VI 26.2, valable depuis le 01/03/2026)
-- juge autrement — pas de carton automatique, un « Fail » par discipline, le
-- chicken wing, le stretch-shortening après le « Go ! », la barre lâchée.
-- Chaque compétition dit sous quel règlement elle se joue ; le front ne propose
-- que les motifs de ce règlement.
--
-- `norep_reasons.reglement` NULL = commun aux règlements (« ne sait pas »,
-- « autre »). Les identifiants FinalRep portent le préfixe `fr_` ; la clé
-- étrangère de `competition_attempts` les accepte comme les autres.

BEGIN;

CREATE TYPE reglement AS ENUM ('fnsl', 'finalrep');

ALTER TABLE competitions ADD COLUMN reglement reglement NOT NULL DEFAULT 'fnsl';

ALTER TABLE norep_reasons ADD COLUMN reglement reglement;
UPDATE norep_reasons SET reglement = 'fnsl' WHERE id NOT IN ('unknown', 'other');

INSERT INTO norep_reasons (id, label, is_auto, reglement) VALUES
  ('fr_fail',                'Échec : mouvement non terminé',                          false, 'finalrep'),
  ('fr_false_grip',          'False grip : poignet ou avant-bras sur la barre',        false, 'finalrep'),
  ('fr_bent_arms',           'Départ bras fléchis',                                    false, 'finalrep'),
  ('fr_kipping',             'Kipping / coup de pied',                                 false, 'finalrep'),
  ('fr_loss_of_control',     'Perte de contrôle de la charge ou des jambes',           false, 'finalrep'),
  ('fr_downward_motion',     'Redescente avant la fin du mouvement',                   false, 'finalrep'),
  ('fr_downward_motion_ssc', 'Redescente rapide après « Go ! » (stretch-shortening)',  false, 'finalrep'),
  ('fr_lockout',             'Pas de verrouillage complet des coudes',                 false, 'finalrep'),
  ('fr_signal',              'Signal manqué ou ignoré',                                false, 'finalrep'),
  ('fr_chicken_wing',        'Chicken wing : coudes l''un après l''autre',             false, 'finalrep'),
  ('fr_depth_shoulder',      'Profondeur épaule insuffisante',                         false, 'finalrep'),
  ('fr_depth_hip',           'Profondeur hanche insuffisante',                         false, 'finalrep'),
  ('fr_bent_knees',          'Départ genoux fléchis',                                  false, 'finalrep'),
  ('fr_depth',               'Profondeur insuffisante',                                false, 'finalrep'),
  ('fr_foot_movement',       'Déplacement des pieds',                                  false, 'finalrep'),
  ('fr_spotter_contact',     'Contact d''un pareur',                                   false, 'finalrep'),
  ('fr_support',             'Appui des coudes sur les cuisses',                       false, 'finalrep'),
  ('fr_dropping_bar',        'Barre lâchée : disqualification',                        false, 'finalrep');

INSERT INTO schema_migrations (fichier)
VALUES ('2026-10-10_un_reglement_par_competition.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;
