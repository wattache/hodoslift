# Revue FRE-12 — migration de l'arbre d'entraînement Firestore → Postgres

Revue exécutée le 2026-08-15 sur `brokkr@81a6f5f` (wachiam/fre-12-entrainement-postgres)
et `eitri@00c540a` (wachiam/fre-12-front-postgres). Tout ce qui suit a été **vérifié en
exécutant** : 12 tests HTTP jetables sur le dispositif `pg` (TestContainers), trois
passes d'ETL chronométrées sur la base locale, une comparaison indépendante champ à
champ Firestore ↔ Postgres (15 034 objets), et la migration des objectifs rejouée sur
une base jetable. Aucune écriture sur Neon ni sur Firestore.

## 0. État des correctifs (2026-08-15, après revue)

| | statut | où |
|---|---|---|
| **B1** v2 / rewrite.web.app | ⛔ **NON CORRIGÉ — c'est une DÉCISION, pas du code.** La bascule des données et celle des athlètes vers Eitri sont le même événement. | — |
| **B2** copie de semaine ↔ ids | ✅ | eitri `c2a0e50` + `lib/next-week.ts` |
| **B3** `weightLocked` booléen | ✅ | eitri `c2a0e50` |
| **B4** `kind` de la BASE | ✅ migration + les deux chemins | brokkr `a6fc920` |
| **B5** `addMacro` niché | ✅ | eitri `c2a0e50` |
| **B6** contenu d'une semaine | ✅ `PUT /weeks/{id}/content` | brokkr `a6fc920` |
| **A1** dates de macro → 500 | ✅ champs retirés du contrat | brokkr `a6fc920` |
| **A2** suppression du dernier | ✅ la garde locale tombe | eitri |
| **A3** verrou de resync / retry périmé | ✅ écritures « en vol » suivies | eitri |
| **A4** ligne fantôme | ✅ les créations rendent leurs ids | brokkr + eitri |
| **A5** deux 500 de contrat | ✅ | brokkr `a6fc920` |
| **A6** périmètre de l'athlète | ✅ restreint (poids/taille, forme du jour) | brokkr `a6fc920` |
| **A7** gestes en 422 | ✅ nom de séance vide accepté | brokkr `a6fc920` |
| bilan ETL tautologique | ✅ vrais `count(*)` | brokkr `a6fc920` |
| ETL sans purge | ✅ `--purge`, qui PRÉSERVE les objectifs de bloc | brokkr `a6fc920` |
| `psql -v ON_ERROR_STOP=1` | ✅ consigné dans chaque migration | — |
| assertions molles des tests | ⏳ à faire | — |

Trouvé **en corrigeant**, et absent de la revue : depuis FRE-33, l'héritage du RPE
cible depuis la BASE comparait les variantes par RÉFÉRENCE (`p.variant === ex.variant`,
deux listes) — la règle était morte sans que rien ne le signale. Et la première version
de `--purge` DÉTRUISAIT les 346 objectifs de bloc, qui n'existent que dans Postgres :
mis à l'abri puis réattachés par leurs identités legacy, avec les orphelins comptés.

Tests : brokkr 646 ✓ (+31, dont `tests/test_contrat_front.py` qui rejoue les payloads
RÉELS du front) · eitri 46 unitaires ✓, 77 e2e ✓.

### 0bis. Contre-vérification indépendante (2e passe de revue, 2026-08-15 soir)

Chaque ✅ du tableau a été **re-prouvé sans réutiliser les tests des correctifs** :
10 tests HTTP jetables rejoués sur le dispositif `pg` (mêmes hypothèses que la
première passe, comportement corrigé attendu) — tous verts :

- dates de macro → **422** propre (plus de 500) ; id non-uuid → **404** ;
  `name: null` → 200 (efface en `''`) ; nom de séance vide → 200 ;
- payload `addMacro` niché → **201** avec l'arbre d'ids complet, la ligne vide
  écartée laissant un `null` **à sa place** dans la liste (l'alignement dont dépend
  `adopterLesIds`) ; l'ancien payload à la racine reste un 422 ;
- `PUT /weeks/{id}/content` → 200, contenu remplacé, ids rendus, et l'aller-retour
  conserve `weightLocked` (booléen), `kind`, le poids de l'instantané ;
- `weightLocked` booléen passe dans les deux sens ; côté eitri le type est booléen
  partout (types, table, BASE, génération, copie de semaine) ;
- le `kind` d'une ligne de BASE **survit** au PUT + relecture (principes et
  accessoires) — migration déjà posée sur la base de travail ;
- l'athlète : méta de semaine → **403**, nom de séance → **403**, poids / forme du
  jour / réalisé → 200 ;
- `next-week.ts` supprime bien les ids de séance ET de ligne à la copie (commentaire
  et test dédiés) ; `enVol` couvre l'écriture en vol et le réessai périmé.

ETL `--purge` éprouvé **en réel** sur le bac à sable : un objectif semé sur un vrai
bloc + un objectif orphelin fabriqué → purge, rechargement, **4 objectifs réattachés
au bon bloc (identités legacy), 1 orphelin compté à voix haute et écarté**, comptes
finaux en vrais `count(*)`, 24,4 s au chrono.

**B1 a trouvé sa réponse hors de ces branches** : le dépôt v2 porte une page de
fermeture prête (`make sunset`, `firebase.sunset.json`) qui remplace rewrite.web.app
par une redirection vers trainer.french-forge.com — désinscription du service worker,
purge des caches, routes préservées — datée du **lundi 17 août**. Le verdict devient :

> **GO, conditionné à l'ordre des opérations** : la fermeture de la v2 (`make sunset`)
> appartient à la MÊME fenêtre que le déploiement de brokkr — jamais brokkr avant la
> sunset, sinon les écritures v2 partent dans un Firestore que plus personne ne lit.

Résidus non bloquants relevés à la 2e passe : la ligne vide d'une semaine neuve
(macro/bloc) reste sans id ~1 s jusqu'au refetch — une frappe dans cette fenêtre est
perdue *visiblement* (la ligne se vide), plus d'écrasement silencieux ; et
`weekHasUnsavedLines` est écrit mais jamais appelé — le brancher (désactiver la ligne
tant qu'elle n'a pas d'id) fermerait ce dernier interstice. Les assertions molles des
tests (`in (None, "")`) restent à épingler, comme le note le tableau.

### 0ter. Troisième passe (2026-08-15 soir, sur `ca272fa` + eitri `2d57799`) — et revue de code

Périmètre neuf depuis la 2e passe : l'ETL **incrémental** (`--delta`, 51b68c0), le
**retrait des onze routes documentaires** (ca272fa), et la **matérialisation des
lignes vides** côté eitri (2d57799). Tout re-vérifié en exécutant.

**Ce qui est prouvé vert.** Suites : brokkr 585 ✓, eitri tsc ✓ / 46 unitaires ✓ /
77 e2e ✓ (54 avertissements eslint, niveau constant). Mes re-preuves HTTP passent sur
HEAD (routes documentaires → 404, `GET /training` vivant, flux création + matérialisation,
`PUT /content`). L'ETL delta, éprouvé en réel sur le bac à sable : passe à blanc
**12,8 s** (0 réécrit, comptes exacts), un macro et une semaine fantômes semés →
**élagués et affichés** ; 30 macros fantômes → **⛔ refus à 30/92 (> 25 %), exit 1,
transaction annulée**, les 30 intacts. Le choix « routes mortes = 404 franc plutôt que
200 menteur » est le bon (PWA qui reprend sans recharger).

**⛔ UN BLOQUANT NOUVEAU, prouvé — l'aller-retour de la BASE recasse.** La 2e passe a
étendu `_txt` (null → `''`) aux dates de bloc : la lecture sert désormais
`s1StartDate: ""`. L'éditeur de BASE renvoie la base telle qu'il l'a lue, et
`BaseContent.s1StartDate` porte un `pattern` qui refuse `''` :

```
GET  /training                 → base.s1StartDate = ''        (bloc sans dates S1)
PUT  /blocks/{id}/base  (écho) → 422 string_pattern_mismatch
```

**54 blocs sur 125** n'ont pas de date S1 : la sauvegarde de leur BASE est morte —
c'est exactement la famille du 15/08 (« l'écriture refuse ce que sa propre lecture
vient de rendre »), réintroduite par le correctif d'une autre instance de la même
famille. `test_contrat_front.py` ne l'attrape pas parce qu'il rejoue des payloads à
dates posées. Correction : accepter `''` et le normaliser en NULL sur **toutes** les
dates des contrats structure (un `BeforeValidator` partagé, en remplacement des
`pattern` nus) — et ajouter le test générique « écrire l'écho de la lecture → 200 »
à chaque niveau, qui aurait attrapé celle-ci et attrapera les suivantes.

**À corriger avant merge (nouveau).** L'élagage tourne aussi **sans** `--delta` :
un `--apply` simple supprime ce qui a disparu de Firestore **sans l'afficher** (aucune
ligne « supprimés » hors mode delta) et conclut « ℹ️ Sans --purge ni --delta, "en
base" est un CUMUL » — constaté : macro fantôme supprimé sous ce message même. Le
comportement (miroir exact, borné par le garde-fou) est défendable ; le compte rendu
qui affirme le contraire ne l'est pas. Soit restreindre l'élagage au mode `--delta`,
soit afficher les suppressions dans tous les modes et corriger le message — et
trancher le mode canonique du soir J (`--delta`), car `--apply`, `--delta` et
`--purge` font aujourd'hui trois recouvrements du même besoin, l'aide de `--purge`
(« obligatoire pour la passe finale ») étant périmée depuis le delta.

**Revue de code (qualité — rien de bloquant) :**

- *brokkr* — `_refuser_hors_perimetre` est appelé **avant** `_verifier` : un athlète
  visant l'objet d'un autre programme reçoit 403 (champs réservés) là où la convention
  du module promet 404. Pas de fuite (la réponse ne dépend pas de l'existence de
  l'objet), mais l'inversion des deux appels rendrait la règle uniforme.
  `training_structure.py` approche 650 lignes : les helpers de création
  (`_creer_semaine`, `_creer_seances`, `_inserer_ligne`) méritent leur module.
  `_date_ou_none` et les `pattern` de dates sont deux mécanismes concurrents du même
  problème — l'unification (validator partagé) est aussi la correction du bloquant
  ci-dessus. `restaurer_objectifs` fait une requête par objectif (346 allers-retours
  sur Neon si `--purge` reste) ; `_index` charge les tables entières (correct à 604
  documents, à filtrer si ça grossit).
- *eitri* — `training-editor.ts` reste ~950 lignes et mélange trois étages
  (persistance, règles de groupe, cycle de vie) ; `nettoyerGroupesSeuls`/`blocDe`/
  `CHAMPS_DE_GROUPE` sont des définitions module posées AU MILIEU du corps du hook,
  avec l'indentation qui trahit l'histoire — les sortir dans `lib/groupes.ts` ;
  `addMacro`/`addBlock`/`addWeek` sont trois blocs quasi identiques à factoriser.
  `materialiserLignesVides` : une ligne vide résiduelle au MILIEU d'une semaine copiée
  est recréée en FIN de séance (ordre divergent jusqu'au refetch, cas rare) ; et si un
  de ses POST échoue, le `catch` des créations n'appelle pas `invalidate()` — l'écran
  ignore alors un macro que le serveur a pourtant créé, jusqu'au prochain focus.
  Les 54 avertissements eslint (react-hooks) ne bloquent rien en CI : les traiter ou
  fixer un budget, sinon ils grossiront. Les e2e restent sur mock : aucun 422 de
  contrat n'est à leur portée — le vrai filet serait un e2e branché sur un brokkr
  local à base jetable, au moins sur les quatre gestes de création.

**Verdict de la 3e passe : NO-GO tant que l'aller-retour BASE (54/125 blocs) n'est
pas corrigé** — c'est un correctif de quelques lignes plus un test générique. Le
reste du système, ETL delta compris, est prêt, et la condition d'ordre des opérations
(sunset v2 dans la même fenêtre) demeure.

### 0quater. Réponse à la 3e passe (2026-08-15, tard)

**Le bloquant est corrigé, et il était plus large que décrit.** L'aller-retour de la
BASE échouait bien sur les 54 blocs sans date de S1 — reproduit à l'identique. Mais le
même défaut frappait aussi `PATCH /blocks`, `PATCH /weeks`, `PATCH /sessions` et la
création de semaine : **6 des 10 nouveaux tests d'aller-retour échouent** sans le
correctif, pas un seul.

Correction à la racine : un `BeforeValidator` partagé (`DateISO`) qui convertit `''` en
None AVANT que le motif ne s'applique, sur **toutes** les dates des contrats de
structure. Les deux mécanismes concurrents (`_date_ou_none` côté routeur, `pattern` nu
côté contrat) n'en font plus qu'un.

Et surtout `tests/test_aller_retour.py`, qui teste l'INVARIANT plutôt que ses
instances : à chaque niveau, on relit l'arbre et on renvoie au serveur exactement ce
qu'il vient de rendre. La fixture DÉPOUILLE l'arbre au préalable — ni nom ni date nulle
part — parce qu'une fixture aux champs remplis ne prouve rien : c'est l'absence de
valeur qui met les contrats en défaut, et c'est l'état le plus courant dans la vraie
donnée.

**Élagage hors delta : corrigé.** Il n'opère plus qu'en mode `--delta`. Un chargement
additif reste additif, ce que son bilan promettait. Vérifié en réel : un fantôme semé
survit à un `--apply` simple, et l'aide de `--purge` ne se présente plus comme la
procédure de bascule. Le mode canonique est écrit en tête du script : **`--apply
--delta`**.

Les remarques de qualité (découpage de `training_structure.py` et de
`training-editor.ts`, ordre `_refuser_hors_perimetre` / `_verifier`, factorisation des
trois `add*`, e2e sur brokkr local) sont justes et restent ouvertes : aucune ne bloque
la bascule, toutes méritent un ticket.

brokkr 596 ✓

### 0quinquies. Quatrième passe (2026-08-16) — audit des correctifs, et avis sur le harnais e2e

Périmètre : brokkr `ca272fa..697c3f4`, eitri `2d57799..2598f8b`. Tout vérifié en
exécutant ; preuves rejouables comme aux passes précédentes.

#### A. L'audit

**Ce qui tient — prouvé.**

- Suites : brokkr **599 ✓ + 1 sauté** (mesuré ; l'énoncé disait 603, écart sans objet
  trouvé), eitri tsc ✓ / 46 unitaires ✓ / 77 e2e ✓, eslint **54/54 exactement** (tout
  avertissement neuf casse).
- `verifier_contrats` sur le bac à sable **resynchronisé du matin** (delta : 10
  semaines rechargées, l'activité réelle de la veille) : **0 refus sur 10 019 lignes**.
  `bf5c4f1` tient sur la donnée du jour, pas seulement sur celle de sa découverte.
- Mes contre-preuves directes : `PATCH {"repsUnit": ""}` et `{"incrementUnit": ""}`
  → 200 et colonne NULL ; l'ordre appartenance → périmètre (FRE-43) rétabli ;
  ETL : un macro fantôme semé **survit** à `--apply` (redevenu additif, le message
  « CUMUL » est enfin vrai) et **tombe** en `--delta`, compté et affiché
  (« 1 supprimés »). Les trois modes sont documentés en tête du script, `--delta`
  désigné comme LE mode du soir J.
- eitri : les cinq gestes resynchronisent sur échec (`invalidate()` dans chaque
  `catch`) ; le filtre des lignes sans nom (`2598f8b`) ne tue **pas**
  `materialiserLignesVides` — `createEmptyWeek` porte toujours sa ligne vide pour
  addMacro/addBlock, seul le chemin « copie » n'en produit plus ; et le filtre est posé
  **après** la boucle d'incréments, ce qui préserve l'héritage du RPE par index. Rien
  d'autre ne comptait sur ces lignes dans la copie (vérifié par lecture des appelants).

**Le trou qui reste — prouvé, non bloquant : `formOfTheDay`.** La lecture sert `''`
quand la forme n'est pas saisie ; `SessionPatch.formOfTheDay` est le seul champ à
vocabulaire clos SANS `vide_en_none` ; et les DEUX filets neufs **dépouillent
précisément ce champ** (`test_aller_retour.test_seance` ne garde que
`name`/`sessionDate`, `verifier_contrats` idem) :

```
GET  → formOfTheDay: ''            (852 séances réelles sur 1 815 sans forme saisie)
PATCH /sessions/{id} (écho complet) → 422 literal_error
```

Aucun chemin eitri ne l'emprunte aujourd'hui (`updateSessionForm` convertit `''` en
null) — donc pas de blocage lundi. Mais c'est la dernière violation CONNUE de
l'invariant, et elle est invisible parce que ses gardiens la contournent. Correctif :
`vide_en_none` sur `formOfTheDay`, et retirer le dépouillage des deux filets. Règle à
en tirer : **quand un test dépouille un champ, le commentaire doit dire pourquoi** —
un champ écarté sans raison écrite est un trou qu'on s'est caché.

**Les réponses aux questions posées.**

- *`vide_en_none` masque-t-il une faute de client ?* Non — le bon critère : tout champ
  dont l'absence SE LIT `''` doit accepter `''` en écriture, sinon l'écho ment.
  `kind: ''` = « effacer » (prouvé : 200, colonne NULL, donc entraînement) est le bon
  choix ; la distinction absent/fourni reste portée par `exclude_unset`, et le front
  n'envoie jamais `''` (kindToWrite). Je n'ai trouvé aucun champ où `''` et l'absence
  devraient rester distincts. Nuance cosmétique : `groupId: ''` s'écrit `''` (pas
  NULL), la base mélange les deux formes sur `group_id` — les deux lecteurs tolèrent.
- *Le trou des dictionnaires libres.* Réel, et voici sa forme exacte : dans
  `sessions[]`, `base` et `objectives`, les TYPES ne sont pas validés — un nombre là
  où une colonne attend du texte ferait un 500 (pas de cast d'affectation int→text
  en SQL). `verifier_contrats` ne peut pas le voir (il valide des modèles Pydantic,
  les listes libres passent en `dict[str, Any]`), et les objectifs n'ont AUCUN modèle.
  Ce qui le rend acceptable aujourd'hui : ma comparaison exhaustive de 1re passe
  (15 034 objets) n'a trouvé **zéro** valeur non-chaîne dans ces champs, et l'écho des
  chemins libres passe (`test_contenu_d_une_semaine`, BASE, objectifs). Risque accepté
  tant que seul eitri parle au serveur ; à réévaluer si un autre client apparaît.
- *L'élagage delta-only laisse-t-il un piège ?* Oui, l'inverse du précédent : un
  `--apply` nu le soir J laisserait des restes de chargements antérieurs **sans
  verdict** (pas de ✅/❌, exit 0, marques `•`). Le runbook qui impose `--delta`
  suffit — il est écrit en tête du script ; si on veut une ceinture, faire échouer
  la passe si `--apply` nu trouve plus de lignes en base que lues, mais je ne la
  demande pas pour lundi.
- *Le budget eslint gelé.* Mieux que rien, moins bien que zéro. La faille du plafond
  fixe : retirer un avertissement sans décrémenter laisse UNE place, et un neuf peut
  entrer **dans le même commit** sans rien casser — le compte ne bouge pas, la dette
  tourne sur elle-même. Le commentaire du CI promet la décrémentation, mais rien ne
  l'impose. Trajectoire recommandée : brûler les 54 (l'essentiel est mécanique), puis
  `--max-warnings 0` avec des `eslint-disable-next-line` justifiés ligne à ligne — un
  disable écrit et argumenté vaut mieux qu'une place anonyme dans un budget. Un budget
  qui n'a pas baissé dans trois semaines est un budget mort.
- *Micro-reste (non testé) :* dans la copie de semaine, une ligne sans nom membre d'un
  bi-set est écartée et son partenaire copie un `groupId` orphelin — invisible à
  l'écran (l'affichage exige deux membres), nettoyé au prochain delete seulement.
  Une ligne dans `nettoyerGroupesSeuls` appliquée après le filtre le fermerait.

#### B. Le harnais e2e (FRE-35) — avis avant construction

**1. L'émulateur est la bonne voie**, et j'ai chiffré les trois alternatives avant de
le dire :

- *Forger un jeton* : impossible sans que brokkr saute la vérification de signature —
  ce qui est exactement ce que fait l'émulateur, OU un mode test côté serveur
  (override de `verify_token` activé par env) : du code produit dans brokkr, et on ne
  testerait plus le vrai `verify_id_token`. Pire sur les deux plans.
- *Injecter une session dans le navigateur* : le SDK persiste dans IndexedDB un format
  interne versionné, et `getIdToken()` exige un refresh token valide pour se
  renouveler. Fragile à chaque montée de version, et ça casserait en silence. Non.
- *Découpler le booléen* (`isMock` ≠ « sans login ») : c'est PLUS de code produit —
  deux drapeaux à maintenir, 15 gardes à retrier — et ça crée un mode « pas d'auth
  mais écritures réelles » qu'on regrettera le jour où il fuit. Non.

L'émulateur teste le chemin RÉEL de bout en bout : login → `currentUser.getIdToken()`
→ `Authorization: Bearer` (vérifié dans `client.ts`) → `verify_id_token` → autz
Postgres. Un proc de plus, zéro ligne côté brokkr — confirmé, `app/socle/auth.py` appelle
`verify_id_token` sans option qui contournerait la détection d'émulateur.

**2. Les 3 lignes dans `src/firebase.ts` : acceptables**, c'est le montage standard.
Deux conditions : garder la garde sur `import.meta.env.VITE_AUTH_EMULATOR_HOST`
(substituée statiquement par Vite → code mort éliminé du bundle de prod), et ajouter
un garde-fou de build — `npm run build` échoue si la variable est posée — pour que ça
ne parte jamais en prod. Le montage « zéro ligne » existe (alias/`define` Vite en
config de test qui substitue le module) mais échange trois lignes greppables contre
de la magie de build invisible qui dérivera : je ne le recommande pas.

**3. `CREATE DATABASE … TEMPLATE` : le piège est réel et il est déjà dans le
montage.** `brokkr-local` (pool de 5, recycle 300 s) tient des connexions permanentes
sur `ff` : le clone échouera sur « source database is being accessed ». Deux issues :

- **(recommandée)** une base MODÈLE dédiée `ff_modele` à laquelle rien ne se connecte
  jamais — `ALTER DATABASE ff_modele WITH ALLOW_CONNECTIONS false` le garantit —
  rafraîchie par l'ETL quand on le décide, et l'utilisateur de test (users, coaches,
  athlète, programme) semé DEDANS. Chaque campagne : stop brokkr-e2e → `DROP DATABASE
  IF EXISTS ff_e2e` → clone → start. Zéro conflit, zéro nettoyage ;
- sinon `pg_terminate_backend` sur les connexions à `ff` avant le clone —
  `pool_pre_ping` fait que brokkr-local s'en remet seul, mais c'est une brutalité par
  campagne qui finira par tomber pendant un geste manuel.

Ne pas oublier le **deuxième brokkr** (port 8082, `DATABASE_URL=ff_e2e`,
`FIREBASE_AUTH_EMULATOR_HOST` posé) : l'émulateur ne sert à rien si les e2e parlent au
brokkr-local branché sur `ff`.

**4. Les scénarios — mon ordre, et pourquoi il diffère du tien.** Tes cinq gestes de
création sont les bons pour la famille « ça casse fort » ; mais ce qui a fait le plus
mal en trois passes était SILENCIEUX, et c'est le **recharger-et-vérifier** qui
l'attrape. Chaque spec doit finir par un reload + une assertion sur `GET /training`
(par l'API, pas par le DOM) : c'est le reload qui sépare « l'UI l'a montré » de
« c'est écrit ».

1. la BASE d'un bloc **sans dates S1** : ouvrir, sauver, recharger, comparer — le
   bug d'hier tel quel, celui que le harnais aurait attrapé ;
2. **addWeek puis frapper immédiatement** dans la semaine neuve, recharger : la valeur
   est là **ET la semaine précédente n'a pas bougé** — l'assertion sur la semaine
   SOURCE est celle qui manquait partout (c'était la corruption silencieuse B2) ;
3. addMacro/addBlock puis frapper dans la ligne vide, recharger (anti-ligne-fantôme) ;
4. le parcours ATHLÈTE : saisir son réalisé et sa forme du jour (200), tenter la méta
   (403 proprement affiché) — le périmètre FRE-43 n'a aujourd'hui aucun test côté
   interface ;
5. générer S1 depuis la BASE sur semaine existante (`PUT /content`).

**5. Ce qu'il ne couvrira PAS — à écrire en tête du harnais, pas dans un coin :**

- la **concurrence** (deux onglets, coach + athlète simultanés) et la resync pendant
  une écriture en vol : le debounce de 400 ms rend ces fenêtres non déterministes en
  Playwright — testable plus tard par interception réseau, pas en v1 ;
- le **retry** (1 s/3 s/8 s) et l'offline ;
- l'auth de **production** : l'émulateur saute la signature — expiration, révocation,
  clock skew restent non testés (risque faible : code firebase_admin, pas le nôtre) ;
- la **dérive bac à sable ↔ Neon** : le harnais valide contre `ff_modele`, pas contre
  la vraie base ; la discipline `postgres-schema.sql` reste le seul lien ;
- la PWA au bundle périmé, la performance (programme de 838 lignes), et l'ETL.

Et le méta-risque, qui est la vraie réponse à ta dernière question : cinq specs vertes
diront « les gestes de création tiennent », pas « l'écriture marche ». Le filet
par-champ reste `verifier_contrats` + `test_aller_retour` — dont cette passe vient de
montrer qu'un champ dépouillé sans justification y devient un trou invisible. Le
harnais e2e s'ajoute à ces filets ; il n'en remplace aucun.

#### Verdict (4e passe)

**GO pour lundi 17 au matin.** Les correctifs de la 3e passe tiennent tous, le
vérificateur relit les 55 programmes réels sans un refus, l'ETL delta est le bon outil
et il est désigné comme tel. Le trou `formOfTheDay` est prouvé mais hors de tout
chemin emprunté : à corriger dans la foulée, pas à bloquer. La condition d'ordre
demeure, inchangée et non négociable : **`make sunset` de la v2 dans la même fenêtre
que le déploiement de brokkr — jamais brokkr avant** ; runbook `--delta`,
`psql -v ON_ERROR_STOP=1`, `BASCULÉ = True` en fin de fenêtre.

### 0sexies. Cinquième passe (2026-08-16 après-midi) — la stack e2e réelle, finie et éprouvée

Mission : compléter `eitri/e2e-reel/`, la rendre lançable d'un geste, et relire les
filets. Commits : eitri `599ba73`, brokkr `4283871`. Doc à jour : `eitri/docs/e2e-reel.md`.

#### Ce que la stack ne couvre PAS (à lire avant de s'y fier)

Inchangé depuis l'avis de 4e passe, et écrit en tête du doc du harnais : la
**concurrence** (deux onglets, coach + athlète simultanés), la resync pendant une
écriture en vol, le **réessai** et l'offline, l'**auth de production** (l'émulateur
saute la signature), la **dérive bac à sable ↔ Neon**, la PWA périmée, la
performance, l'ETL. S'y ajoutent, propres à cette passe : le harnais n'a **pas de
nettoyage en `beforeEach`** (un run tué net — SIGKILL — laisse des restes dans
`e2e-program`, et la première spec de création, qui exige zéro macro, échouera au
run suivant ; la saleté reste confinée au programme de test) ; et il n'est **pas
branché en CI** (Docker + émulateur dans GitHub Actions : faisable, pas fait).
Huit specs vertes disent « ces gestes tiennent », pas « l'écriture marche » — le
filet par-champ reste `verifier_contrats` + `test_aller_retour`.

#### La stack, spec par spec — et ce que chacune a été VUE attraper

Règle du répertoire appliquée à chaque spec neuve : le défaut qu'elle prétend garder
a été **réintroduit**, la spec a **rougi**, le code a été rétabli, la spec a reverdi.

| spec | garde | vue rougir sur |
|---|---|---|
| connexion | la chaîne popup → jeton → `verify_id_token` → autz | (fumée, préexistante) |
| création ×2 | macro/bloc/semaine écrits + ligne vide matérialisée | `week` à la racine (B5) |
| semaine suivante | **la semaine PRÉCÉDENTE n'a pas bougé** après frappe | ids de la source copiés (B2) |
| **base sans dates S1** | la trame d'un bloc sans dates s'enregistre, dates restées vides | `s1StartDate` privé de `vide_en_none` → 422 sur l'écho — le bug des 54 blocs, tel quel |
| **athlète** | réalisé + forme par l'interface (2e compte émulateur) ; méta refusée en 403, poids accepté, par l'API | `"name"` glissé dans `_CHAMPS_ATHLETE` → 200 au lieu de 403 |
| **génération S1** | le bouton « Générer la semaine 1 » écrit les séances via `PUT /content` sur la semaine existante — le cas nominal, cassé deux fois | retour au `PATCH /weeks/{id}` historique → semaine restée vide |
| **suppressions** | bi-set délié par le serveur à la mort d'un membre ; dernière ligne, dernière séance, semaine — supprimables et supprimées | `_nettoyer_groupe` débranché → `groupId` orphelin sur le survivant |

Les assertions passent par `GET /training`, jamais par le DOM ; le décor se pose par
l'API, le GESTE par l'interface. Le périmètre athlète se prouve en deux moitiés :
l'interface pour ce qu'elle offre (le réalisé), l'API brute pour ce qu'elle n'offre
pas (le 403 — un client moins poli que l'interface existe toujours).

#### Lançable d'un geste — mesuré

`eitri/scripts/e2e-reel.sh` : monte ce qui manque (émulateur 9099, seeds idempotents
— dont le **second compte** `e2e-athlete-user`, lié par `athletes.user_uid` —,
brokkr-e2e 8082), puis joue les specs. **Départ à froid vérifié : trois ports
libres → 8/8 vertes en ~35 s**, exit 0. `--arret` éteint. Les procs `e2e-auth` et
`brokkr-e2e` sont aussi dans `mprocs.yaml` pour garder la stack sous les yeux en
écrivant une spec ; le geste de référence reste le script.

#### Défauts trouvés en chemin

**Dans le harnais lui-même — corrigés, commit `599ba73`.** Le filet avait ses
propres trous, et l'un est de la même famille que ceux qu'il chasse :

1. **la locale n'était pas épinglée** : l'i18n suit `navigator.language`, Chromium
   parle `en-US`, et les libellés traduits (`Rép. réelles`) étaient introuvables —
   les specs coach ne passaient que parce que leurs libellés sont **codés en dur en
   français**. Un vert qui tenait à un accident ;
2. le **reporter HTML** par défaut *sert* le rapport après un échec et **bloque** —
   le lancement d'un geste pendait indéfiniment sur toute spec rouge. `list` posé ;
3. la **popup de connexion** ne vient jamais si le clic part avant l'init du SDK :
   `seConnecter` re-clique au lieu d'attendre 30 s un événement mort ;
4. `firebase emulators:start` **sort en code 0 même quand le port est pris** — le
   piège des codes de sortie, encore ; le script teste le port avant et la
   disponibilité après, jamais le code.

**Dans le produit — prouvé, non corrigé (c'est une revue).** Une séance au nom
**vidé** (geste permis depuis le correctif A7) est **rebaptisée en silence** à la
copie de semaine : le repli du dictionnaire libre (`seance.get("name") or
"Séance N"`) invente un nom au passage. Ni refus ni perte — une réécriture muette,
le petit dernier de la famille (« la valeur change en route »). Preuve reproductible :

```
PATCH /sessions/{id} {"name": ""}          → 200 (voulu, A7)
POST  /blocks/{id}/weeks {sessions: écho}  → 201
GET   /training → source : ''   copie : 'Séance 1'
```

Rayon : cosmétique (aucune séance réelle au nom vide aujourd'hui) ; à trancher —
soit la copie préserve `''`, soit on assume le repli et on l'écrit. Même famille en
plus petit : le bouton de suppression d'une semaine s'intitule « Supprimer **le**
semaine » (`Supprimer le ${label.toLowerCase()}`) — l'accord est au code, et ma spec
le sélectionne tel quel : corriger le libellé cassera la spec, c'est voulu et noté
dedans.

#### État des suites après la passe

brokkr **599 ✓ + 1 sauté** · `verifier_contrats` : **0 refus sur 10 024 lignes**
réelles (bac à sable resynchronisé) · eitri : tsc ✓, eslint ≤ 54 ✓, **50 unitaires ✓**,
**77 e2e mock ✓**, **8 e2e réels ✓**. Les branches ne portent que les commits cités.

#### Ce que je n'ai pas pu faire, et pourquoi

- **brancher la stack en CI** : l'émulateur + Docker dans GitHub Actions est un
  chantier propre (et le workflow CI actuel d'eitri revendique « aucun appel à
  brokkr ») — pas entamé pour ne pas déborder du périmètre local ;
- les specs **concurrence / réessai / offline** : non déterministes avec le debounce
  de 400 ms, déjà actées hors périmètre v1 du harnais ;
- un vrai **départ machine-vierge** (sans `node_modules` ni navigateurs Playwright) :
  mon « à froid » = services éteints, dépendances présentes ;
- le **nettoyage `beforeEach`** et le branchement du harnais sur une base clonée
  (`ff_modele` → `ff_e2e`, l'avis de 4e passe) : le harnais actuel écrit dans
  `ff-training` sous `e2e-program` seul, c'est propre tant qu'on n'y joue pas à la
  main en même temps — le clone reste la cible si les campagnes se multiplient.

## 1. Verdict

**NO-GO en l'état — 6 bloquants.** Le socle données est **sain** (ETL fidèle à 100 %
sur 15 034 objets, 23,5 s chrono, garde-fous éprouvés) ; ce qui bloque est ailleurs :
la **topologie de bascule ignore la v2** (le front des athlètes), et cinq
**contrats front ↔ brokkr qui ne se parlent pas** — dont trois cassent en silence.
Tous sont corrigeables en heures, pas en jours ; le go est atteignable à la fenêtre
suivante.

## 2. Bloquants

### B1. La v2 — le front où vivent les athlètes — casse dès le déploiement de brokkr

**Le fait.** Le plan de bascule couvre brokkr + eitri, mais les athlètes sont sur
**rewrite.web.app (v2)**, et la v2 parle à brokkr aussi :

- elle **lit** `GET /programs/{id}/training` → dès le déploiement, cette route sert
  Postgres pour *tout le monde* (il n'y a pas de repli, décision assumée dans
  `programs.py`) ;
- elle **écrit** via les routes documentaires : `PATCH .../weeks/{id}/content`,
  `PATCH /macrocycles/...` (méta), `POST/DELETE /macrocycles...` (cycle de vie) —
  toutes écrivent **Firestore**, qui n'est plus lu par personne. Pire : la lecture
  Postgres sert des **uuid** comme ids de semaine/macro/bloc, et la v2 s'en sert pour
  bâtir ses chemins d'écriture Firestore → écriture sur des documents qui n'existent
  pas (perte pure, parfois silencieuse selon `set(merge)`/`update`) ;
- sa route objectifs `PUT /macrocycles/{m}/blocks/{b}/objectives` a été **supprimée**
  de `programs.py` dans cette branche → **404 immédiat**, avant même la fenêtre.

**Preuve.** `french-forge-trainer/app/src/brokkr.ts` lignes 340–507 (les huit routes
documentaires + `getTraining`) ; diff `programs.py` (suppression de
`replace_block_objectives`, `get_training` → `read_tree` sans repli).

**Rayon.** Tous les athlètes et coachs qui utilisent rewrite.web.app : chaque saisie de
réalisé après la bascule serait perdue de fait (écrite dans un Firestore que plus
personne ne lit).

**Correction.** La fenêtre de maintenance doit inclure la **mise hors service de la
v2** : servir le bundle eitri sur rewrite.web.app (même cible Hosting `app`, cf. la
topologie des deux sites), ou une redirection dure vers trainer.french-forge.com. À
défaut, ne pas déployer brokkr.

### B2. « Ajouter une semaine » : les frappes qui suivent écrivent dans la semaine PRÉCÉDENTE

**Le fait.** `buildNextWeek` (eitri, `training-editor.ts`) clone la dernière semaine
**avec les uuid de ses sessions et de ses exercices**. Après le `POST .../weeks`, le
front pousse `{...newWeek, id: res.ids.week}` dans l'état local : la semaine a le bon
id, mais ses lignes portent encore **les ids de la semaine source**. Toute frappe avant
le refetch part en `PATCH /exercises/{uuid de la semaine passée}` — le serveur
l'accepte (la ligne existe, elle appartient au même programme) et **écrase le réalisé
ou le prescrit de la semaine précédente**. Et comme ces patchs sont « pending »,
`hasPendingWrites()` **bloque la resynchronisation** qui aurait refermé la fenêtre :
tant que le coach tape, la corruption continue.

**Preuve.** Code : `training-editor.ts` 596–715 (`buildNextWeek` ne vide pas les ids ;
`addWeek` pousse la copie) + 316–339 (`updateExercise` → `schedulePatch('exercises',
cible.id, …)`). Côté serveur, test H8 (annexe) : un PATCH sur n'importe quelle ligne du
même programme répond 200.

**Rayon.** Chaque « Ajouter une semaine » suivi d'une édition rapide — le geste le plus
courant du coach en début de semaine. Corruption **silencieuse** : elle se découvre
trois semaines plus tard en relisant l'historique.

**Correction.** Dans `buildNextWeek`, supprimer `id` sur chaque session et exercice
clonés (comme il supprime déjà celui de la semaine) ; les frappes sans id sont alors
inoffensives (voir A4 pour les rendre non-perdantes), et le refetch réattribue les ids
serveur. Le chemin « nouvelle semaine » de `generateWeekOneFromBase` a la variante
inverse du même défaut (lignes générées **sans** id → frappes perdues jusqu'au
refetch).

### B3. `weightLocked` : le front parle chaîne, le serveur booléen — 997 lignes concernées

**Le fait.** La lecture Postgres rend `weightLocked: true|false` (booléen,
`_NON_TEXTE` dans `training_tree.py`). Tout le front le traite en **chaîne** `'true'|''`
(`types.ts:141`, `session-table.tsx:904-912`, `block-base-editor.tsx:848`,
`buildNextWeek` 679). Trois conséquences :

1. **l'état verrouillé ne s'affiche plus** (`ex.weightLocked === 'true'` est faux pour
   le booléen `true`) et le bouton, croyant verrouiller, renvoie toujours `'true'` —
   impossible de déverrouiller par l'interface ;
2. le geste « déverrouiller » (`weightLocked: ''`) est **refusé en 422** par
   `ExerciseLinePatch` (pydantic ne coerce pas `''` en booléen) ;
3. `buildNextWeek` traite toute ligne comme déverrouillée → **la charge des lignes
   verrouillées est effacée dans la semaine copiée** (`ex.weight = ''`), silencieusement.

**Preuve.** Test H4 (annexe) : `PATCH {"weightLocked": ""}` → **422**,
`{"weightLocked": "true"}` → 200. La base réelle porte **997 lignes verrouillées**
(+ 255 dans les BASE).

**Correction.** Trancher le type (booléen partout au front, ou normalisation
lecture/écriture en un seul point), et re-tester le trio affichage / toggle / copie de
semaine.

### B4. Le `kind` saisi dans la BASE (FRE-10) est jeté en silence

**Le fait.** L'éditeur de BASE permet de marquer un principe/accessoire
« échauffement » ou « kiné » (`block-base-editor.tsx` 234–294), et la génération
propage ce kind dans chaque semaine générée (`generate-from-base.ts` 163, 198). Mais
les tables `training_base_principles`/`training_base_accessories` **n'ont pas de
colonne `kind`**, `_COLONNES_PAR_TABLE` ne le liste pas (écarté sans erreur), et
`_BASE_SORTIE` ne le rend pas. Le PUT répond 200, la nature disparaît au resync
suivant — et toutes les semaines générées ensuite la perdent.

**Preuve.** Test H12 (annexe) : PUT `/blocks/{id}/base` avec `kind: "warmup"` sur un
principe → **200**, puis GET `/training` → la clé `kind` est absente de la ligne.

**Rayon.** FRE-10 — une fonctionnalité de cette même livraison — cassée sur son chemin
principal (c'est « le principe de la BASE » d'après le commentaire du front lui-même).

**Correction.** Colonne `kind` (même CHECK que `training_exercises`) sur les deux
tables de BASE + `_COLONNES_PAR_TABLE` + `_BASE_SORTIE`, et l'ETL n'a rien à faire
(aucune BASE réelle n'en porte encore).

### B5. « Ajouter un macro » échoue systématiquement en 422

**Le fait.** eitri envoie `POST /programs/{id}/macros` avec `week` **au niveau
racine** (`training-editor.ts` 553-555) ; `MacroCreate` est `extra="forbid"` et ne
connaît `week` **que niché dans `block`**. Tout ajout de macro → 422. Au passage, un
POST sans `block` ne crée **ni bloc ni semaine** alors que le front lit
`res.ids.week` : même corrigé le 422, le contrat « un macro naît avec son premier bloc
et sa première semaine » n'est tenu que si le client pense à envoyer `block`.

**Preuve.** Tests H2/H2b (annexe) : payload exact du front → **422** ; `POST {}` →
201 mais `ids` sans `week`. Le test de parcours brokkr passe parce qu'il envoie la
forme nichée `{"block": {"week": …}}` — les deux dépôts ont chacun raison contre
l'autre.

**Correction.** Côté front, nicher : `{name?, block: {base?, week: weekContentPayload}}` ;
côté brokkr, envisager de créer bloc+semaine par défaut même sans `block` (c'est le
comportement que `create_macro` documente).

### B6. Générer la semaine 1 depuis la BASE échoue quand la semaine 1 existe

**Le fait.** `generateWeekOneFromBase` sur une semaine existante fait
`PATCH /weeks/{id}` avec `{athlete, sessions}` — `WeekPatch` est `extra="forbid"` et
n'accepte que la méta. 422, rien n'est écrit. (Le front croit parler à un endpoint de
contenu qui n'existe plus ; son propre commentaire cite un `WeekContentBase` qui n'existe
pas dans brokkr.)

**Preuve.** Test H3 (annexe) : `PATCH /weeks/{id}` `{"athlete": …, "sessions": []}` →
**422**.

**Rayon.** Le flux trame → génération, cœur de la programmation par blocs, dans le cas
nominal (le bloc neuf naît AVEC une semaine 1 vide — cf. B5 — donc « existante »).

**Correction.** Un endpoint de remplacement du contenu d'une semaine (sessions +
lignes, transactionnel), ou : supprimer/recréer la semaine côté front.

## 3. À corriger avant de merger

- **A1 — `PATCH /macros/{id}` avec `startDate`/`endDate` → 500** (`UndefinedColumn` :
  `_CHAMPS["macro"]` mappe vers des colonnes que `training_macros` n'a pas — prouvé,
  test H1). Retirer ces champs de `MacroPatch` ou ajouter les colonnes. À noter : **un**
  macro réel porte ces dates dans Firestore (relevé par la comparaison), aujourd'hui
  jetées sans anomalie.
- **A2 — supprimer le dernier exercice/la dernière séance : le serveur obéit, le front
  refuse.** `removeExercise`/`removeSession` (eitri) gardent l'élément localement quand
  c'est le dernier (`length <= 1`) mais envoient **quand même** le DELETE. L'UI n'a
  aucune garde (le bouton est toujours là) : la ligne affichée n'existe plus, chaque
  frappe dessus fera un 404, et elle disparaîtra au resync. Soit garder la règle et ne
  pas appeler le serveur, soit lâcher la règle.
- **A3 — le verrou de resync ne couvre pas l'écriture en vol, et le retry peut ré-émettre
  du périmé.** `pendingPatches` est vidé **avant** l'appel HTTP (`persistPatch` après
  `pending.delete(key)`) : une resync qui arrive pendant le vol repeint l'UI avec l'état
  d'avant la frappe (la base est bonne, l'écran ment jusqu'au refetch suivant). Et en cas
  d'échec, le retry (1 s/3 s/8 s) ré-émet **l'entrée d'origine** si la file est vide — un
  patch plus récent parti et réussi entre-temps (debounce 400 ms) est alors écrasé par le
  vieux. Garder la clé dans une structure « en vol » jusqu'à la réponse, et faire porter
  au retry la dernière valeur connue.
- **A4 — la ligne fantôme.** `createEmptyWeek` (utilisé par addMacro/addBlock) embarque
  une ligne vide que le serveur **écarte** (prouvé, test H5 : semaine créée avec 0
  exercice). Le front affiche pourtant cette ligne, sans id : toute frappe dessus est
  **perdue en silence** (`schedulePatch` sans id ne fait rien) jusqu'au resync qui la
  fait disparaître. La décision « une ligne se crée VIDE par POST /exercises » est bonne ;
  le front doit s'y plier aussi à la création de semaine (créer la semaine sans ligne,
  puis POST la ligne vide), ou différer l'affichage.
- **A5 — deux 500 de contrat** : `PATCH /exercises {name: null}` → 500 (NOT NULL,
  test H6) alors que le contrat annonce « None efface » ; un id non-uuid dans l'URL →
  500 (`CAST`) au lieu de 404 (test H7) — un vieux client qui envoie un id Firestore
  produira des 500 en rafale.
- **A6 — l'athlète est élargi sur la méta de semaine.** Avant : la méta
  (nom/dates/hidden) était **coach seul** (`patch_week_meta`), seul le *contenu* était
  coach_or_athlete. Maintenant `PATCH /weeks/{id}` (nom, dates, hidden, poids) et
  `PATCH /sessions/{id}` (nom, date, forme) sont coach_or_athlete (prouvé, test H8 :
  l'athlète renomme et masque une semaine). Le commentaire « parité avec l'existant »
  est donc inexact pour la semaine. Si c'est assumé en attendant FRE-13, l'écrire ; sinon
  restreindre l'athlète à `athleteWeightKg`/`athleteHeightCm` + forme du jour.
- **A7 — deux gestes d'édition qui finissent en 422 silencieux (toast)** : renommer une
  séance à vide (`SessionPatch.name` a `min_length=1`, test H9) ; et une ligne de BASE
  au nom encore vide est écartée au PUT (même règle que A4) — l'accessoire qu'on vient
  d'ajouter disparaît à la sauvegarde si on n'a pas rempli le nom.

## 4. Remarques (ticket, pas blocage)

- **Le bilan final de l'ETL est tautologique** : `écrit` compte les itérations de
  `load()`, pas les lignes en base — il vaut `lu` par construction. Prouvé : deux
  séances de même `sessionId` dans une semaine **fusionnent** (l'upsert), le bilan
  affiche quand même ✅ 2/2 (test H10). Aucun doublon dans la donnée réelle
  aujourd'hui ; remplacer le bilan par des `SELECT count(*)` post-chargement.
- **L'ETL ne purge pas** : un objet supprimé de Firestore entre deux passes survit en
  Postgres (test H11 ; constaté aussi en vrai — la base locale d'hier portait 19
  exercices de plus que le Firestore d'aujourd'hui). Le soir J : **TRUNCATE des sept
  tables avant la passe finale**, puis counts SQL.
- **`_date` ment dans sa docstring** (« None ET une anomalie » — aucune anomalie n'est
  comptée) ; plus largement, les pertes de `_texte`/`_vocabulaire` ne s'enregistrent
  nulle part. Sur la donnée réelle d'aujourd'hui c'est sans effet (vérifié : zéro perte,
  cf. § équivalence), mais le jour où une valeur inattendue apparaît, elle tombera sans
  bruit.
- **Un programme Firestore n'est pas migré** : `M3nzrslgbR2OszYLjRQq` (créé 2026-04-17,
  athlète `IAjmd3TZRD12UF8UdXko` supprimé depuis, arbre vide : 1 macro/bloc/semaine,
  0 séance, 0 ligne). Orphelin cohérent — rien à perdre — mais à purger un jour pour que
  « Firestore = Postgres » soit vrai à l'objet près.
- `macro.createdAt` (45 macros) n'est pas porté → `created_at` vaudra la date de la
  bascule. Sans conséquence applicative connue.
- **Concurrence** : deux ajouts simultanés dans la même séance calculent le même
  `position` → violation d'unicité **au commit** (contrainte différée) → 500 pour l'un
  des deux. Rare et bruyant, acceptable ; à savoir.
- **Fermeture d'onglet** : le flush des patchs ne joue qu'au démontage React ; fermer
  l'onglet dans les 400 ms du debounce perd la dernière frappe (pas de `beforeunload`).
  Parité avec l'existant.
- **Lecture : des `null` subsistent** sur les noms et dates de macro/bloc/semaine/séance
  (le correctif null→`""` ne couvre que les lignes et la BASE). Le front actuel les
  garde derrière des conditions (vérifié pour `sessionDate`) — fragile mais pas cassé.
- **Tests** : les 615 brokkr sont majoritairement probants (l'appartenance est testée
  avec vérification d'absence d'écriture, la cascade avec counts) mais deux assertions
  molles tolèrent précisément l'ambiguïté qui a produit les bugs du 15/08 :
  `repsUnit in (None, "")` et `groupId in (None, "")` (`test_parcours_coach.py:157,192`)
  — les épingler sur la forme réellement servie. Les e2e eitri tournent **sur le mock**
  (writers no-op) : aucun des bloquants B2–B6 n'est à leur portée, c'est structurel
  (cf. la note E2E du projet). Non couverts : la concurrence, l'écriture après
  suppression (le serveur répond 404, le front toaste — vérifié à la main), le très
  gros programme (le plus gros réel : 838 lignes — la lecture six-requêtes n'aura aucun
  mal), et le parcours *athlète* réel de bout en bout.
- **Runbook** : `psql` sort en **code 0** même quand la migration échoue, si
  `ON_ERROR_STOP` n'est pas armé (constaté en rejouant la migration des objectifs avec
  un orphelin : ERREUR + ROLLBACK, exit 0). Le soir J, toujours
  `psql -v ON_ERROR_STOP=1`, sous peine d'enchaîner l'ETL sur une migration qui n'a pas
  pris.

## 5. Ce que la revue a validé (et comment)

- **Équivalence Firestore ↔ Postgres : totale.** Comparateur indépendant (script
  jetable, normalisateurs réécrits sans réutiliser ceux de l'ETL), clé = chemin legacy
  complet, comparaison champ à champ : **15 034 objets, 0 manquant, 0 en trop, 0 champ
  divergent** après une passe fraîche. (Une première passe montrait 11 divergences sur
  2 séances `gen-*` : de la saisie athlète en direct entre l'ETL et la comparaison —
  elles disparaissent en rejouant l'ETL. C'est aussi la démonstration que comparer sur
  une base vivante demande de recharger d'abord.)
- **Pertes des normalisateurs : aucune réelle.** Les seules valeurs non vides
  annulées : 307 `athlete.height` et 306 `athlete.weight` **à 0.0** (0 = non renseigné,
  et la lecture re-sert 0 — aller-retour neutre), plus les 2 lignes sans nom
  documentées. Aucune date illisible, aucun vocabulaire hors clou, aucune valeur
  numérique dans un champ texte.
- **Clés Firestore non portées, inventaire exhaustif** : `semaine.blockObjectives`
  (346 — déjà en Postgres depuis le 03/08), `macro.createdAt` (45), `macro.startDate`/
  `endDate` (1 — cf. A1). Rien d'autre : aucun champ inconnu du portage.
- **Idempotence : prouvée.** Deux passes dos à dos → dump ligne à ligne strictement
  identique (0 diff sur 9 961 lignes). Les uuid des lignes changent à chaque passe
  (delete+insert) — sans importance avant bascule, mais **ne jamais rejouer l'ETL après**
  (le garde-fou `BASCULÉ` + `--force-cutover-overwrite` couvre ça, à condition de penser
  à passer le drapeau à True le soir J).
- **Migration des objectifs : garde-fou et résolution corrects.** Rejouée sur base
  jetable : avec un objectif orphelin → RAISE + ROLLBACK complet, table intacte ; sans
  orphelin → résolution exacte y compris le piège du programme dupliqué (deux blocs de
  même `legacy_id` sous deux programmes reçoivent chacun LEUR objectif). Le schéma
  produit est identique à `docs/postgres-schema.sql` (colonnes et contraintes, diff
  vide) — donc identique à ce que la suite de tests exécute.
- **Autorisations serveur : la remontée tient.** Les tests du dépôt couvrent l'objet
  d'un autre programme (404 + absence d'écriture) à chaque niveau ; mes appels
  recoupent. Voir A6 pour le seul écart (athlète/méta).
- **Transactions** : chaque route = une transaction (`get_session`), `replace_base`
  (base + lignes + re-datation) et `create_macro` (macro+bloc+semaine) sont atomiques ;
  l'ETL charge tout dans **une** transaction (échec = rollback complet, pas d'état
  partiel).
- **Chrono** : ETL complet 23,5 s sur base vide (55 programmes), migrations < 1 s.
  La fenêtre de 15 min est très confortable pour la partie données ; le chemin critique
  est le déploiement (Cloud Run + Hosting) et la mise hors service de la v2 (B1).
- **Suites** : brokkr 615 ✓ (96,5 % de couverture), eitri `tsc` ✓, 29 unitaires ✓,
  75 e2e ✓.

## 6. Ce qui manque pour basculer (checklist du soir J)

1. Corriger B1–B6 (et idéalement A1–A7).
2. Décider du sort de rewrite.web.app **dans la même fenêtre** (B1).
3. `psql -v ON_ERROR_STOP=1` : migration arbre → **TRUNCATE** → ETL `--apply` → counts
   SQL (pas le bilan du script) → migration objectifs → passer `BASCULÉ = True` →
   déployer brokkr → déployer eitri → sortir la v2.
4. Écrire le plan de retour arrière. Il est simple **avant la première écriture** :
   redéployer l'ancien brokkr (Firestore n'a pas bougé, les tables Postgres neuves sont
   ignorées par l'ancien code). Le point de non-retour est la **première écriture d'un
   utilisateur** via les nouvelles routes : après, un retour Firestore perd cette
   écriture — le constater, c'est décider que le rollback n'existe que dans le quart
   d'heure de la fenêtre.
5. Pas de page de maintenance : à défaut d'en faire une, choisir un créneau mort et
   accepter des erreurs brutes pendant ~15 min.
6. Purger les routes Firestore mortes (dette, pas urgence — mais tant qu'elles vivent,
   un vieux client écrit dans le vide **sans erreur** : c'est un piège, pas un confort).

## 7. Ce que je n'ai pas pu vérifier, et pourquoi

- **Les orphelins réels de `block_objectives` sur Neon** : lecture de Neon interdite
  par les consignes de la revue. Le garde-fou fonctionne (prouvé sur base jetable),
  mais je ne peux pas dire s'il se déclenchera le soir J. Diagnostic à lancer juste
  avant : la requête du § 2 de la migration (count des `block_uuid IS NULL`) en
  transaction annulée.
- **La durée de l'ETL contre Neon** : mes 23,5 s sont mesurés contre un Postgres local
  (l'essentiel du temps est la lecture Firestore, qui ne change pas ; Neon ajoutera de
  la latence d'écriture — l'ordre de grandeur reste des dizaines de secondes, pas des
  minutes, mais je ne l'ai pas mesuré).
- **Le comportement réel de la v2 après bascule** (B1) : déduit du code
  (`app/src/brokkr.ts`, `useAthleteData.ts`), pas observé en conditions réelles — je
  n'ai pas déployé, et le dev-mock v2 ne reproduit pas la séquence.
- **Les bloquants front en conditions réelles de navigateur** : B2–B6 sont prouvés par
  appels HTTP contre le vrai brokkr (payloads recopiés du code front à l'octet près),
  pas en cliquant dans eitri branché sur brokkr local — les e2e du dépôt tournent sur
  mock et je n'ai pas monté un e2e réel dans le temps de la revue. Le risque résiduel
  (un payload que j'aurais mal recopié) est faible : les formes viennent du code, pas
  d'une supposition.
- **La charge concurrente** (deux onglets, coach + athlète simultanés) : non simulée.

---

## Annexe — preuves reproductibles

Tests exécutés sur le dispositif `pg` du dépôt (TestContainers postgres:16, schéma =
`docs/postgres-schema.sql`), arbre semé par `tests/fixtures_training.py`, client
FastAPI avec `verify_token` surchargé. Fichier volontairement **non versionné** (la
revue ne modifie pas la suite) ; chaque test tient en quelques lignes, recopiables :

```python
# H1 — MacroPatch expose des colonnes inexistantes → 500
r = client.patch(f"/programs/p1/macros/{macro_id}", json={"startDate": "2026-01-01"})
assert r.status_code == 500        # UndefinedColumn: start_date

# H2 — payload addMacro d'eitri (week à la racine) → 422
r = client.post("/programs/p1/macros", json={"week": {"athlete": {}, "sessions": []}})
assert r.status_code == 422        # extra="forbid" sur MacroCreate

# H2b — sans block, pas de semaine, mais le front lit res.ids.week
r = client.post("/programs/p1/macros", json={})
assert r.status_code == 201 and "week" not in r.json()["ids"]

# H3 — generateWeekOneFromBase sur semaine existante → 422
r = client.patch(f"/programs/p1/weeks/{week_id}", json={"athlete": {"weight": 70}, "sessions": []})
assert r.status_code == 422        # WeekPatch ne connaît ni athlete ni sessions

# H4 — weightLocked chaîne : '' (déverrouiller) refusé, 'true' accepté
assert client.patch(f".../exercises/{eid}", json={"weightLocked": ""}).status_code == 422
assert client.patch(f".../exercises/{eid}", json={"weightLocked": "true"}).status_code == 200

# H5 — createEmptyWeek d'eitri : la ligne vide est écartée → séance à 0 ligne
r = client.post(f".../blocks/{bid}/weeks", json=payload_createEmptyWeek_eitri)
# → 201, puis SELECT count(*) sur les exercices de la semaine créée == 0

# H6/H7 — name:null → 500 (NOT NULL) ; id non-uuid dans l'URL → 500 (CAST)
# H8 — l'athlète (uid lié) renomme et masque une semaine, renomme une séance,
#      modifie sets/weight d'une ligne : trois fois 200
# H9 — PATCH /sessions/{id} {"name": ""} → 422 (min_length=1)

# H10 — deux séances de même sessionId fusionnent, le bilan de l'ETL affiche ✅
ecrit = load(conn, arbre_avec_sessionId_duplique)   # ecrit["seances"] == 2
# SELECT count(*) → 1 : le bilan lu==écrit ne compare que le script à lui-même

# H11 — l'ETL ne purge pas : une semaine supprimée de l'arbre survit au re-run

# H12 — le kind d'une ligne de BASE est jeté en silence
client.put(f".../blocks/{bid}/base", json={"base": {"principles": [
    {"name": "SQUAT", "tier": 1, "kind": "warmup"}], "accessories": []}})  # → 200
# GET /training → la ligne n'a pas de clé "kind"
```

Commandes d'exécution (toutes rejouables) :

```bash
# ETL chronométré sur base locale vidée (TRUNCATE training_macros CASCADE d'abord)
time GOOGLE_APPLICATION_CREDENTIALS=.secrets/brokkr-sa.json \
  uv run python -m scripts.etl_training_tree --env .env.local-pg --apply   # 23,5 s

# idempotence : dump trié des 9 961 lignes avant/après re-run → diff vide

# migration objectifs sur base jetable : vieille forme + orphelin → RAISE + ROLLBACK
# (⚠️ psql sort en 0 sans -v ON_ERROR_STOP=1) ; sans orphelin → résolution correcte
# y compris deux programmes portant les mêmes legacy ids
```
