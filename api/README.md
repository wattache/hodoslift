# sindri

Le frère de brokkr : **le même produit, en Go, servi en Connect**. Il naît
domaine par domaine — la bibliothèque d'abord — et brokkr garde le reste tant
que ce n'est pas repris. Les deux tournent côte à côte, sur la même base, avec
la même identité.

> Sindri est le frère de Brokkr, l'autre nain qui forgea Mjöllnir.

| | |
|---|---|
| contrat | `proto/` à la racine (`buf`), engendré ici dans `gen/` et chez eitri dans `src/gen/` |
| requêtes | `internal/db/queries/*.sql`, engendrées par `sqlc` depuis le schéma de brokkr (`docs/postgres-schema.sql`) |
| socle | `internal/socle/` : config, pool, auth Firebase, autorisation, erreurs, journal, audit, Sentry, CORS, santé |
| domaines | `internal/<domaine>/service.go` + `service_test.go` |

```bash
make dev        # :8081, sur la base du .env de brokkr
make test       # Postgres 16 jetable (Docker), le schéma de brokkr appliqué tel quel
make gen        # après un changement de proto/ ou des requêtes SQL
```

Ce qui vaut ici comme chez brokkr : la version est le SHA du dernier commit du
dossier, un arbre modifié ne se construit pas pour la prod, le déploiement est
manuel (`make build`, `make deploy`, et `make livrer` à la racine enchaîne dans
l'ordre : brokkr, sindri, eitri).

## Les erreurs

Une seule forme, la même que brokkr : le code Connect classe (`not_found`,
`already_exists`, `permission_denied`…), et le détail `hodos.socle.v1.Erreur`
porte le mot du vocabulaire métier (`entree_introuvable`, `reserve_aux_coachs`…)
qu'eitri traduit à l'écran. Le vocabulaire est clos (`socle.Codes`) : un code
inventé panique au premier appel.

## Un RPC par geste

Pas de PATCH : renommer, marquer, définir les soutiens sont trois messages.
Le tri-état par champ (absent / null / valeur) qui a coûté FRE-157 et FRE-185
n'a plus de représentation.
