# nidavellir

Infrastructure-as-code du projet GCP `french-forge-600` (Terraform), plus la
base Postgres chez Neon.

> Niðavellir : le royaume des nains forgerons dans la mythologie nordique —
> là où vivent et sont provisionnés les services-forgerons (à commencer par
> [`brokkr`](../brokkr)).

## Périmètre

| Fichier | Ressources |
|---|---|
| `main.tf` | provider Google, APIs, **backend GCS** du state |
| `artifact_registry.tf` | dépôt Docker `french-forge-trainer` (l'image brokkr ; le front n'a plus d'image) |
| `brokkr.tf` | SA + service Cloud Run de l'API `brokkr`, ses variables d'environnement (DB, Sentry), la clé SA pour le dev local |
| `neon.tf` | projet Neon, base, rôle applicatif `brokkr` (mot de passe → Secret Manager) |
| `backup.tf` | `pg_dump` **horaire** de Neon vers `gs://french-forge-600-db-backups` (rétention 90 j), par un job Cloud Run + Cloud Scheduler |
| `analytics.tf` | job Cloud Run nocturne `training-analytics-refresh` (projection `training_sets`, cf. `brokkr/docs/analytics.md`) |
| `monitoring.tf` | métriques sur les logs d'audit + tableau de bord brokkr — **pas d'alerte ni de canal à ce jour** (FRE-81) |
| `storage.tf` | bucket Firebase Storage des avatars (privé, **plus utilisé** depuis le retrait des photos d'athlètes) |
| `public_media.tf` | bucket GCS **public** des médias du site vitrine (photos coachs + témoignages) |
| `scaleway.tf` | **hors GCP** : les deux seaux médias (public / kiné privé), l'application IAM `brokkr` et sa clé (→ Secret Manager) |
| `scaleway_email.tf` | **hors GCP** : domaine expéditeur transactionnel + droit d'envoi SMTP de brokkr — les enregistrements DNS se posent chez **Cloudflare**, cf. ci-dessous |

Ce qui n'est **pas** ici : le front (`eitri`) est sur **Firebase Hosting**,
déployé par `make hosting` depuis son dépôt ; Firebase Auth est configuré dans
la console Firebase ; le site vitrine `french-forge.com` est un second site
Hosting, déployé depuis `eitri/landing` ; et la **zone DNS** de
`french-forge.com` est chez **Cloudflare**, hors Terraform.

## Courrier transactionnel (FRE-166)

Le domaine expéditeur et le droit d'envoi de brokkr sont dans
`scaleway_email.tf`. Les enregistrements DNS, eux, ne peuvent pas l'être : la
zone est chez Cloudflare. Terraform les **dicte** puis les **vérifie**, en trois
temps :

```bash
scw tem offers update name=essential region=fr-par  # 0. UNE FOIS — cf. ci-dessous
terraform apply                          # 1. crée le domaine (var à false)
terraform output scaleway_tem_dns_a_poser # 2. les 4 lignes à créer dans Cloudflare
# … puis scaleway_tem_dns_pose = true dans terraform.tfvars
terraform apply                          # 3. Terraform VÉRIFIE — et échoue sinon
```

⚠️ **L'étape 0 est un bootstrap, pas un oubli.** Sans abonnement à l'offre, la
création du domaine rend `403 No active offer subscription for the project` — et
il n'existe **aucune ressource Terraform** pour s'abonner (vérifié sur les
providers 2.81.0 et 2.82.0 : `scaleway_tem_offer_subscription` n'est qu'une
source de données). `essential` est le palier gratuit, sans engagement : 300
messages par mois, 5 domaines.

⚠️ **Cloudflare veut des noms RELATIFS.** Scaleway rend des noms pleinement
qualifiés : coller `_dmarc.french-forge.com` tel quel crée
`_dmarc.french-forge.com.french-forge.com`, et la vérification échoue sans dire
pourquoi.

⚠️ **Scaleway ne contrôle pas un domaine neuf de lui-même.** Constaté le 10/09 :
le domaine est resté `unchecked` avec `next_check_at` VIDE, et l'apply de
l'étape 3 attendait un état qui ne serait jamais venu. Un contrôle explicite l'a
fait basculer en 9 secondes :

```bash
scw tem domain check <domain-id> region=fr-par     # l'id : terraform state show scaleway_tem_domain.expediteur
scw tem domain get-last-status <domain-id> region=fr-par   # le détail, enregistrement par enregistrement
```

On ne sait pas si `scaleway_tem_domain_validation` déclenche ce contrôle
lui-même — l'apply n'a jamais atteint sa création. Ce qu'on sait : **si
l'étape 3 attend, c'est ça qui manque.**

⚠️ **Tant que l'étape 3 n'est pas passée, rien ne peut partir** — un domaine TEM
non vérifié est refusé à l'envoi. Le drapeau `scaleway_tem_dns_pose` dit donc où
en est le monde, pas ce qu'on préfère.

## State

State **distant**, bucket GCS `french-forge-600-tfstate` (préfixe `nidavellir`),
créé à la main avant le premier `init`. Il contient des secrets — la clé privée
du SA brokkr, les mots de passe Neon : l'accès au bucket est l'accès à tout.

## Usage

```bash
gcloud auth application-default login   # creds user (droits projet)
terraform init
terraform plan                          # doit montrer "No changes" sur l'existant
terraform apply
```

Le provider Neon lit sa clé API dans Secret Manager (`neon_api_key`, déposée à
la main une fois).

### Image & déploiements

Terraform possède le SA et la **coquille** du service Cloud Run ; l'image est
ignorée après création (`ignore_changes`). Les déploiements passent par
`make build && make deploy` côté brokkr — l'image est taguée par le SHA du
commit, et `make verifier` prouve que la prod le sert. `terraform apply` ne
touche jamais l'image.

`make deploy` utilise `--update-env-vars` : les variables posées ici survivent
aux déploiements. La liste vieillissait plus vite qu'on ne la relisait — elle se
lit à la source, dans le bloc `template.containers.env` de `brokkr.tf` : la base
(`DB_*`), Sentry, Scaleway (médias) et le SMTP transactionnel.

### Bootstrap from-scratch (nouvel environnement uniquement)

Sur un environnement vierge, `brokkr:latest` n'existe pas encore, or Cloud Run
exige une image existante à la création du service. On amorce avec l'image
`hello` publique, puis on pousse la vraie :

```bash
cd ../nidavellir && terraform apply \
    -var brokkr_image_override=us-docker.pkg.dev/cloudrun/container/hello
cd ../brokkr && make build        # pousse l'image (le SA a les droits)
cd ../brokkr && make deploy       # bascule le service dessus
```

L'`apply` écrit aussi la clé du SA pour le dev local dans
`../brokkr/.secrets/brokkr-sa.json` (`brokkr_key_path` pour changer le chemin).
Rotation : `terraform taint google_service_account_key.brokkr_dev` puis `apply`.

> Si `make build` renvoie un 403 juste après l'apply, c'est la propagation IAM
> du rôle `artifactregistry.writer` (quelques dizaines de secondes) — réessayer.

## Médias publics du site vitrine

`public_media.tf` provisionne un bucket GCS **public en lecture** (`allUsers` →
`objectViewer`) pour les images de `french-forge.com` : photo de chaque coach
(téléversée depuis l'app, via brokkr) et photos des athlètes qui témoignent.

Objets déposés à la main, convention :

```
<slug>/profil.png                → photo du coach
<slug>/temoignages/<athlete>.jpg → athlète qui témoigne
```

```bash
gcloud storage cp profil.png gs://$(terraform output -raw public_media_bucket)/<slug>/profil.png \
    --cache-control="public, max-age=86400"
```

## Sauvegardes et restauration

Deux filets : le **PITR Neon** (6 h, free tier) et les **dumps horaires** dans
`gs://french-forge-600-db-backups` (`pg_dump -Fc`, 90 jours). La restauration
n'a pas encore été répétée ni écrite — c'est FRE-82.
