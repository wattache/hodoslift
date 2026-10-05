# Progression sur le bloc — un catalogue de rendus, au choix de chacun

**Fichier unique de ce chantier.** Écrit le 27/09/2026, réglage revu le 28/09.

Visuels, dans ce dossier :

| Fichier | Ce qu'il montre |
|---|---|
| `progression.png` | Les huit rendus, mêmes données |
| `progression-profil.png` | Le réglage dans le profil — rendu « Une phrase » |
| `progression-profil-courbe.png` | Le même, rendu « Courbe » |
| `progression-profil-marches.png` | Le même, rendu « Marches » |
| `progression-profil-chiffres.png` | Le même, rendu « Chiffres » |
| `maquette-galerie.html` | Galerie cliquable |
| `progression-reglage.png` | **Le réglage compact, dans le profil** — la version retenue |
| `maquette-reglage.html` | Le réglage compact, cliquable |
| `maquette-profil.html` | Première version, écran plein — conservée pour mémoire, non retenue |

⚠️ Maquettes jetables : elles disent le comportement et la hiérarchie, pas la façon de coder.

---

## 1. Le point de départ

La carte « Progression sur le bloc » a perdu sa courbe. Sur la capture du 27/09, il reste les semaines, le volume et le RPE ; la bande qui portait le tracé est vide, et sur un exercice **sans charge** — élastique RB30 / RB20 / RB15 — elle ne pouvait de toute façon rien tracer : `CourbeDeCharge` ne connaît que `kgEffective`, et l'assistance n'est qu'un texte posé au milieu de la bande.

Deux choses en découlent :

1. **La courbe revient** (rendu A).
2. **Un exercice assisté a sa propre progression** : un élastique plus fin est une montée, pas un trou. C'est le rendu H.

Et un constat de terrain : plusieurs athlètes n'aiment pas le rendu actuel. Plutôt que de chercher celui qui plairait à tous, **on en propose plusieurs et chacun choisit le sien**.

## 2. La règle commune : quatre valeurs, toujours

**Quel que soit le rendu, une semaine porte séries × reps, charge et RPE** (décision du 27/09). Un dessin qui ne montrerait que la charge oblige à ouvrir autre chose pour comprendre — donc il ne sert à rien.

Le socle d'une semaine, identique partout :

| Valeur | Écriture | Quand le réel s'écarte |
|---|---|---|
| Séries × reps | `3×2` | `3×2 → 3×1` |
| Charge | `65` | `65→62,5`, en ambre |
| RPE | `8` | `8→9`, couleur du ressenti |
| Semaine à venir | — | `RPE 8 visé`, contour pointillé |

Règles d'écriture :

- **Le réel prime, le prescrit reste visible.** La barre, le point ou le chiffre porte ce qui a été fait ; le prescrit apparaît en gris, en contour pointillé ou avec une flèche. Jamais l'inverse, et jamais le prescrit seul quand un réel existe.
- **Une seule couleur pour l'écart** : l'ambre `#E0A93C`. Le vert et le rouge restent au RPE.
- **Rien ne s'écrit deux fois** : quand prescrit et réel sont égaux, un seul chiffre.

## 3. Les huit rendus

Tous lisent les mêmes `ProgressionPoint[]` (`exercise-progression-data.ts`) — aucun n'a besoin de données nouvelles : `sets`, `reps`, `repsDone`, `kg`, `kgDone`, `aimedRpeRaw` et `rpeRaw` y sont déjà.

| Id | Nom | Ce qu'il répond | Pour qui |
|---|---|---|---|
| `courbe` | **Courbe** | « Est-ce que ça monte, et à quel rythme ? » | Coach analyse · défaut |
| `barres` | **Barres** | « Quelle semaine était la plus lourde ? » | Athlète, lecture simple |
| `marches` | **Marches** | « J'ajoute combien chaque semaine ? » | Athlète |
| `chiffres` | **Chiffres** | « Donne-moi les nombres » | Athlète ou coach, sans dessin |
| `phrase` | **Une phrase** | « Est-ce que je progresse ? » | Athlète en séance |
| `effort` | **Coût de l'effort** | « Ça monte, mais à quel prix ? » | Coach analyse |
| `marche-suivante` | **Prochaine marche** | « Je mets combien la semaine prochaine ? » | Coach programmation |
| `assistance` | **L'aide diminue** | Le cas sans charge, élastique | Automatique quand l'exercice est assisté |

Détails qui comptent :

- **Courbe** : trait de 2 px, points de 8–10 px, **étiquettes sélectives** — première semaine, dernière faite, semaine en cours — jamais un nombre sur chaque point. Le trait se coupe sur les trous (une semaine sans prescription n'est pas une progression), et la semaine à venir est en pointillés. Le RPE vit **sous l'axe**, en pastilles colorées : jamais un second axe (deux échelles dans un même cadre, c'est l'erreur classique).
- **Barres** : la hauteur est la charge, la valeur est écrite au-dessus, le RPE sous l'axe. Semaine à venir en contour pointillé.
- **Marches** : l'écart (`+2,5`) est écrit **entre** les marches — c'est l'information que la courbe fait deviner.
- **Chiffres** : la grille actuelle, plus une ligne « Écart » qui manquait.
- **Une phrase** : un titre chiffré (`60 → 65 kg`, `+5 kg`), une phrase qui dit si l'effort a suivi, et une sparkline muette. Rien à décoder pendant une série.
- **Coût de l'effort** : une ligne par semaine, la largeur dit le RPE, le chiffre dit la charge. Rend visible le cas « ça monte mais le RPE grimpe avec ».
- **Prochaine marche** : les semaines faites en sourdine, la semaine à programmer en pointillés, et trois propositions calculées à partir du pas du bloc (idem / +2,5 / +5) qui écrivent directement la charge.
- **L'aide diminue** : barres décroissantes de la force d'élastique, avec le texte « l'aide a baissé de deux crans ». S'impose tout seul quand `kgEffective` est nul sur toutes les semaines et qu'une assistance existe.

## 4. Le réglage — compact, jamais un écran à part

⚠️ **Correction du 28/09.** La première version a été implémentée comme une page entière avec deux aperçus géants ; sur grand écran c'est disproportionné, et ça oblige à quitter ce qu'on regardait. Le réglage vaut deux lignes de la page Profil, pas un écran.

Le motif (cf. `progression-reglage.png`) :

- **Une section de la page Profil**, pas une route. Titre, sous-titre d'une ligne, et c'est tout.
- **Des vignettes de la taille d'un bouton** — 104 × 40 px de dessin dans une tuile d'environ 150 px de large. Ce sont des **silhouettes** du rendu (un trait qui monte, trois barres, trois marches, trois lignes de texte), pas des données lisibles : à cette taille, personne ne lit « 62,5 ». Le rendu choisi passe en or, les autres en gris.
- **Deux rangées** : « En mode athlète » et « En mode coach ». La seconde n'apparaît que pour un coach.
- **Pas d'aperçu géant.** Le vrai aperçu, c'est la carte elle-même, une fois de retour dans la séance.
- **Sur téléphone**, trois vignettes par ligne : les cinq tiennent sans défiler.

**Et surtout, le même sélecteur dans l'en-tête de la carte** : les mêmes silhouettes en 26 px, à droite du titre « Progression sur le bloc ». On essaie un rendu là où on le lit, sans quitter la séance ; la page Profil ne fait que refléter le dernier choix. C'est le chemin principal — le profil est le chemin de secours, pour qui cherche ses réglages au même endroit que le reste.

Contextes et stockage :

| Contexte | Où | Défaut proposé |
|---|---|---|
| `athlete` | La carte dans les séances de l'athlète | `phrase` |
| `coach` | La même carte chez ses athlètes | `courbe` |

Deux contextes suffisent (la question posée le 27/09 est tranchée : quatre, c'était trop). Préférence utilisateur côté brokkr, repli `localStorage`, clé `progression.athlete` / `progression.coach`. Le réglage d'un coach ne change pas ce que voient ses athlètes, et inversement — écrit sous les deux rangées.

## 5. Implémentation

- **Un composant, un paramètre.** `<ProgressionBloc points={points} rendu={rendu} contexte={contexte} />`, et un rendu = un petit composant qui reçoit `ProgressionPoint[]`. Aucun ne refait de calcul : le delta, le pas médian du bloc et le verdict RPE se calculent une fois (`TrajectoireDeCharge`, `verdictRPE` existent déjà).
- **Le repli automatique** : si le rendu choisi ne peut rien montrer (exercice assisté et rendu `courbe`), on bascule sur `assistance` sans le dire deux fois — pas de carte vide comme aujourd'hui.
- **Une seule source de couleur** : le RPE passe par `rpeDotColor`, la charge par l'or du thème. Les couleurs de statut (vert / ambre / rouge) restent réservées au RPE et ne servent jamais de « série 2 ».
- **Pas de second axe, jamais.** Si un jour il faut charge + tonnage, ce sont deux cartes ou deux rendus, pas deux échelles.
- **Accessibilité** : chaque rendu porte un `aria-label` qui dit la trajectoire en toutes lettres (« 60 kg en S1, 65 en S3, 67,5 prévu en S4 »), et le rendu `chiffres` sert de vue tableau pour tous les autres. Le RPE n'est jamais porté par la seule couleur : la pastille contient le nombre.
- **Mobile** : les rendus `phrase`, `marches` et `chiffres` tiennent sous 390 px sans rien couper ; `courbe` et `barres` gardent une hauteur réduite (80 px de bande, comme `GEOMETRIE_TELEPHONE` le fait déjà).

## 6. Vérification

- **Un test par rendu qui vérifie la présence des quatre valeurs** : séries × reps, charge, RPE, et l'écart quand il existe. C'est la règle qui se perd en premier au fil des retouches.
- Un test par rendu : quatre semaines dont une sans prescription, un exercice assisté, un exercice à une seule semaine (la carte ne s'affiche pas), une semaine où le réel s'écarte du prescrit.
- Le changement de rendu ne recharge rien : même `points`, autre dessin.
- La préférence survit à un rechargement et suit l'utilisateur sur un autre appareil.
- Capture d'écran de chaque rendu à 390 px et à 1280 px, pour vérifier qu'aucune étiquette ne se chevauche.

## 7. Questions

1. **Quatre contextes, est-ce trop ?** On peut n'en garder que deux — « en séance » et « analyse » — et laisser le coach utiliser le même réglage partout.
2. **Le défaut pour un nouvel athlète** : `phrase` (rassurant, sans lecture) ou `courbe` (ce que l'app montre aujourd'hui) ?
3. **Faut-il proposer ces rendus aussi dans la BASE** (historique d'un mouvement hors bloc), où la même question se pose sur douze semaines au lieu de quatre ?
