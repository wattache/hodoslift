# Eitri

Front de **French Forge Trainer** — le frère forgeron de [brokkr](../brokkr).

Réécriture complète du front v2 (`french-forge-trainer/`), pensée pour tuer la
dette du strangler-fig : **100 % des données passent par l'API brokkr**.
Firebase ne sert plus qu'à l'authentification (+ Storage pour les photos
d'athlète). Zéro SDK Firestore, zéro flag `VITE_BROKKR_*`, zéro adapter.

## Stack

| Rôle | Choix |
|---|---|
| UI | React 19 + TypeScript + Vite |
| Styles | Tailwind CSS v4 (tokens dark/gold dans `src/index.css`) |
| Data | TanStack Query (cache, invalidation, refetch au focus) |
| Routing | React Router v7 (une URL par vue) |
| Primitives | Radix UI + lucide-react ; toasts sonner |
| i18n | i18next (fr / en / pl) |

## Specs d'écran

Les chantiers d'interface ont un brief écrit, avec captures et maquettes :
[`docs/design/README.md`](docs/design/README.md). Les règles de dessin de l'app
sont dans [`docs/design.md`](docs/design.md).

## Architecture

```
src/
  api/
    types.ts        ← contrat brokkr (source de vérité : routers/schemas du back)
    client.ts       ← fetch + ID token Firebase + ApiError
    mock.ts         ← fixtures du mode dev-mock (mêmes types que l'API)
    hooks/          ← un fichier de hooks Query par domaine
  auth/             ← AuthProvider (Firebase) + AuthGate (/users/me, auto-link)
  lib/
    athlete-selection.tsx  ← sélection d'athlète + permissions (isSelf/canManage/canEdit)
    training-editor.ts     ← édition du programme (état local + PATCH débouncés)
    program-selection.ts   ← macro/bloc/semaine « courants » (résolution par date)
    …helpers purs (dates, rpe, tonnage, générateur de BASE, selectors)
  components/
    ui/             ← primitives (button, input, sheet, sidebar, dialog…)
    dashboard/  training/  layout/
  views/            ← une vue par route
```

**Règle d'affordance** : le front ne propose une écriture que là où brokkr
l'accepte. Trois permissions dérivées dans `athlete-selection` :
`isSelf` (autz owner), `canManage` (autz coach), `canEdit` (owner_or_coach).

## Démarrer

```sh
npm install
cp .env.example .env.local   # puis remplir (voir le fichier)
npm run dev                  # http://localhost:5174
```

Sans config Firebase dans `.env.local`, l'app démarre en **mode dev-mock** :
pas de login, données de démonstration, écritures locales sans persistance —
idéal pour travailler l'UI.

En mode réel, le front parle au brokkr pointé par `VITE_BROKKR_URL`
(local : `http://localhost:8080`, cf. `make dev` à la racine du workspace).

## Build & checks

```sh
npm run build      # tsc -b + vite build
npm run lint
npm run test:e2e   # Playwright sur le dev-mock (port 5199, login bypassé)
```

Les e2e couvrent nav/affichage/logique locale sur les fixtures — pas la
persistance (les écritures mock sont locales).

## PWA

`public/sw.js` (network-first, assets same-origin uniquement — jamais l'API) +
`public/manifest.json` (installable sur mobile). À chaque build,
`scripts/version-sw.mjs` versionne le cache : chaque déploiement purge les
assets de l'ancien. En local, le SW est désinscrit automatiquement.

## Déploiement (MANUEL)

Le target Hosting `app` = site **`french-forge-600`**, qui porte le domaine
**trainer.french-forge.com**. C'est LA prod.

```sh
make preview   # canal de preview Firebase (URL temporaire 7 j) — prod intacte
make hosting   # ⚠️ PROD : déploie sur https://trainer.french-forge.com
```

⚠️ Les noms disaient longtemps l'inverse de la réalité : `app` visait
`french-forge-trainer-rewrite` (un site que personne n'ouvre) et `canary` visait
le site qui porte le domaine — autrement dit `make canary` déployait en prod.
Corrigé le 2026-08-10 en réaffectant l'étiquette, sans toucher au DNS.

La cible `canary` a été **supprimée** : `french-forge-trainer-rewrite` héberge
encore la **v2** jusqu'à son décommissionnement, et aucune commande d'ici ne
doit pouvoir l'écraser par accident. Pour tester en ligne sans risque :
`make preview`.

Vérifier ce qui est réellement servi (le hash change à chaque build) :

```sh
curl -s https://trainer.french-forge.com/sw.js | grep -o 'eitri-[0-9]*'
```

### Rules Firestore / Storage

`firebase/` porte les rules (rapatriées du repo v2 pour qu'Eitri soit autonome
le jour où le v2 disparaît) :

```sh
make rules   # déploie firestore:rules + storage:app
```

⚠️ Tant que le v2 vit, les DEUX repos peuvent déployer ces rules sur le même
projet — la dernière commande lancée gagne. Garder les copies alignées, ou ne
déployer que depuis ici.

À faire quand le v2 sera éteint : les rules Firestore autorisent encore
l'accès CLIENT à l'arbre `programs/…` (le v2 en avait besoin). Eitri ne touche
jamais Firestore — seul brokkr y écrit, via l'admin SDK, qui ignore les rules.
Elles peuvent donc passer en deny-all côté client.

Caveats du canal de preview :
- CORS : brokkr n'autorise que trainer.french-forge.com + localhost — ajouter
  l'origine du canal (regex `https://french-forge-600--.*\.web\.app`) dans
  `ALLOWED_ORIGINS` de brokkr pour tester en ligne ;
- Auth Google : l'origine du canal doit être dans les domaines autorisés de
  Firebase Auth (console → Authentication → Settings → Authorized domains).
