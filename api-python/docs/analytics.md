# Analytics — explorer la donnée avec Metabase

Pile : la table plate **`training_sets`** (projection de l'arbre d'entraînement)
+ les tables de domaine déjà en Postgres (athletes, daily_logs, athlete_goals,
competitions…) → **Metabase en local**, qui se branche dessus en lecture seule.
Aucun code de dashboard à écrire : on clique les questions et les graphes.

## 1. Rafraîchir la projection

`training_sets` est **dérivée de l'arbre d'entraînement Postgres** (plus de
Firestore depuis le 17/08/2026) : un `INSERT … SELECT` la reconstruit
intégralement (DELETE + INSERT, une transaction), donc re-jouable sans risque.

Elle est rafraîchie **chaque nuit** par le job Cloud Run
`training-analytics-refresh` (`nidavellir/analytics.tf`, 03:30 Paris). À la
main, contre la base du `.env` :

```bash
cd brokkr
uv run python -m scripts.etl_training_sets            # dry-run : mesure ce qui serait écrit
uv run python -m scripts.etl_training_sets --apply    # ~10 000 lignes, quelques secondes
```

⚠️ Ce script est le seul à ne pas porter le garde-fou `--production` de
`scripts/_cible.py` : le job nocturne écrit en production par construction.

## 2. ⚠️ Le rôle `analytics_ro` a été SUPPRIMÉ (27/08/2026)

Cette page décrivait un rôle « lecture seule » et affirmait que Metabase ne
pouvait **jamais** écrire. C'était faux : mesuré le 27/08, `analytics_ro`
pouvait `INSERT`, `UPDATE` et `DELETE` sur `training_exercises`.

Les `GRANT SELECT` documentés ici n'étaient pas en cause — ils n'avaient même
jamais été posés. Le rôle héritait de tout via son appartenance à
`neon_superuser`, que Neon attribue à tout rôle créé. La garantie n'a pas été
perdue : elle n'a jamais existé (FRE-112).

Metabase ayant été abandonné après un essai fin juillet, le rôle a été retiré de
`nidavellir/neon.tf` plutôt que réparé — un rôle privilégié qui ne sert à
personne ne se sécurise pas, il se supprime.

⚠️ **Si un outil BI revient**, ne pas rejouer la recette ci-dessous : tout
`neon_role` héritera de `neon_superuser` de la même façon. Le seul contrôle qui
vaille est `has_table_privilege('<rôle>','training_exercises','DELETE')`, qui
doit rendre **faux** — la propriété se vérifie contre la base, elle ne
s'affirme pas en commentaire.

Les sections suivantes gardent leur valeur comme référence SQL (le modèle, les
pièges de graphe, les requêtes prêtes à coller), mais la connexion décrite ne
fonctionne plus.

## 3. Lancer Metabase

```bash
docker run -d --name metabase -p 3000:3000 metabase/metabase
```

Puis <http://localhost:3000> → créer un compte admin local → **Add a database** :

| Champ | Valeur |
|---|---|
| Type | PostgreSQL |
| Host | l'endpoint **pooler** Neon (`terraform output db_host`) |
| Port | 5432 |
| Database | `french_forge_trainer` |
| Username | ~~`analytics_ro`~~ — supprimé, cf. §2 |
| Password | ~~`terraform output -raw analytics_password`~~ |
| SSL | **activé** (obligatoire chez Neon) |

Le conteneur garde son état ; `docker stop metabase` / `docker start metabase`
pour le retrouver avec ses dashboards.

## 4. Le modèle en deux mots

`training_sets` = **une ligne par exercice d'une séance** (pas par série).

- `athlete_id` → joint `athletes.legacy_id` (prénom/nom, coach, 1RM)
- `session_date` → date réelle si l'athlète a lancé la séance, sinon début de
  semaine ; `date_exact` distingue les deux (à filtrer si on veut du précis)
- `weight_kg` NULL + `bodyweight` true = série au poids du corps ("PDC")
- `reps` = borne **basse** si le coach a prescrit une plage ("8-10" → 8, avec
  `reps_high` = 10) ; `reps_done` = ce qui a réellement été fait
- `felt_rpe` NULL mais `felt_rpe_raw` rempli = saisie non numérique ("FAIL",
  "Sub5")
- `tonnage_kg` = sets × reps effectives × charge (NULL si une pièce manque)
- `exercise_id` → la ligne `training_exercises` d'origine (`ON DELETE CASCADE` :
  la projection suit les suppressions de l'arbre)

## 5. Faire un graphe (les 2 pièges)

**Le sélecteur est caché** : après avoir lancé la requête, le bouton
**`Visualization`** est en **bas à gauche**, sous les résultats. Sans clic
dessus, on reste en mode tableau — c'est le piège n°1 de Metabase.

**Metabase choisit le graphe d'après les TYPES renvoyés.** Il lui faut au moins
une *dimension* (date ou texte) et une *mesure* (numérique) :

- axe temporel → renvoyer une **vraie date** : `date_trunc('week', session_date)::date`.
  Un `to_char(...)` renvoie du **texte** → pas de courbe possible.
- une seule ligne de résultat → seuls « Number » / « Trend » sont proposés.
- pour comparer des athlètes sur un même graphe : 3 colonnes
  (date, série, valeur) puis *Visualization → Line*, et Metabase propose de
  découper par la colonne texte.

## 6. Filtres (sélecteur athlète, exercice…)

Dans une requête SQL, `{{ma_variable}}` crée un widget de filtre. Pour une vraie
**liste déroulante**, il faut le type **Field Filter** :

1. écrire la condition entre crochets doubles — `[[AND {{athlete}}]]` : les
   `[[ ]]` la rendent **optionnelle** (sans sélection = pas de filtre du tout) ;
2. panneau de droite (icône ⚙/variables) → **Variable type: Field Filter** ;
3. **Field to map to** → `Athletes` › `First Name` (ou `Training Sets` › `Exercise`) ;
4. **Filter widget type** → `String` ; cocher *Filter widget* pour l'afficher.

⚠️ Piège 1 : un Field Filter remplace **toute la condition**, pas seulement la
valeur. On écrit `AND {{athlete}}` — **jamais** `AND a.first_name = {{athlete}}`
(Metabase génère lui-même le `first_name IN (…)`).

⚠️ Piège 2 : **ne pas aliaser** les tables filtrées. Metabase écrit
`athletes.first_name IN (…)` avec le nom RÉEL de la table ; si la requête dit
`FROM athletes a`, Postgres répond *« invalid reference to FROM-clause entry for
table "athletes" »*. Donc `FROM training_sets JOIN athletes ON …` et des
colonnes préfixées en toutes lettres (cf. la requête à sélecteurs ci-dessous).

Si le widget affiche un champ texte au lieu d'une liste : *Admin* → *Table
Metadata* → la table → le champ → **Filtering on this field: A list of all
values** (les 93 exercices et 46 prénoms passent sous le seuil de Metabase).

Une fois la question enregistrée dans un **dashboard**, les mêmes filtres se
posent au niveau du tableau de bord et pilotent plusieurs graphes à la fois.

## Requêtes prêtes à coller (déjà typées pour les graphes)

```sql
-- COURBE : tonnage par semaine (Visualization → Line ou Bar)
SELECT date_trunc('week', session_date)::date AS semaine,
       round(sum(tonnage_kg))                 AS tonnage_kg,
       count(*)                               AS exercices
FROM training_sets
WHERE session_date IS NOT NULL AND tonnage_kg IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- COURBES MULTIPLES : progression de la charge max par athlète sur un lift
-- (Visualization → Line, puis « Series » = athlete)
SELECT date_trunc('week', t.session_date)::date AS semaine,
       a.first_name                             AS athlete,
       max(t.weight_kg)                         AS charge_max_kg
FROM training_sets t JOIN athletes a ON a.legacy_id = t.athlete_id
WHERE t.exercise = 'SQUAT' AND t.weight_kg IS NOT NULL
  AND t.session_date IS NOT NULL
GROUP BY 1,2 ORDER BY 1,2;

-- LA MÊME, AVEC SÉLECTEURS athlète + exercice (cf. § Filtres).
-- NOTER : aucune table n'est aliasée — obligatoire avec les Field Filters.
SELECT date_trunc('week', training_sets.session_date)::date AS semaine,
       athletes.first_name                                  AS athlete,
       max(training_sets.weight_kg)                         AS charge_max_kg
FROM training_sets JOIN athletes ON athletes.legacy_id = training_sets.athlete_id
WHERE training_sets.weight_kg IS NOT NULL
  AND training_sets.session_date IS NOT NULL
  [[AND {{athlete}}]]
  [[AND {{exercice}}]]
GROUP BY 1,2 ORDER BY 1,2;

-- BARRES : calibrage prescrit vs ressenti, par athlète (Visualization → Bar)
SELECT a.first_name                              AS athlete,
       round(avg(t.aimed_rpe),1)                 AS rpe_prescrit,
       round(avg(t.felt_rpe),1)                  AS rpe_ressenti
FROM training_sets t JOIN athletes a ON a.legacy_id = t.athlete_id
WHERE t.felt_rpe IS NOT NULL AND t.aimed_rpe IS NOT NULL
GROUP BY 1 HAVING count(*) >= 50 ORDER BY 1;

-- NUAGE DE POINTS : charge vs RPE ressenti sur un lift (Visualization → Scatter)
SELECT weight_kg AS charge_kg, felt_rpe AS rpe, reps
FROM training_sets
WHERE exercise = 'SQUAT' AND weight_kg IS NOT NULL AND felt_rpe IS NOT NULL;

-- BARRES : le bloc monte-t-il en charge, semaine après semaine ?
SELECT week_number AS semaine_du_bloc, round(sum(tonnage_kg)) AS tonnage_kg
FROM training_sets
WHERE tonnage_kg IS NOT NULL AND block_number IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- TABLE : assiduité — exos prescrits vs réellement notés, par athlète
SELECT a.first_name          AS athlete,
       count(*)              AS prescrits,
       count(t.felt_rpe)     AS notes,
       round(100.0 * count(t.felt_rpe) / count(*)) AS taux_pct
FROM training_sets t JOIN athletes a ON a.legacy_id = t.athlete_id
GROUP BY 1 ORDER BY taux_pct DESC;
```
