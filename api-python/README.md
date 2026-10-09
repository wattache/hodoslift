# brokkr

Le forgeron. **L'API de French Forge Trainer** — FastAPI sur Cloud Run, Postgres
sur Neon. C'est la source de vérité des données ; le front ([`eitri`](../eitri))
ne parle qu'à lui.

> Nommé d'après le nain qui forgea Mjöllnir : il prend la matière brute (le
> payload client) et la façonne avant qu'elle n'entre en base.

## Ce que c'est, en trois phrases

- **Toutes les lectures et toutes les écritures** passent ici. Firestore ne sert
  plus à rien depuis le 20/08/2026 — sauf **Firebase Auth**, qui émet les jetons
  que brokkr vérifie.
- Les données vivent dans **Postgres** (Neon, `europe-central`) : athlètes,
  programmes et l'arbre d'entraînement complet, compétitions, bibliothèque,
  bilans kiné, journaux. Le schéma de référence est
  [`docs/postgres-schema.sql`](docs/postgres-schema.sql) ; sa carte par domaine,
  [`docs/carte-de-brokkr.html`](docs/carte-de-brokkr.html), s'ouvre dans un
  navigateur et se régénère par `make carte`.
- Le **contrat** est [`docs/openapi.json`](docs/openapi.json), exporté du code et
  vérifié par `make contrat`, que `make deploy` joue. Le front en génère ses types.

## Stack

FastAPI · Pydantic v2 · SQLAlchemy 2 (sync, psycopg 3) · Firebase Admin (auth
seulement) · Sentry · Python 3.12 · Cloud Run. Dépendances gérées par
[uv](https://docs.astral.sh/uv/) (`pyproject.toml` + `uv.lock`).

## Domaines

| Préfixe | Domaine | Qui |
|---|---|---|
| `/users`, `/whoami` | comptes, rôles (coach, kiné, admin), rattachement d'un athlète à son compte | authentifié ; admin pour les rôles |
| `/athletes` | fiches, profil, `mine`/`suivis`, signalements, journaux de forme, objectifs, PR, suivi (tracking) | staff de l'athlète ou l'athlète |
| `/programs/{id}/…` | l'arbre d'entraînement — macros, blocs, semaines, séances, lignes, BASE, objectifs | coach ou kiné de l'athlète ; l'athlète écrit son réalisé |
| `/competitions` | compétitions, participants, essais, disponibilités des coachs ; le score et le RIS sont **dérivés** (vue `competition_scores`) | coachs ; lecture pour les participants |
| `/library`, `/weight-categories`, `/kines` | référentiels | membres du club |
| `/coach-profiles` | la page publique d'un coach (site vitrine) | public en lecture, le coach en écriture |
| `/bilan-modeles`, `/athletes/{id}/bilans` | le bilan kiné — modèles composés par la kiné, instantanés par athlète | **kiné et athlète seulement** : le coach est exclu du médical |
| `/health`, `/health/db` | sondes ; `/health` porte le SHA déployé | public |

La liste exacte est dans l'OpenAPI (`make dev` → <http://localhost:8080/docs>).

## Où vit le code

`app/` est rangé par DOMAINE. Dans chaque paquet : `routes_*.py` (les routeurs
FastAPI), `schemas_*.py` (les modèles Pydantic du contrat), et les modules de
règles, sans préfixe.

| Paquet | Ce qu'il porte |
|---|---|
| `app/socle/` | ce que tous partagent : config, base, auth, autorisation (`authz`, `perimetre`, `structures`), erreurs, audit, observabilité, `/health` |
| `app/entrainement/` | l'arbre d'entraînement : lecture (`training_tree`), création, génération de semaine, prescription, relecture, records |
| `app/suivi/` | tracking, PR, journaux de forme, guichet du coach |
| `app/competitions/` | compétitions, catégories de poids, score |
| `app/kine/` | bilans, modèles de bilan, médias, notes, répertoire des kinés |
| `app/personnes/` | comptes, fiches athlète, profils, pages de coach, calendrier |
| `app/objectifs/` | objectifs d'athlète et objectifs techniques |
| `app/bibliotheque/` | la bibliothèque d'exercices |

Un domaine importe le socle, et peut importer un AUTRE domaine (`suivi` lit
`entrainement.records`) ; le socle n'importe aucun domaine.

## Autorisation

Le client envoie `Authorization: Bearer <ID token Firebase>`. brokkr le vérifie
(`verify_id_token`), puis **résout les rôles en base** — c'est `app/socle/authz.py`, et
nulle part ailleurs :

- `require_membre` : un compte Google valide ne prouve rien ; il faut une ligne
  `coaches`, `kines`, `athletes.user_uid` ou `users.is_admin` ;
- `require_athlete_access(mode)` / `require_program_access(mode)` : le coach
  gérant, le kiné qui suit l'athlète, l'athlète lié — selon le mode de la route ;
- `require_kine` : la composition des bilans est un acte de praticien, sans
  porte dérobée pour le coach ni l'admin.

Les erreurs ont **une seule forme**, `{code, detail, status}`, avec un
vocabulaire clos (`app/socle/erreurs.py`) — y compris les 500, qui passent sous CORS.

## Dev local

```bash
make install   # uv sync
make dev       # http://localhost:8080 — uvicorn --reload
```

⚠️ **`.env` pointe sur Neon, c'est-à-dire la PRODUCTION.** C'est voulu : l'API
locale travaille sur les vraies données. Pour une copie jetable, le harnais
e2e-réel monte un bac à sable (`forge/scripts/e2e-reel.sh`, conteneur
`ff-training` sur le port 55433).

`make dev` prend la clé du SA brokkr si Terraform l'a écrite dans
`.secrets/brokkr-sa.json` (repo `nidavellir`), sinon l'ADC gcloud. La clé est
gitignorée ; la prod n'en utilise pas (SA attaché au service).

## Scripts

Tous dans `scripts/`, tous en **dry-run par défaut**. Et depuis FRE-89, **une
écriture hors d'une base locale exige `--production`** (`scripts/_cible.py`) :
un `--commit` tapé par réflexe depuis ce dossier ne peut plus toucher Neon.

| Script | Rôle |
|---|---|
| `delete_athlete` | supprime un athlète et compte d'abord **toute** la cascade, lue dans `pg_constraint` |
| `renumber_training_tree` | recompacte les numéros de macro/bloc/semaine |
| `semer_modele_bilan` | le semis du modèle de bilan |
| `etl_training_sets` | la projection analytics `training_sets` — **job nocturne Cloud Run**, hors garde-fou (cf. `docs/analytics.md`) |
| `verifier_*` | lectures de contrôle : contrats, arbre, tracking, `verifier_schema` (= `make schema-verifier`) et `verifier_invariants` (= `make invariants`) |
| `seed_e2e.sql`, `seed_e2e_auth` | le terrain de jeu du harnais e2e-réel |
| `exporter_openapi` | `make openapi` |

## Tests

```bash
make test      # pytest, couverture exigée ≥ 90 %
```

Une partie de la suite tourne contre un **vrai Postgres 16** en conteneur
(testcontainers, Docker requis), construit depuis `docs/postgres-schema.sql`.
Deux gardes tiennent ce fichier honnête : `tests/test_schema_reference.py` (toute
table interrogée par le code y est déclarée — en CI) et `make schema-verifier`
(le fichier décrit bien Neon — à jouer avant tout déploiement qui touche au
schéma).

⚠️ Ces deux gardes ne regardent que la **forme** : des noms de tables, de vues et
de colonnes. Ni contraintes, ni index, ni `ON DELETE` — c'est FRE-133.

Le **contenu**, lui, est gardé par `make invariants`
(`scripts/verifier_invariants.py`, lecture seule) : il vérifie sur la vraie base
les affirmations que les commentaires du code portent — « un groupe a toujours
sa nature », « un record se tient sur un lift de compétition », « le coach d'un
programme est celui de son athlète ». **La règle qui va avec : un commentaire
qui affirme un état de la donnée cite l'invariant qui le garde, et c'est
l'invariant qui fait foi.** Sans ça, l'affirmation est un test qu'on n'a pas
écrit, et elle se périme sans bruit (FRE-143).

`tests/test_invariants.py` vérifie le vérificateur : chaque requête s'exécute,
rend zéro sur une base saine, et **voit une violation qu'on plante exprès**.

Les migrations sont des fichiers datés dans `docs/migrations/`, appliqués **à la
main** sur Neon (`psql -v ON_ERROR_STOP=1`), puis reportés dans le schéma de
référence. Il n'y a pas d'outil de migration : un environnement neuf se crée
depuis le fichier de référence, pas en rejouant la série.

## Déploiement (manuel)

```bash
make build     # image taguée par le SHA du commit — refuse un arbre sale
make deploy    # Cloud Run europe-west4, puis `make verifier` : la prod sert-elle ce SHA ?
```

`make deploy SHA=abc1234` redéploie une version connue. Le service est
`--allow-unauthenticated` côté Cloud Run : l'auth est applicative, sur chaque
route. Les variables DB (`DB_*` + secret) sont posées par Terraform
(`nidavellir/brokkr.tf`) ; `deploy` ne les écrase pas (`--update-env-vars`).

## Observabilité

Logs JSON structurés avec `requestId` (= trace Cloud Run) et un journal d'audit
des écritures (`app/socle/audit.py`). Sentry pour les exceptions, avec masquage des
identifiants et valeurs personnelles avant envoi (`app/socle/observabilite.py`) ; la
version reportée est le SHA déployé.
