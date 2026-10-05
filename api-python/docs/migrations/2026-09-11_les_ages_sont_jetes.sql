-- LES ÂGES SONT JETÉS — FRE-137, lot 4 (suite).
--
-- Décision de William le 11/09 : « les jeter, personne s'en sert ».
--
-- ⚠️ ET ÇA NE FERME PAS LA CAUSE, ce qui est assumé. Le défaut d'`age` n'est pas
--    un encodage — c'est une donnée PÉRISSABLE : un entier saisi une fois,
--    jamais recalculé, faux dès l'anniversaire suivant. Les 34 âges en base ne
--    valent donc rien, et cette migration les efface. Mais le champ reste
--    affiché sur la fiche (« 27 ans ») et saisissable : il se re-remplira, et
--    vieillira à nouveau. Le compteur repart à zéro, la fuite demeure.
--
--    Seul `birth_date` la fermerait — l'âge se calculerait alors, et la
--    catégorie d'âge en compétition avec lui. Écarté pour l'instant : c'est un
--    déploiement couplé au front (contrat, en-tête, champ de saisie), et 34
--    personnes devraient ressaisir une date.
--
-- ⚠️ PAS DE CHECK : un âge saisi n'est pas une faute, il est seulement
--    périssable. Une contrainte ne sait pas dire ça, et un invariant non plus —
--    aucune requête ne distingue « 27 ans, saisi hier » de « 27 ans, saisi il y
--    a trois ans ». C'est précisément pourquoi la donnée est mauvaise.
--
-- ⚠️ POURQUOI CE FICHIER EXISTE PLUTÔT QUE DEUX LIGNES DANS LE PRÉCÉDENT.
--    `2026-09-11_un_zero_n_est_pas_une_mesure.sql` était EN COURS D'ÉDITION
--    quand elle a été jouée : j'y ajoutais cet `UPDATE`, elle est partie deux
--    minutes plus tôt. Le registre ne garde que le NOM du fichier — l'ajout
--    n'aurait donc jamais tourné en production, alors qu'une base reconstruite
--    depuis les migrations l'aurait joué. Deux bases divergentes, et rien pour
--    le dire.
--
--    La règle « une migration ne se modifie pas, on en écrit une seconde »
--    n'était pas une préférence de forme.
--
-- AVANT : 34 fiches sur 70 portent un âge (aucune à zéro).

BEGIN;

UPDATE athletes SET age = NULL WHERE age IS NOT NULL;

INSERT INTO schema_migrations (fichier)
VALUES ('2026-09-11_les_ages_sont_jetes.sql')
ON CONFLICT (fichier) DO NOTHING;

COMMIT;

-- VÉRIFICATION :
--   SELECT count(*) FROM athletes WHERE age IS NOT NULL;   -- attendu : 0
