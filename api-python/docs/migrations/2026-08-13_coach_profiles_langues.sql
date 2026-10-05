-- Migration : coach_profiles — LANGUES parlées par le coach (FRE-30).
--
-- CONTEXTE. Le profil public affiche déjà accroche/bio/instagram/1RM ; les langues
-- parlées manquaient, alors que c'est un critère de choix pour un athlète étranger.
-- Saisies dans l'app (menu déroulant), affichées par le site vitrine.
--
-- text[] et non jsonb : c'est une LISTE PLATE de codes, sans structure ni ordre
-- signifiant. jsonb ouvrirait la porte à des objets ({code, niveau}) qu'on ne veut
-- pas ici, et `one_rm` (jsonb) l'est parce qu'il porte des CLÉS (muscleUp, squat…).
--
-- ⚠️ PAS de contrainte d'ÉNUMÉRATION (ni CHECK, ni Literal côté Pydantic), et c'est
-- délibéré. Les valeurs sont des codes ISO 639-1 ('fr', 'en', 'pl'…) issus d'un menu
-- déroulant du front : déjà contraintes à la saisie. Les figer ici imposerait un
-- redéploiement de brokkr (ou une migration) pour ajouter le turc, sur un champ
-- purement d'AFFICHAGE. C'est l'inverse du raisonnement sur `repsUnit`, où la valeur
-- pilotait un CALCUL (le tonnage) — une valeur inattendue y produisait un chiffre
-- faux, ici elle produit au pire une ligne d'affichage inconnue.
--
-- NORMALISÉ À L'ENTRÉE (schemas/coach_profile.py) : minuscules, doublons écartés,
-- vides écartés. ['FR','fr'] → ['fr']. La base ne reçoit donc que du propre, mais ne
-- l'IMPOSE pas — cf. ci-dessus.
--
-- NULL = non renseigné. Une liste vide est convertie en NULL à l'écriture : la page
-- vitrine teste la présence de la valeur, un tableau vide lui ferait afficher une
-- section « Langues » sans langue.
--
-- ⚠️ ÉTAT D'APPLICATION : PAS ENCORE APPLIQUÉE au 2026-08-13. À jouer sur Neon
-- AVANT le déploiement de brokkr : la colonne est ajoutée à `_PUBLIC_COLUMNS`, donc
-- les DEUX lectures (GET /{slug} publique et GET /me) la sélectionnent — déployée
-- sans la colonne, la page vitrine sort en 500, pas en dégradé. Le job nocturne, lui,
-- ne la touche pas (la projection n'écrit que `one_rm`) : rien à craindre de ce côté.
-- Non destructive (ADD COLUMN nullable, aucune rétro-donnée à écrire).

BEGIN;

ALTER TABLE coach_profiles ADD COLUMN langues text[];

COMMIT;
