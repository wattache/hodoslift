# Écran Plateau — brief complet (compétition)

**Fichier unique et source de vérité pour ce chantier.** Tout ce qu'il faut est ici : les décisions, l'état du code, la cible, les invariants, les pièges. Mis à jour le 24/09/2026.

Les visuels sont dans ce même dossier (`docs/design/competition/`) :

| Fichier | Ce qu'il montre |
|---|---|
| `plateau.png` | Écran large, groupe B en piste, muscle up essai 2 |
| `plateau-groupeA.png` | Le même, groupe A, essai 3 — la feuille d'un groupe qui a fini son tour |
| `plateau-phone.png` | Téléphone, onglet Feuille |
| `plateau-phone-classement.png` | Téléphone, onglet Classement |
| `maquette-plateau.html` | Maquette cliquable, écran large — à ouvrir dans un navigateur |
| `maquette-plateau-telephone.html` | Maquette cliquable, téléphone |

⚠️ Les maquettes sont des prototypes jetables : HTML statique, `<path>` et `<button>` bricolés, mini moteur de rendu maison. **Elles disent le comportement et les couleurs, pas la façon de coder.** L'implémentation garde React, les composants existants et les règles d'accessibilité ci-dessous.

---

## 1. La mission, en une phrase

Fusionner la vue Grille et le mode Live en un seul écran — le Plateau — où la feuille de match sert de sélection et le panneau de droite de saisie, sans rien perdre de la mécanique P / R / O ni des règles de passage livrées par FRE-204.

Le travail est dans `src/views/competition-detail.tsx` (850 lignes : vue + `LiveMode` + `TierAttemptCell` + inline RIS/projection). Découpe-le en composants sous `src/components/competition/` au passage.

## 2. Décisions figées le 24/09 — appliquer telles quelles

1. **Le tour suit le plateau, sans arracher la consultation.** Au chargement, on ouvre `premierTourOuvert`. Quand le dernier verdict d'un tour tombe, le panneau passe au tour suivant. Mais dès que le coach a navigué à la main (flèches, ou clic sur une case d'un autre tour), le suivi s'arrête : un verdict qui tombe ailleurs ne le ramène plus. Un bouton **« Revenir au tour en cours »**, visible seulement quand le tour affiché n'est pas celui du plateau, réarme le suivi.
2. **Cliquer la case d'un athlète d'un autre groupe bascule le groupe en piste**, et le tour affiché devient celui de cette case. C'est le geste qui sert aussi à préparer la feuille du groupe suivant. Le suivi automatique s'arrête comme au point 1.
3. **La saisie libre `±` reste possible pendant la compétition**, soumise au plancher : un athlète annonce souvent hors de son plan.
4. **Les coachs et l'admin écrivent, l'athlète lit.** C'est ce que brokkr applique et ce que la liste des compétitions borne déjà ; l'écran de détail propose encore ses boutons à tout le monde — borne-le. Sans droit d'écriture, les cases de la feuille ne sont plus des boutons (pas seulement désactivées : hors tabulation) et le panneau devient un panneau de lecture.
   *(Ne pas confondre avec l'écran des douleurs, où la règle est l'inverse : l'athlète écrit, le staff lit.)*

## 3. Ce que le code fait déjà — ne pas réécrire

`src/lib/comp-helpers.ts`, couvert par `comp-helpers.test.ts` :

- `ordreDuTour(participants, flight, mouvement, essai)` — l'ordre de barre : les jugés sortent de la file et restent en tête, les autres passent de la charge annoncée la plus légère à la plus lourde, l'essai précédent départage, puis l'ordre d'inscription ;
- `chargeAnnoncee` — ce qu'un essai montre : le tier choisi, sinon le R, propre ou hérité ;
- `chainedInheritedTiers`, `effectiveTiers` — l'héritage des trois charges ;
- `plancherDAnnonce` — une annonce ne baisse pas (brokkr refuse en 422 `annonce_en_baisse`) ;
- `sequenceDesTours`, `flightsEnLice`, `premierTourOuvert` — la séquence des tours, groupe par groupe ;
- `classementDuGroupe` (au total) et `classementAuRis` (général).

Les **groupes** existent aussi : `comp.flights: Flight[]` (nom + catégories, l'ordre de la liste étant l'ordre de passage), `participant.flight` déduit par brokkr, `FlightsEditor` pour les éditer, une catégorie dans un seul groupe (422 `categorie_dans_deux_flights`). **Rien à ajouter au modèle.**

## 4. Ce qui manque — le cœur du chantier

1. **Les deux vues sont séparées et se contredisent.** `mode: 'grid' | 'live'` est toujours là. La grille range par classement, le live par ordre de barre ; le live ne montre pas la feuille, la grille ne dit pas où en est le plateau.
2. **`sequenceDesTours` est écrite et testée mais aucun écran ne l'appelle.** Le live navigue en `movIdx` / `attIdx` dans le groupe courant : « Suivant » s'arrête au dernier essai du groupe au lieu de passer au suivant, et « Étape n / 12 » est l'étape du groupe, pas de la compétition.
3. **Le plancher ne protège que les pastilles.** La saisie libre (`TierInput`) accepte une baisse ; le refus arrive du serveur, en 422, après coup.
4. **Le classement a disparu du live** depuis FRE-204, alors que c'est la question qui revient entre deux barres.
5. **Les feuilles dépliables restent un mur** : un tableau 3 × 4 par athlète, replié par défaut. La grille compacte les remplace.
6. **Le téléphone n'est traité nulle part** : un seul point de rupture (`md:grid-cols-2`), la feuille en `overflow-x-auto`, `max-w-5xl` sans variante étroite. C'est pourtant l'écran du bord de plateau.

## 5. La cible — écran large

Deux colonnes : la feuille à gauche, le panneau de saisie à droite (`plateau.png`).

### La feuille

Une ligne par athlète, **12 cases** (4 mouvements × 3 essais), groupées par mouvement, l'en-tête portant le nom du mouvement et E1 / E2 / E3. Chaque case porte `chargeAnnoncee`, **la lettre du tier annoncé**, et son état :

| État | Fond | Bordure | Texte |
|---|---|---|---|
| REP | `rgba(78,154,107,0.16)` | `#4E9A6B` | `#8FD3A8` |
| NO REP | `rgba(214,90,74,0.14)` | `#D65A4A` | `#E78C7F` |
| Tour en cours, pas jugé | `#241F14` | `#D4A843` | `#EEECF2` |
| Prévu | `#17161A` | `#2A2930` | gris — **remonter le `#6E6A76` de la maquette, il ne passe pas 4.5:1** |
| Case sélectionnée | — | `2px #D4A843` | — |

**Cliquer une case la sélectionne** : elle devient l'essai du panneau, et le tour affiché suit (groupe, mouvement, essai). C'est ça, la fusion — la feuille n'est plus un formulaire, c'est la sélection.

Les athlètes sont groupés par flight (`flightsEnLice`), le groupe en piste en pleine opacité, les autres en retrait mais lisibles. **Dans un groupe, les lignes suivent `ordreDuTour` du tour affiché**, pas le classement : la pastille devant le nom porte le rang de passage, ou ✓ si l'essai est jugé. Changer une annonce réordonne les lignes — c'est l'information, pas un effet de bord.

À droite de chaque ligne : le total, une barre acquis / projection, et les `projection` P R O servies par le serveur.

Sous la feuille, **l'ordre de barre du tour** en cartes, dans l'ordre de passage, avec la charge de chacun.

### Le panneau

1. **Le tour** — « TOUR n / N · GROUPE B », le mouvement, l'essai, les flèches ‹ › qui **naviguent dans `sequenceDesTours`** (au dernier essai d'un groupe, « suivant » ouvre le premier tour du groupe d'après), une barre de segments (vert = tour fini, or = en cours, gris = à venir), et le bouton « Revenir au tour en cours » quand on a décroché.
2. **En barre** — l'athlète sélectionné, sa catégorie, la charge en grand, les trois pastilles P / R / O. Une pastille sous `plancherDAnnonce` reste hors d'atteinte, **avec la raison visible** (`competition.annonceEnBaisse`), pas seulement en `title` : un bouton désactivé ne transmet pas son `title` aux lecteurs d'écran. Le `±` ouvre la saisie libre, soumise au même plancher. Sous les pastilles, la conséquence : « passe en 1er sur 3 — une annonce ne baisse pas ».
3. **REP / NO REP** en gros boutons, via `verdictBascule`. Sur NO REP, `getNorepReasons(movName)` en pastilles plutôt qu'en `<select>`, plus la case VAR.
4. **Classement du groupe, au total** (`classementDuGroupe`), avec le rappel que le général se fait au RIS après le dernier squat. Le classement général au RIS reste en fin d'écran.

## 6. La cible — téléphone

`plateau-phone.png` et `plateau-phone-classement.png`. Une colonne :

1. **Le tour** : groupe, mouvement, essai, flèches, segments, et les **pastilles de groupe en piste** (l'équivalent mobile des onglets).
2. **L'athlète en barre** : nom, catégorie, charge annoncée en grand, **les trois pastilles P / R / O avec leurs kilos** (54 px de haut, visables sans regarder), le plancher rappelé à côté du titre (« plancher 10 kg »), le `±` pour une charge hors plan. Puis REP / NO REP pleine largeur (56 px), et sur un no-rep les motifs en pastilles défilantes + la case VAR.
3. **L'ordre de barre du groupe**, une ligne par athlète avec sa charge, touchable pour passer à lui.
4. **Un bloc à deux onglets, Feuille et Classement** : la feuille du seul athlète sélectionné (4 × 3 cases, charge + lettre du tier, touchables), ou le classement du groupe au total.

Contraintes : cibles ≥ 44 px, champs en `font-size: 16px` (sinon iOS zoome), `env(safe-area-inset-*)` comme `app-shell`, **aucun défilement horizontal**. La préparation du plan — saisir les trois charges — doit rester faisable au téléphone : le plan se retouche la veille au soir et entre deux mouvements.

## 7. Le P / R / O se garde partout

C'est la mécanique de la feuille, pas un ornement de la vue large. Un essai porte trois charges candidates — P pessimiste, R réaliste, O optimiste — et **annoncer, c'est en choisir une**. Doivent survivre :

- les trois charges éditables, avec les `±` par tier (`BUMP_STEP` = 1.25) ;
- l'héritage `chainedInheritedTiers`, visible en placeholder sur un essai vide ;
- `chargeAnnoncee` comme seule source de ce qu'une case affiche ;
- `plancherDAnnonce`, tier par tier ;
- la lettre du tier dans la case.

Une vue qui ne montrerait qu'une charge par essai casserait la préparation du plan, qui est la moitié de l'outil.

## 8. Ce qu'il ne faut pas casser

- **Le RIS et les projections viennent du serveur** (FRE-141, FRE-203). Ne pas les recalculer : le RIS n'a de sens qu'après le dernier squat.
- **La persistance debouncée** (~600 ms, un write par rafale, garde-fou contre l'écrasement par un snapshot arrivé entre-temps) survit au refactor telle quelle.
- **L'identité par index** dans toute la vue : `ordreDuTour` rend des index, `setAttempt(pi, mi, ai, …)` les attend. Passer à des ids, si tu le fais, se fait partout d'un coup.
- **L'index du mouvement chez l'athlète** n'est pas celui de la compétition : garder le `p.movements.findIndex(m => m.name === movName)` que le live fait déjà, un participant pouvant ne pas avoir tous les mouvements.
- **`verdictBascule`** reste la seule porte pour poser un verdict (recliquer REP annule).

## 9. Pièges connus

- **`chargeAnnoncee` ignore une charge libre sans tier** : elle ne rend `weight` que si `selectedTier` est posé. Une saisie libre sans convention ferait calculer l'ordre de barre sur le R du plan — une charge que personne n'annonce. Choisis : soit la saisie libre écrit dans le tier choisi (le plan bouge), soit elle pose un marqueur d'annonce hors plan que `chargeAnnoncee` lit en premier. Ajoute le test qui l'atteste.
- **`title` sur un bouton désactivé** n'est pas restitué par tous les lecteurs d'écran : la raison d'un refus d'annonce se lie en `aria-describedby` ou s'affiche.
- **Contraste** : le gris des cases « prévu » de la maquette ne passe pas 4.5:1. À remonter.

## 10. Accessibilité

Chaque case est un `<button>` avec un `aria-label` complet (« Willi Lagachette — PULL UP essai 2, no rep, 62.5 kg ») et `aria-pressed` pour la sélection : l'état ne passe jamais que par la couleur. Les pastilles P / R / O forment un groupe nommé. Sans droit d'écriture, les cases sortent de la tabulation.

## 11. i18n

Réutiliser l'existant (`competition.groupe`, `groupeEnPiste`, `horsGroupeCourt`, `annonceEnBaisse`, `classementGeneralRis`…). Nouvelles clés pour : tour n / N, ordre de barre, en barre, charge annoncée, « passe en {{n}}e sur {{total}} », l'état d'un tour, « Revenir au tour en cours ». Rien de codé en dur dans le JSX.

## 12. Vérification attendue

- `comp-helpers.test.ts` passe sans modification : ces fonctions ne changent pas.
- Tests de vue : cliquer une case sélectionne l'essai et déplace le tour ; annoncer réordonne les lignes du groupe ; une annonce sous le plancher est refusée **avant** l'appel réseau ; « suivant » au dernier tour d'un groupe bascule sur le groupe suivant ; le suivi automatique s'arrête après une navigation manuelle et reprend au bouton de retour.
- `e2e/` : un tour complet — annoncer, juger REP, vérifier le total, l'ordre du tour suivant, et qu'un seul write part après la rafale.
- Un passage au clavier : atteindre une case, la sélectionner, annoncer, juger.
