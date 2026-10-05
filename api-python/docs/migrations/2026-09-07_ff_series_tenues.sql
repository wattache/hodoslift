-- LA RÈGLE DES SÉRIES TENUES DEVIENT UNE FONCTION (FRE-148).
--
-- Signalé par William le 07/09 : le tableau des séries affichait `0 / 9` sur son
-- muscle up le jour où il venait d'en faire 5. Ce n'était pas un problème
-- d'affichage — un 0 est un 0, et `0 / 0` sur un mouvement non programmé ne
-- ment pas non plus. C'était de la donnée PÉRIMÉE : le tableau lisait
-- `training_sets`, une projection reconstruite chaque nuit.
--
-- Sa question — « où en est le volume » — se pose au présent. Comme le tableau
-- des records, elle doit se lire sur les tables VIVANTES.
--
-- ⚠️ ET UNE SEULE CHOSE L'EN EMPÊCHAIT : la règle de FRE-110. Le nombre de
--    séries TENUES n'est pas une colonne, c'est une dérivation — quand une
--    série porte `FAIL`, on compte les séries notées qui n'en sont pas. Elle ne
--    vivait que dans l'ETL. La réécrire dans une seconde requête, c'est deux
--    définitions d'une même notion qui divergeront : le défaut le plus répété
--    de ce projet.
--
--    D'où cette fonction, dixième d'une famille qui existe pour ça — `ff_num`,
--    `ff_mechano`, `ff_rpe_by_set`… Le commentaire de `ff_mechano` le dit :
--    « la MÊME fonction sert ». L'ETL l'appelle, la lecture vivante aussi, et la
--    divergence devient impossible au lieu d'être surveillée.
--
-- ⚠️ AUCUN CHANGEMENT DE COMPORTEMENT ATTENDU : le corps est copié de l'ETL à
--    l'identique. La vérification (b) plus bas le prouve sur les 14 966 lignes
--    déjà projetées — l'ancienne expression et la fonction doivent rendre le
--    même chiffre partout.

BEGIN;

CREATE OR REPLACE FUNCTION ff_series_tenues(sets text, felt_rpe_by_set text[])
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    -- ⚠️ « SI RIEN N'EST REMPLI, ALORS RIEN N'EST FAIT » (William, 01/09). Une
    -- case unique ne se lit PAS comme « la dernière série » : le tableau se lit
    -- position par position, donc `['FAIL']` est la série 1. Ces lignes-là sont
    -- 31 et pèsent 12 t sur les 27,6 de correction — la tentation est chiffrée,
    -- et refusée.
    --
    -- ⚠️ ET CE N'EST PAS UN FILTRE : la ligne reste, avec zéro série. Elle garde
    -- sa charge, son RPE, sa trace d'échec — c'est le volume qui vaut zéro, pas
    -- la séance qui disparaît.
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM unnest(coalesce(felt_rpe_by_set, '{}')) v
                      WHERE upper(btrim(v)) = 'FAIL')
        THEN (SELECT count(*)::int FROM unnest(felt_rpe_by_set) v
               WHERE btrim(v) <> '' AND upper(btrim(v)) <> 'FAIL')
        ELSE round(ff_num(sets))::int
    END
$$;

COMMIT;


-- VÉRIFICATIONS, à jouer après le COMMIT.
--
-- a) la fonction rend ce qu'on attend sur les trois formes :
--    SELECT ff_series_tenues('5', NULL),                        -- → 5
--           ff_series_tenues('5', '{"8","8","FAIL"}'),           -- → 2
--           ff_series_tenues('5', '{"FAIL"}'),                   -- → 0
--           ff_series_tenues('5', '{"8","","8"}');               -- → 5 (aucun FAIL)
--
-- b) ⚠️ ZÉRO ÉCART SUR LA PROJECTION DÉJÀ ÉCRITE — c'est la vérification qui
--    compte, parce qu'elle compare la fonction à ce que l'ETL a réellement
--    produit sur les 14 966 lignes :
--
--    SELECT count(*) FROM training_sets ts
--      JOIN training_exercises e ON e.id = ts.exercise_id
--     WHERE ts.sets IS DISTINCT FROM ff_series_tenues(e.sets, e.felt_rpe_by_set);
--                                                              -- → 0
