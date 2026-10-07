# hodos

Le dépôt de **Hodos** (French Forge Trainer) : le produit entier, au même
endroit, et le seul d'où l'on déploie. Les anciens dépôts (`eitri`, `brokkr`,
`nidavellir`, et `forge` pour l'outillage) sont figés depuis le 05/10/2026 :
rien ne s'y écrit ni ne s'en déploie plus.

Les dossiers portent leur rôle : `web/` ← `eitri`, `api-python/` ← `brokkr`,
`infra/` ← `nidavellir`. `api/` et `proto/` portent l'API Go, en sommeil.

| dossier | ce qu'il est | vérifier | déployer |
|---|---|---|---|
| `web/` | le front (React, TanStack Query), sur Firebase Hosting — `trainer.french-forge.com` | `npx tsc -b`, `npm test`, `npm run test:e2e` | `make hosting` |
| `api-python/` | l'API Python (FastAPI, Postgres chez Neon), sur Cloud Run (service `brokkr`) | `make test`, `make invariants`, `make contrat` | `make deploy` |
| `api/` | l'API en **Go + Connect + sqlc**, EN SOMMEIL : ni déployée, ni lue par le front, ni dans le harnais | `make test`, `make lint` | — |
| `proto/` | le contrat de l'API Go (buf), engendré dans `api/gen/` | `make contrat` à la racine | — |
| `infra/` | l'infrastructure (Terraform : GCP, Neon, Scaleway) | `terraform fmt`, `validate` | `terraform apply` |
| la racine | l'outillage commun : `Makefile`, `mprocs*.yaml`, `compose.yaml`, `scripts/e2e-reel.sh`, `seeds/` | `make livrer` joue tout, dans l'ordre | — |

Les commandes du quotidien n'ont pas changé : `make dev`, `make dev-local`,
`make livrer` à la racine ; `make -C api-python …`, `cd web && npm …` pour un
dossier seul. Un seul `.gitignore`, à la racine, où chaque règle porte son
dossier.

## Une version par dossier

Front et serveur se déploient séparément, chacun avec sa version — et la
version d'un service est **le SHA du dernier commit qui touche son dossier**
(`git log -1 --format=%h -- .`), pas la tête du dépôt. Sans ça, un commit du
front seul changerait la version attendue du serveur, et `make -C api-python
verifier` dirait la production périmée.

Même règle pour le garde-fou « un arbre modifié ne se publie pas » : chacun ne
regarde que son dossier (`git status --porcelain -- .`). Un fichier modifié
dans `api-python/` ne bloque pas `make -C web hosting`.

| où | ce qui porte la règle |
|---|---|
| `cloudrun.mk` | `SHA ?=` des deux API (le `?=` garde le retour arrière : `make deploy SHA=abc1234`) et le refus d'un arbre modifié ; `scaleway.mk` en est le jumeau pour le déménagement |
| `web/scripts/version.mjs` | la source unique de la version du front (`VITE_GIT_SHA`, cache du service worker, release Sentry) |
| `web/Makefile` | `REFUSER_ARBRE_SALE` |

⚠️ **Au premier déploiement depuis ici, la version change de forme** : la
production sert encore le SHA de l'ancien dépôt, `verifier` la dira périmée tant
que le premier `make livrer` n'est pas passé. C'est attendu.

## Mettre en production depuis hodos (la première fois)

⚠️ **L'ÉTAT TERRAFORM EST CELUI DE L'ANCIEN `nidavellir`** (même backend GCS).
L'infrastructure ne s'applique plus que d'ici : un `apply` depuis l'ancien dépôt
détruirait ce qu'il ne connaît pas (le registre et la base Scaleway).

La production depuis hodos est la MÊME qu'avant, sur GCP : api-python sur le
service Cloud Run `brokkr` (même nom, même URL), le front sur Firebase Hosting,
la base chez Neon, les photos de coachs dans le seau GCS. Aucun `apply` n'est
nécessaire pour la livrer : `make livrer` à la racine — harnais réel, puis
api-python, puis le front.

Les clés VAPID ne se tapent plus : la publique est une constante (`push.tf`), la
privée se lit dans Secret Manager.

## La base Postgres de Scaleway (FRE-213)

`infra/scaleway_postgres.tf` crée la base `hodos` à Paris, à côté de Neon, que
les API lisent toujours. Ce n'est pas du HDS : le périmètre HDS de Scaleway ne
couvre pas le Postgres managé (Neon non plus).

1. `scaleway_postgres_ips_autorisees` dans `infra/terraform.tfvars` : ton
   adresse (`curl -s https://api.ipify.org`), suffixée `/32`. Sans elle, le
   `plan` s'arrête.
2. `terraform apply` dans `infra/`.
3. La recopie : `./scripts/copier_la_base_vers_scaleway.sh`. Les mots de passe
   se lisent dans Secret Manager (`hodos-db-password`, `hodos-app-db-password`),
   jamais en sortie Terraform.

## Le déménagement chez Scaleway, plus tard

Tout est écrit et éprouvé, en sommeil (`infra/scaleway_applicatif.tf`,
`scaleway.mk`, `web/Caddyfile`, `web/Dockerfile`) : trois conteneurs derrière
une seule origine — `web` (Caddy) sert le front et route `/api/…` vers
api-python, `/__/…` vers Firebase (et `/hodos.…` vers l'api Go, le jour où
elle se réveille) —, une base Postgres
16 managée et un réseau privé. Pas de CORS : le navigateur ne voit qu'une
origine. Le domaine `hodos-trainer.com`, acheté chez Scaleway, se pose par
`-var domaine_hodos=hodos-trainer.com` (un ALIAS au nu du domaine).

Le jour venu : `-var pile_scaleway=true`, les images (`make -C … build` en visant
`scaleway.mk`), puis la base — d'abord Neon (`base_scaleway = "neon"`, le
défaut), ensuite la recopie (`scripts/copier_la_base_vers_scaleway.sh`, qui
prouve lignes, droits et bornes) et `base_scaleway = "scaleway"`. Les photos
de coachs passent alors dans le seau public Scaleway
(`scripts/copier_les_photos_vers_scaleway.py`), avec api-python et le site
vitrine. Côté Google,
trois réglages à la main pour le nouveau domaine : domaines autorisés Firebase,
origine JavaScript et URI de redirection `/__/auth/handler` du client OAuth.

## L'API Go, en sommeil

proto + Connect + Go + sqlc, en strangler : `api/` sert la bibliothèque, que
api-python sert toujours (`/library`). Rien ne l'appelle aujourd'hui : ni le
front, ni `make livrer`, ni le harnais réel. Le code reste compilable
(`make -C api test`, `make contrat`). Pour la réveiller : le client Connect du
front, le service `api` (Cloud Run ou Scaleway), l'étape dans `make livrer`, et
l'oracle (`scripts/oracle_bibliotheque.py`) dans le harnais réel, qui compare
ses réponses à celles d'api-python.

## Démarrer

```bash
make dev            # web et api-python sous mprocs
make bac-a-sable    # le Postgres local (:55433), et attend qu'il réponde
```

⚠️ **Sous `mprocs`, le front parle au brokkr d'à côté** : `VITE_BROKKR_URL` y est
surchargée sur `localhost:8080`. Lancé seul (`make web`), il retrouve son
`.env.local` et parle à la **production** — c'est voulu, on travaille souvent le
front sans monter le back.

## Le bac à sable

Un Postgres 16 dans Docker, port **55433**, base `ff`, volume `ff-training-data`.
C'est lui que le harnais e2e réel exige : `scripts/e2e-reel.sh` s'arrête
net s'il ne répond pas.

⚠️ **Le volume est `external` dans `compose.yaml`**, et il faut le savoir avant
de toucher au fichier : il porte les données semées en août. Le déclarer
autrement ferait créer un volume neuf et vide au premier `up` — décrire
l'existant en le détruisant.

Sur une machine neuve, `make bac-a-sable` crée le volume de lui-même.

### Le remplir

```bash
make bac-a-sable-remplir    # ⚠️ recopie la PRODUCTION
```

⚠️ **Ce sont de vraies données** : noms, mesures, antécédents, bilans kiné.
Décision assumée (28/08/2026) — le réalisme sert à écrire des tests depuis ce que
font vraiment les coachs, et c'est ce qui a permis de trouver les cas tordus que
personne n'imagine.

Ce que la cible garantit :

- la production n'est ouverte qu'en **LECTURE** (`pg_dump`, rien d'autre) ;
- le rôle `brokkr` est créé **AVANT** la restauration — sans lui, `pg_restore`
  produit 56 erreurs « role does not exist » **puis rend la main normalement** :
  la donnée est là, mais plus rien ne lui appartient (cf.
  `infra/RESTAURATION.md`) ;
- le dump local est supprimé aussitôt.

## Les harnais

Il y en a quatre, et ils ne se remplacent pas :

| | où | ce qu'il voit |
|---|---|---|
| **1 156** | `brokkr` — pytest + testcontainers | le serveur, jusqu'à Postgres |
| **211** | `eitri` — vitest | la logique pure, **et le rendu** (`.test.tsx`) |
| **107** | `web/e2e` — Playwright sur la maquette | l'écran, écritures en no-op |
| **51** | `web/e2e-reel` — Playwright sur la pile réelle | navigateur → brokkr → Postgres |

```bash
./scripts/e2e-reel.sh          # tout
./scripts/e2e-reel.sh amrap    # en filtrant
./scripts/e2e-reel.sh --arret  # éteindre
```

Le runner et les seeds vivent **ici** ; les specs restent dans
`web/e2e-reel/`, puisque ce sont des tests du front et que c'est la config
Playwright d'eitri qui les joue.

⚠️ **Le script ne rend pas la main dans un pipe.** Il laisse les services debout
en sortant (démarrés détachés) ; un `| grep` maintient le descripteur ouvert et
donne l'illusion d'un blocage. Le verdict est dans
`web/test-results/.last-run.json`.

**`brokkr-e2e` tourne avec `--reload`** depuis le 28/08. Il servait auparavant le
code de son démarrage : le script réutilise un processus déjà debout, donc
relancer après un correctif serveur validait la version d'avant. Rencontré le
17/08 — un correctif passe alors pour vérifié sans l'être, ce qui est pire que
pas de test du tout.

⚠️ **La règle de la maison : « vu rouge ».** Une spec ne compte que si on l'a
vue échouer sur le défaut qu'elle prétend garder. Écrite verte, elle ne prouve
rien — plusieurs l'ont démontré, dont une qui assertait sur un appel réseau que
son propre harnais bouchonnait.

## Pas de CI, et c'est délibéré

Un seul développeur, qui ne lirait pas les rapports. Les suites tournent à la
demande, avant de déployer.

Les deux `.github/workflows/ci.yml` (brokkr, eitri) ont été retirés le
09/09/2026 (FRE-142) : ils contredisaient cette règle, et personne ne les lisait.
Ce que celui de brokkr vérifiait — le contrat OpenAPI — vit dans `make contrat`,
que `make deploy` joue.

## Déployer

Manuellement, jamais automatiquement.

```bash
make livrer                 # harnais réel, puis api-python, puis web — jamais l'inverse
```

Ou, un dossier seul : `make -C api-python build deploy`, `make -C web hosting`.

La version est le **SHA du dernier commit du dossier**, et elle se vérifie
après coup — `/health` côté API, `sw.js` côté front.
