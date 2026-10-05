-- SUIVI KINÉ : ce que l'athlète rapporte de son état, dans son journal quotidien.
--
-- POURQUOI ICI ET PAS DANS UNE TABLE À PART. `daily_logs` porte déjà « ce que
-- l'athlète rapporte sur lui-même, un jour donné » : son poids, son sommeil, son
-- eau, ses calories. Une douleur est de la même nature, au même grain, écrite par
-- la même personne. Une table dédiée aurait dupliqué la clé (athlete_id,
-- log_date), le routeur, l'autorisation et les tests pour le même service.
--
-- L'HISTORIQUE VIENT GRATUITEMENT, et c'est le vrai gain : une ligne par jour
-- existe déjà, donc une douleur qui monte ou qui descend se lit sans rien de
-- plus. C'est précisément ce qu'un kiné regarde.
--
-- ⚠️ UNE COLONNE `jsonb`, ET PAS UNE COLONNE PAR QUESTION. Le questionnaire n'est
-- PAS arrêté — les trois premières questions (« quelles douleurs », « depuis
-- quand », « intensité /10 ») sont un point de départ, pas un contrat. Les figer
-- en colonnes typées avec un CHECK aurait fait payer une migration à chaque
-- reformulation, et il y en aura, puisque c'est justement ce qu'on cherche à
-- éprouver.
--
-- Le prix de ce choix, assumé : la base ne valide pas le CONTENU. Elle valide
-- qu'il s'agit d'un objet, et le contrat HTTP borne la taille et la forme. Le
-- jour où les questions se stabilisent, on les type — avec l'usage sous les yeux
-- plutôt qu'avec une intuition, et la reprise sera un `UPDATE … SET x = kine->>…`.
--
-- QUI ÉCRIT, QUI LIT : inchangé, et c'est ce qui rend la fonctionnalité possible.
-- Le PATCH est `owner` — l'athlète répond lui-même (« quelles douleurs AS-TU ? ») ;
-- le GET est `owner_or_staff`, donc son coach ET son kiné lisent. Ce second point
-- ne marche que depuis l'ouverture des droits du kiné (2026-08-18) : avant, il
-- n'aurait rien vu de ce qu'on lui destine.

BEGIN;

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS kine jsonb;

-- Un OBJET, ou rien. La seule chose que la base peut garantir sans connaître les
-- questions — et elle vaut d'être garantie : un tableau ou un scalaire glissé là
-- ferait exploser la lecture côté front bien plus loin, sans que la trace remonte
-- jusqu'ici. NULL reste permis et veut dire « rien rapporté ce jour-là ».
ALTER TABLE daily_logs
  DROP CONSTRAINT IF EXISTS daily_logs_kine_objet;
ALTER TABLE daily_logs
  ADD CONSTRAINT daily_logs_kine_objet
  CHECK (kine IS NULL OR jsonb_typeof(kine) = 'object');

COMMIT;
