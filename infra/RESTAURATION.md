# Restaurer un dump Postgres

> **Éprouvée le 2026-08-27** sur `french_forge_trainer_20260827_081038.dump`
> (FRE-82). Avant cette date la procédure n'existait qu'en commentaire dans
> `backup.tf`, et personne ne l'avait jamais jouée.

## Les chiffres mesurés

| | |
|---|---|
| taille d'un dump `-Fc` | **1,6 Mo** |
| téléchargement depuis GCS | **~2 s** |
| `pg_restore` | **459 ms** |
| base reconstituée | 19 Mo · 37 tables · 31 714 lignes |
| dumps disponibles | 322, horaires, rétention 90 j |

Une restauration complète tient donc en **moins d'une minute**, temps de
réflexion non compris. Ce n'est pas le temps de restauration qui coûte, c'est la
perte : au pire l'**intervalle entre deux dumps**, soit une heure.

## ⚠️ Le piège : créer le rôle `brokkr` AVANT

C'est le seul écart entre une restauration propre et une restauration ratée en
silence, et il ne se voit pas si on ne le cherche pas.

Les 122 objets du dump appartiennent à `brokkr`. Sur une cible où ce rôle
n'existe pas, `pg_restore` échoue sur **chaque** instruction de propriété et de
privilège — **56 erreurs**, toutes « role does not exist » — puis **rend la main
normalement**. La donnée est là, complète et juste. Mais plus rien ne lui
appartient, `brokkr` n'a aucun droit, et l'application ne peut plus lire sa
propre base.

Mesuré des deux façons, sur le même dump :

| | erreurs | tables possédées par `brokkr` | droits de `brokkr` |
|---|---|---|---|
| sans créer le rôle | **56** | 0 | 0 |
| en le créant d'abord | **1** | 37 | 266 |

## La procédure

```bash
# 1. le dump voulu (le dernier, ou celui d'avant l'incident)
gcloud storage ls gs://french-forge-600-db-backups/ | tail -5
gcloud storage cp gs://french-forge-600-db-backups/<fichier>.dump /tmp/

# 2. LE RÔLE D'ABORD — sinon la propriété et les droits sont perdus en silence
psql "$CIBLE_ADMIN" -c "CREATE ROLE brokkr LOGIN PASSWORD '<mot de passe>';"

# 3. la restauration
pg_restore -d "$CIBLE" --clean --if-exists /tmp/<fichier>.dump
```

Sur Neon, viser le host **DIRECT**, pas le pooler : pgbouncer en mode transaction
casse les sessions de restauration comme il casse celles de `pg_dump`.

## Vérifier — les trois contrôles, dans cet ordre

**1. Une seule erreur, et c'est laquelle.** `pg_restore` doit signaler
`errors ignored on restore: 1`, portant sur la vue `competition_scores` :

```
ERROR: type "public.gender" does not exist  → CREATE OR REPLACE VIEW public.competition_scores
```

⚠️ **Celle-là est BÉNIGNE, et il faut savoir la reconnaître pour ne pas prendre
l'habitude d'ignorer les erreurs.** `pg_dump` émet les vues en deux passes : une
ébauche avec des `NULL::type` en tête de fichier, puis la vraie définition. Ici
l'ébauche tombe parce que l'enum `gender` n'est pas encore créé — et la seconde
passe, elle, réussit. Vérification : `SELECT count(*) FROM competition_scores`
doit rendre des lignes (23 au 27/08). **Toute autre erreur est un vrai problème.**

**2. Le schéma est conforme à sa référence.** C'est le contrôle qui vaut le plus
pour le moins d'effort — il compare tables, vues, enums et colonnes :

```bash
DATABASE_URL="$CIBLE" python brokkr/scripts/verifier_schema.py
# [schéma] OK — 37 tables, 1 vue(s), 7 enums, colonnes comprises
```

**3. La propriété est revenue.** Le contrôle qui attrape le piège ci-dessus :

```sql
SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner='brokkr';  -- 37
```

## Ce que le dump ne contient PAS

Un dump `-Fc` d'une seule base ne porte ni les rôles, ni leurs mots de passe, ni
leurs appartenances — tout cela vit au niveau du **cluster**, donc chez Neon.
Une reconstruction complète après perte du projet Neon demande donc, en plus du
dump : recréer `brokkr` (mot de passe dans Secret Manager, `brokkr-db-password`)
et `analytics_ro`, puis `terraform apply`.

⚠️ **`analytics_ro` n'est pas en lecture seule**, contrairement à ce
qu'annoncent `neon.tf` et le README — Neon rend tout rôle membre de
`neon_superuser`, dont il hérite `INSERT`/`UPDATE`/`DELETE`. Constaté le 27/08,
ticket ouvert. Ne pas reproduire l'hypothèse en restaurant.

## Répéter l'exercice sans risque

La restauration se joue dans un conteneur jetable — **jamais dans `ff-training`**,
qui porte le bac à sable du harnais e2e :

```bash
docker run -d --name ff-restore-drill -e POSTGRES_PASSWORD=drill \
  -e POSTGRES_DB=ff_restore -p 55439:5432 postgres:16
```

⚠️ **Le dump porte des données de santé de vrais athlètes** — noms, mesures,
antécédents, bilans kiné. Le supprimer et détruire le conteneur dès l'exercice
terminé, et ne jamais le laisser traîner dans un dossier de travail.
