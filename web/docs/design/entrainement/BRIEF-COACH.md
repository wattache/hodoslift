# Entraînement — mode coach (grand écran et téléphone)

**Fichier unique de ce chantier.** Décisions, bug à corriger, cible, invariants. Écrit le 27/09/2026.

Visuels, dans ce dossier :

| Fichier | Ce qu'il montre |
|---|---|
| `coach-table.png` | Grand écran : colonnes essentielles, ligne 1 dépliée |
| `coach-phone.png` | Téléphone : la charge en cours d'édition |
| `coach-phone-liste.png` | Téléphone : la séance au repos |
| `maquette-coach-bureau.html` | Maquette cliquable, grand écran |
| `maquette-coach-telephone.html` | Maquette cliquable, téléphone |

⚠️ Les maquettes sont des prototypes jetables — HTML statique, mini moteur maison. Elles disent le comportement et la hiérarchie, pas la façon de coder.

---

## 0. Le bug à corriger en premier

**La charge est masquée par le cadenas** (remonté par un coach, capture à l'appui). Dans `session-table.tsx`, la cellule de charge en mode coach est un `EditCell` avec `className="pr-6"` et un bouton de verrou en `absolute right-0.5` **posé par-dessus le champ**. La colonne fait 82 px dans la grille (`cols`, ligne ~435) : il reste une quarantaine de pixels utiles, et « 232.5 » devient « 232 » puis « 16. ».

Le verrou n'a pas à être dans le champ. Mets-le **à côté**, comme le bouton `rep`/`sec` l'est déjà pour les répétitions : un bouton de 30 px, même hauteur que le champ, dans la même cellule de grille. Le champ retrouve toute sa largeur, la cible tactile passe de 20 à 30 px, et l'état verrouillé se voit sans survoler.

Deux corollaires :

- **Le champ de charge doit porter la couleur or** (c'est la donnée que le coach cherche) et le champ verrouillé une bordure ambre — pas seulement l'icône.
- **`aria-pressed` ne suffit pas** : l'infobulle « Charge verrouillée » n'est pas lue sur un bouton. Donne au bouton un `aria-label` complet qui dit l'état et ce qu'il implique (« Charge verrouillée : l'athlète ne peut pas la changer »).

## 1. Décisions (27/09)

1. **Grand écran : colonnes essentielles + dépli par ligne.** Fini le défilement horizontal de treize colonnes.
2. **Téléphone : saisie complète, pas un dépannage.** Le coach doit pouvoir écrire une séance entière depuis son téléphone, et pas seulement corriger une valeur.
3. **Le réel reste en lecture.** La colonne « Réel » vient de l'athlète ; le coach la lit, il ne l'écrit pas. Le dire à l'écran (pied de tableau).

## 2. Grand écran

Huit colonnes, largeurs fixes sauf le nom :

`28px` numéro · `1fr` exercice · `76px` séries · `92px` reps (+ bouton rep/sec) · `128px` charge (+ kg + verrou) · `84px` RPE cible · `168px` réel · `40px` chevron.

- **La colonne Exercice** porte le nom, la variante, le badge de nature (ÉCHAUFFEMENT, REHAB) ou de groupe (BI-SET), et **une ligne d'annexes en gris** : « tempo 20X1 · repos 180 s ». Ces valeurs restent visibles sans déplier — c'est de la lecture, pas de la saisie.
- **La colonne Réel** montre ce que l'athlète a fait, en vert quand c'est conforme, en ambre quand il y a un écart, avec le détail en dessous (« −5 kg sur les 2 dernières »). C'est ce que le coach vient chercher le lundi matin.
- **Le dépli d'une ligne** ouvre le reste : format, tempo, repos, assistance, nature, note du coach, retour de l'athlète, et les actions (lier à la ligne suivante, dupliquer, détail par série, retirer). Une seule ligne ouverte à la fois.
- **Le filet or à gauche** reste le marqueur de groupe, comme aujourd'hui.

## 3. Téléphone

Une carte par ligne, et la saisie dedans :

- **En tête de carte** : numéro, nom, badge, et en dessous **ce que l'athlète a fait** en une ligne (« FAIT 4 × 8 · 40 kg · RPE 7 »). Un menu `⋮` pour dupliquer, lier, déplacer, retirer.
- **Trois tuiles de 52 px** : séries, reps, charge — la valeur en gros, le libellé dessous. La charge est en or. À droite, le **bouton de verrou**, 48 px, jamais par-dessus la valeur.
- **Toucher une tuile ouvre l'éditeur sous la carte** : le champ en gros, un `−` et un `+` de 56 px au pas juste (2,5 kg pour une charge, 1 pour des séries, 0,5 pour un RPE), quatre raccourcis (−5, −2,5, +2,5, +5), puis **Terminé** et **Champ suivant** — qui passe à reps, puis charge, puis RPE, pour écrire une ligne entière sans jamais viser une petite cible.
- **Les annexes en pastilles** quand la carte est au repos : RPE, repos, tempo. Une pastille en pointillés « + tempo, assistance, note » ouvre les champs restants.
- **Pas de clavier obligatoire** : le stepper couvre 90 % des saisies. Le clavier reste accessible en touchant la valeur au centre, en `font-size: 16px` pour qu'iOS ne zoome pas.

## 4. Ce qu'il ne faut pas casser

`session-table.tsx` fait 1 940 lignes et porte les deux modes. Découpe-le (carte athlète / tableau coach / cellules), mais garde :

- **`EditCell`** : brouillon local, commit au `blur`, `Enter` qui valide. Toute la saisie du coach en dépend.
- **La recopie** (`ciblesDeRecopie`, `recopiable`) : recopier une valeur vers les lignes suivantes doit survivre au changement de disposition.
- **La navigation au clavier** (`naviguerAuClavier`) : les flèches passent de case en case, comme dans la base. Sur une grille à colonnes fixes, ça marche encore — vérifie-le, c'est ce que les coachs rapides utilisent.
- **Les règles de groupe** : séries et repos se saisissent sur la **première ligne du groupe** et se propagent aux membres ; un dropset n'a pas de repos ; un EMOM affiche la minute à la place du numéro. Tout ça vit dans `lib/groupe.ts` — ne le réinvente pas dans la vue.
- **`repsUnit`** (rep / sec), **`weightLocked`**, **les natures** (`training` / `warmup` / `rehab`, plus la bascule de toute la séance), **le glisser-déposer entre séances** (FRE-188), **le détail par série** (`seriesDeLaLigne`, `seriesRenseignees`), **la pastille d'objectifs techniques**, **`mechano` lu du serveur** (FRE-103).
- **Les libellés passent par `t()`** : neuf en-têtes étaient écrits en dur, ça a été corrigé, ne le refais pas.

## 5. Accessibilité

- Chaque champ garde un `aria-label` explicite : les libellés de colonnes sont des `div`, rien ne les relie au champ.
- Le verrou dit son état dans son nom accessible, pas seulement par la couleur et l'icône.
- Cibles ≥ 44 px sur téléphone (les champs actuels font 28 px de haut), et le dépli d'une ligne annonce son état avec `aria-expanded`.
- Le contraste du gris d'annexe (`text-muted-foreground/70` sur fond de carte) est à vérifier : sous 4.5:1, il ne peut pas porter une valeur comme le repos.

## 6. Vérification attendue

- Les tests existants passent (`entete-du-programme`, `exercise-progression`, `movement-history`, `format`).
- Nouveaux tests : la charge reste lisible à la largeur de colonne minimale ; le verrou bascule sans masquer le champ ; « Champ suivant » parcourt séries → reps → charge → RPE ; la recopie fonctionne encore depuis la nouvelle disposition ; une ligne de groupe n'expose pas la saisie des séries.
- Un passage au clavier sur le tableau : entrer dans une case, se déplacer aux flèches, valider.
- Un passage au doigt sur téléphone : écrire une séance de cinq lignes sans ouvrir le clavier.

## 7. Questions ouvertes

1. **Le tableau du coach sur tablette** (768–1279 px) : cartes ou tableau ? La maquette bascule en cartes sous 1280, ce qui laisse une tablette en mode téléphone — c'est peut-être trop tôt.
2. **La colonne Réel sur téléphone** : je la mets en une ligne sous le nom. Faut-il aussi le RPE ressenti par série, ou est-ce réservé au dépli ?
3. **Le glisser-déposer entre séances** n'a pas d'équivalent tactile dans la maquette. Un « déplacer vers… » dans le menu `⋮` suffirait-il ?
