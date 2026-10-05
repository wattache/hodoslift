# Les e2e qui traversent POUR DE VRAI

`e2e/` (77 specs) tourne sur le **dev-mock** : les écritures y sont des no-op.
Ces specs couvrent la navigation et l'affichage — **elles ne peuvent rien dire de
la persistance**. C'est cet angle mort qui a laissé passer trois défauts de
contrat en une semaine (`addMacro` en 422, la génération depuis la BASE, les
dates vides).

⚠️ **LE RUNNER ET LES SEEDS VIVENT DANS `forge`** (FRE-61), le dépôt parent :
ils montaient une stack faite de deux dépôts depuis un script invité chez le
troisième. Les SPECS, elles, restent ici — ce sont des tests du front.

`e2e-reel/` traverse la chaîne entière : **navigateur → eitri → brokkr →
Postgres**, avec une vraie authentification.

## Pourquoi un émulateur d'authentification

Un seul booléen — `isFirebaseConfigured` — commande à la fois le bypass du login
**et** les 15 court-circuits d'écriture de l'éditeur. Donc, par construction :
pas d'auth ⟹ pas d'écriture. Les e2e ne pouvaient pas écrire non pas faute de
base, mais parce que le seul mode qui les laissait entrer neutralisait les
écritures.

L'émulateur casse ce nœud sans toucher au produit : `verify_id_token` détecte
`FIREBASE_AUTH_EMULATOR_HOST` et saute la vérification de signature. **Brokkr n'a
pas une ligne à changer.** Côté eitri, le seul ajout est un `connectAuthEmulator`
conditionné à `VITE_AUTH_EMULATOR_HOST` — substitué statiquement par Vite, donc
éliminé du bundle de production, et `npm run build` REFUSE de construire si la
variable traîne (`scripts/refuser-emulateur.mjs`).

## Lancer — UN geste

```bash
../scripts/e2e-reel.sh             # monte ce qui manque, sème, joue tout
../scripts/e2e-reel.sh athlete     # les arguments filtrent (→ Playwright)
../scripts/e2e-reel.sh --arret     # éteint ce que le script a pu démarrer
```

Le script est **idempotent** : chaque service (émulateur 9099, brokkr 8082)
n'est démarré que s'il ne tourne pas, les seeds se rejouent à chaque fois. Un
départ à froid — trois ports libres — mène aux specs vertes en ~35 s, mesuré.

Deux comptes d'abord : `e2e-coach` (le coach du programme de test) et
`e2e-athlete-user` (l'athlète LIÉ, via `athletes.user_uid`) — deux rôles, parce
qu'un refus d'autorisation ne se prouve pas avec un seul compte. Puis `e2e-kine`,
`e2e-identite` (FRE-76) et, depuis FRE-142, `e2e-coach-athlete` : coach de son
PROPRE programme (`e2e-program-double`), comme les coachs de production. C'est
le seul compte pour lequel brokkr résout deux rôles à la fois, et toute règle
branchée sur le rôle lui passait au vert sans être éprouvée.

Pour garder la stack sous les yeux pendant qu'on écrit une spec : le script la
laisse DEBOUT en sortant (émulateur et brokkr-e2e sont démarrés détachés). On
itère donc avec `npx playwright test --config playwright.reel.config.ts`, et on
éteint avec `../scripts/e2e-reel.sh --arret`.

⚠️ Ces services avaient leurs procs dans `mprocs.yaml` ; ils en ont été RETIRÉS
le 17/08. mprocs est redevenu le démarrage quotidien (eitri + brokkr), et cette
stack-ci appartient au harnais — elle se monte d'un geste et n'a pas à encombrer
le lancement de tous les jours.

⚠️ Pièges du montage, tous rencontrés :

- `firebase emulators:start` **sort en code 0 même quand le port est pris** —
  le script teste le port avant et la disponibilité après, jamais le code ;
- la locale du navigateur est **épinglée `fr-FR`** dans la config : l'i18n suit
  `navigator.language`, et un Chromium anglophone rend `Rép. réelles`
  introuvable — les specs coach n'y survivaient que parce que leurs libellés
  sont codés en dur en français ;
- le reporter est `list` : le rapport HTML par défaut **sert le rapport après un
  échec et bloque** le terminal — mortel pour un script ou une CI ;
- la popup de connexion peut ne jamais venir si le clic part avant l'init du SDK
  Firebase : `seConnecter` re-clique au lieu d'attendre 30 s un événement mort.
```
(l'ancien lancement en quatre terminaux reste possible, cf. l'historique git)
```

## Ce que ces tests font, et ce qu'ils ne font pas

**Ils écrivent VRAIMENT** dans `ff-training`, sous le programme `e2e-program`
qui leur est réservé. Chaque spec crée ses propres objets et les supprime en
`afterEach` — exécuté même quand le test échoue, sinon un échec laisserait le
terrain sale pour le suivant et on ne saurait plus lequel a menti.

⚠️ **Règle absolue : ils ne touchent jamais aux 55 programmes réels.** Un objet
créé se supprime ; une donnée réelle modifiée ne se « dé-modifie » pas.

**Les assertions passent par `GET /training`, pas par le DOM.** C'est tout
l'intérêt : « l'écran l'affiche » et « c'est écrit » sont deux choses
différentes, et seule la seconde nous intéresse ici.

**Ce qu'ils ne couvrent PAS**, et qu'il ne faut pas croire couvert :

- la **concurrence** (deux onglets, coach et athlète en même temps) et la resync
  pendant une écriture en vol : le debounce de 400 ms rend ces fenêtres non
  déterministes ;
- le **réessai** (1 s / 3 s / 8 s) et le mode hors ligne ;
- l'**authentification de production** : l'émulateur saute la signature, donc
  expiration, révocation et décalage d'horloge restent non testés ;
- la **dérive bac à sable ↔ Neon** : le harnais valide contre `ff-training`, et
  `docs/postgres-schema.sql` reste le seul lien avec la vraie base ;
- la PWA au bundle périmé, la performance, l'ETL.

Et le méta-risque, le plus important : **quelques specs vertes disent « ces
gestes-là tiennent », pas « l'écriture marche »**. Le filet par-champ reste
`verifier_contrats.py` et `test_aller_retour.py` — un champ dépouillé sans
raison écrite y devient un trou invisible, comme `formOfTheDay` l'a montré. Ce
harnais s'ajoute à ces filets ; il n'en remplace aucun.

## Éprouvé — et une leçon qui a failli coûter cher

Chaque spec est validée en **réintroduisant le défaut qu'elle prétend garder** :

| spec | défaut réintroduit | résultat |
| -- | -- | -- |
| création | `addMacro` envoie `week` à la racine (B5) | rougit, puis reverdit |
| semaine suivante | la copie garde les ids de la source (B2) | rougit, puis reverdit |
| base sans dates S1 | `s1StartDate` privé de son `vide_en_none` (bug de la 3e passe) | rougit (422 sur l'écho), puis reverdit |
| athlète | `"name"` ajouté à `_CHAMPS_ATHLETE["semaine"]` (FRE-43 à l'envers) | rougit (200 au lieu de 403), puis reverdit |
| génération S1 | `generateWeekOneFromBase` renvoyé sur `PATCH /weeks/{id}` (le bug historique) | rougit (semaine restée vide), puis reverdit |
| suppressions | `_nettoyer_groupe` débranché de `delete_exercise` (FRE-31) | rougit (`groupId` orphelin), puis reverdit |

⚠️ **La première version de « semaine suivante » restait VERTE avec le bug.**
Elle ne prouvait rien, et j'allais la livrer.

La raison vaut d'être connue : `addWeek` invalide la requête, et la réponse
arrive en ~50 ms — l'état local est alors remplacé par la vérité du serveur, ids
compris. La fenêtre de corruption est **réelle mais trop courte pour être
atteinte par hasard**. Le test tapait après, donc sur des identités déjà
corrigées.

Le correctif est dans la spec : `page.route` retarde `GET /training` de quatre
secondes, ce qui maintient l'état local issu de `buildNextWeek` le temps de
frapper. C'est exactement la situation du coach sur un réseau lent — et c'est là
que la corruption avait lieu.

**Règle pour les specs à venir : une spec qui n'a jamais été vue échouer est une
spec qui n'existe pas.** Casser le code exprès fait partie de l'écriture du test,
pas de sa relecture.
