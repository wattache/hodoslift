-- LES REPS ET LA CHARGE SE SAISISSENT PAR SÉRIE, comme le RPE.
--
-- ⚠️ À JOUER AVANT DE DÉPLOYER brokkr : la lecture de l'arbre sélectionne les
--    deux colonnes, et sans elles `GET /training` répond 500 — l'écran
--    d'entraînement entier. La base doit OFFRIR avant que le code ne demande.
--
-- ⚠️ AUCUNE REPRISE DU PASSÉ (décision de William, 06/09 : « les gens se
--    débrouillent »). Les 73 lignes qui écrivent déjà « 10/11/12 » à la main
--    dans `reps_done` restent telles quelles — donc sous-comptées par le
--    tonnage, qui n'en lit que la première valeur. Elles se corrigeront à la
--    ressaisie, ou jamais ; c'est assumé.
--
-- ⚠️ `text[]` ET NON `numeric[]`, exactement comme `felt_rpe_by_set`. Une série
--    non renseignée doit pouvoir rester VIDE au milieu du tableau — `['10','','12']`
--    dit « la deuxième n'est pas notée », ce qu'un tableau de nombres ne sait
--    pas exprimer sans inventer un zéro. C'est le [[vide_contre_null]] du
--    projet, appliqué à une position dans une liste.
--
-- ⚠️ LE TONNAGE CHANGE DE FORME, et c'est la vraie conséquence de cette
--    migration. Il valait `séries × reps × charge`, un rectangle. Il devient une
--    SOMME DE PRODUITS, parce que le produit des moyennes n'est pas la somme
--    des produits dès que la charge varie :
--
--        2 séries : 10 reps @ 100 kg, puis 5 @ 50 kg
--        somme des produits   10×100 + 5×50 = 1 250 kg   ← le vrai
--        produit des moyennes  2 × 7,5 × 75 = 1 125 kg   ← faux de 10 %
--
--    Les moyennes restent AFFICHÉES (demande de William : « on affiche toujours
--    les moyennes »), elles ne servent simplement plus à calculer.
--
--    La nouvelle formule dégénère exactement en l'ancienne quand les tableaux
--    sont vides : la somme sur `sets` positions du même produit vaut
--    `sets × reps × charge`. Aucune ligne existante ne bouge — vérifié par
--    `test_etl_training_sets.py`.
--
-- Après application : `make schema-verifier` doit rester vert, puis rejouer la
-- projection (`uv run python -m scripts.etl_training_sets --apply`) pour que le
-- suivi voie les nouvelles colonnes.

BEGIN;

ALTER TABLE training_exercises
  ADD COLUMN IF NOT EXISTS reps_done_by_set   text[],
  ADD COLUMN IF NOT EXISTS weight_done_by_set text[];

-- La projection du suivi les porte aussi : le graphe doit pouvoir montrer la
-- dispersion d'une ligne, pas seulement sa moyenne.
ALTER TABLE training_sets
  ADD COLUMN IF NOT EXISTS reps_by_set   numeric[],
  ADD COLUMN IF NOT EXISTS weight_by_set numeric[];


-- ⚠️ UNE FONCTION PAR TYPE, PARCE QUE LES VOCABULAIRES DIFFÈRENT. `ff_rpe_by_set`
--    borne à [0, 10] et connaît `FAIL` ; des répétitions et des kilos n'ont ni
--    l'un ni l'autre. Réutiliser la fonction du RPE aurait silencieusement
--    écrasé toute charge au-dessus de 10 kg.
--
--    `NULL` pour une entrée vide ou illisible, et la position est CONSERVÉE :
--    `['10','','12']` rend `{10,NULL,12}`, pas `{10,12}`. Décaler les valeurs
--    ferait lire la troisième série à la place de la deuxième.
CREATE OR REPLACE FUNCTION ff_reps_by_set(v text[]) RETURNS numeric[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN v IS NULL THEN NULL
                ELSE (SELECT array_agg(ff_num(x) ORDER BY o)
                        FROM unnest(v) WITH ORDINALITY AS t(x, o)) END
$$;

CREATE OR REPLACE FUNCTION ff_charge_by_set(v text[]) RETURNS numeric[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN v IS NULL THEN NULL
                ELSE (SELECT array_agg(ff_charge(x) ORDER BY o)
                        FROM unnest(v) WITH ORDINALITY AS t(x, o)) END
$$;

COMMIT;
