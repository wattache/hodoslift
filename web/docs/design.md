# Les règles de dessin d'Eitri

⚠️ **CE FICHIER EXISTE PARCE QUE, SANS CONTRAINTE ÉCRITE, CHAQUE SESSION REPART
DES DÉFAUTS.** L'app est bâtie sur shadcn/ui et Tailwind. Laissés à eux-mêmes —
et c'est vrai d'un humain pressé comme d'un modèle — ils produisent toujours la
même page : une grille de cartes arrondies, des libellés en `text-[11px]
uppercase tracking-wider text-muted-foreground`, une valeur par gélule grise.
C'est lisible, c'est correct, et ça ressemble à toutes les autres. Le constat
qui a déclenché ce document, le 24/08 : « je trouve que tous les fronts se
ressemblent, on voit que c'est fait par Claude ».

La parade n'est pas de « faire plus joli ». C'est d'écrire les décisions pour
qu'on s'y réfère au lieu de les réinventer. Ce fichier est donc un RÈGLEMENT :
il dit ce qu'on fait, ce qu'on ne fait pas, et pourquoi.

Portée : la vue Entraînement (Aperçu et Détail) est la référence appliquée. Le
reste de l'app suit progressivement.

---

## 1. Typographie — trois rôles, jamais un de plus

| Rôle | Police | Sert à |
|---|---|---|
| `font-display` | **Barlow Condensed** 600/700 | titres, en-têtes de colonnes, étiquettes, jours |
| `font-sans` (défaut) | **Barlow** 400/500/600 | tout le texte courant |
| `font-mono` | **IBM Plex Mono** 500 | **les chiffres**, sans exception |

**Elles sont servies par nous** (`@fontsource`, importées une graisse à la fois
dans `main.tsx`). Pas de Google Fonts en direct : une app qui porte des bilans
kiné n'a pas à annoncer ses visiteurs à un tiers, et la PWA doit rendre pareil
hors ligne. Coût actuel : ~125 Ko de latin, pris une fois.

- ❌ Ne pas ajouter une quatrième famille. Trois rôles couvrent tout ; une
  quatrième police, c'est une hiérarchie qu'on n'a pas su exprimer autrement.
- ❌ Ne pas ajouter une graisse « au cas où ». Chaque graisse est un fichier
  téléchargé : l'ajouter est un choix, qui se justifie dans le commit.
- ✅ `h1`–`h4` prennent la condensée automatiquement (`index.css`). Pour un
  titre qui n'est pas un `h*`, utiliser `font-display` explicitement.

**Précédent** : `--font-sans` a déclaré `"Inter"` pendant des mois **sans que
personne ne la charge** — ni `@font-face`, ni lien. L'app tournait donc en
police système, différente sur chaque machine. Déclarer une police et la charger
sont deux gestes ; faire le premier sans le second ne se voit pas.

## 2. Les chiffres

Une charge, une série, un RPE se **comparent en colonne**. Ils sont donc :

- en `font-mono` — la chasse fixe est ce qui aligne « 32.5 » sous « 45 » ;
- **tabulaires** — `index.css` pose `font-variant-numeric: tabular-nums` sur
  tout ce qui porte `font-mono`, il n'y a rien à répéter ;
- **alignés à droite** dans une colonne, jamais centrés.

❌ Un nombre en police de texte dans un tableau. Il danse d'une ligne à l'autre,
et c'est exactement ce qu'un carnet d'entraînement ne doit pas faire.

## 3. Carte ou liste — la question à se poser

> Les éléments sont-ils **homogènes** (mêmes grandeurs, comparables entre eux) ?

- **Oui → une LISTE.** Filets, colonnes alignées, en-tête écrit une fois.
  Une séance, une semaine, un classement, un historique.
- **Non → une CARTE.** Un cadre isole ce qui n'a rien à voir avec son voisin.
  Le tableau de bord (RIS, prochaine compétition, forme du jour) est le bon
  usage : trois natures d'information sans rapport entre elles.

Ce qui rend une liste lisible n'est **pas** de séparer les valeurs, c'est de les
**aligner**. Une carte par exercice, ou une gélule par valeur, fabrique de la
séparation là où il fallait de la comparaison.

❌ Une carte autour d'un contenu tabulaire.
❌ Une ombre portée pour « détacher » une liste du fond.
✅ `border-b border-border/40` entre les lignes ; `border-y border-border/70`
autour d'un en-tête de colonnes.

## 4. Les étiquettes ne sont pas des gélules

Une étiquette (`EMOM`, `BI-SET`, `ÉCHAUFFEMENT`) **qualifie** une ligne. Elle ne
doit pas la concurrencer.

- ✅ `font-display text-[10px] font-bold uppercase tracking-[0.12em]`, couleur
  seule (`text-muted-foreground`, ou `text-gold` pour ce qui structure).
- ❌ `rounded-sm bg-muted px-1.5 py-0.5` — un fond et un cadre en font un objet
  aussi lourd que le nom du mouvement.

Exception : un élément **cliquable** (bouton, filtre, bascule) a droit à son
fond — c'est ce qui dit qu'on peut appuyer dessus.

## 5. L'or

`--gold` est l'accent de la marque. Il marque **ce qui compte le plus dans une
zone** : la charge dans une ligne d'exercice, l'onglet actif, le titre d'une
séance.

❌ Un aplat doré sur une zone entière (un bandeau d'en-tête, par exemple) quand
l'or sert déjà à marquer une valeur À L'INTÉRIEUR de cette zone : le même signal
finit par désigner deux choses différentes, donc plus rien.

## 5 bis. Un état se dessine, il ne s'efface pas

⚠️ **L'opacité ne signale pas un état.** Elle a été retirée quatre fois du même
produit — la vue semaine, les objectifs de bloc, les objectifs techniques, puis
les pastilles de semaine dans la barre du programme — et toujours pour la même
raison : elle fait passer la chose sous le seuil de contraste, donc elle dit
« illisible » là où on voulait dire « pas actif ».

Le cas qui tranche : une semaine **masquée** à `opacity-40` sur un chiffre de
12 px. Le coach vient précisément de la relire pour décider de la rouvrir, et il
ne peut pas. Un objectif **atteint** à `opacity-55` : la réussite efface ce
qu'elle récompense.

Le vocabulaire, stable depuis :

| signe | sens |
| -- | -- |
| **or** | ce qui est choisi |
| **tirets** | ce qui n'existe pas encore (une semaine sans séance, un athlète archivé) |
| **barré rouge** | ce qui est mis de côté |
| **mono** | un nom fabriqué par le générateur, pas choisi par un humain |

Dans les quatre cas, le texte garde sa pleine lisibilité : c'est le CADRE qui
porte l'état, jamais l'encre.

## 6. La densité dépend de qui regarde

Le même écran a deux publics, et ils ne veulent pas la même chose :

- **le coach, sur ordinateur** — voir la semaine entière d'un coup. Colonnes
  serrées, défilement horizontal accepté (la grille du Détail a treize
  colonnes, elle ne tiendra jamais sur un écran, et c'est très bien) ;
- **l'athlète, téléphone posé sur un banc, entre deux séries** — le mouvement et
  la charge, gros, et rien d'autre. Sous `sm`, les colonnes annexes repassent
  sous le nom plutôt que de rétrécir.

C'est la règle qui produit le plus de différence visible avec un template : un
dessin dérivé de la situation réelle ne ressemble à rien de générique, parce
qu'aucun template n'est fait pour cette situation-là.

## 7. Traduire, toujours

L'app est en **fr / en** — le polonais a quitté l'interface avec FRE-113 ; il
reste une langue de la page publique des coachs. Tout texte visible passe par
`t()`, y compris — surtout — les libellés décoratifs : en-têtes de colonnes,
unités, étiquettes.

Précédent : neuf des douze libellés de l'en-tête du Détail étaient en français
en dur à côté de deux `t()`. Sur un écran anglais, la ligne annonçait
« EXERCICE VARIANTE FORMAT TEMPO SETS REPS ». Personne ne l'avait vu tant que
c'était noyé dans un bandeau doré.

## 8. Deux indicateurs côte à côte n'en font qu'un

Deux objets de même taille, dans la même zone, disant tous deux « c'est bon » ne
se distinguent pas — quelle que soit la différence de couleur, d'icône ou de
libellé. Le lecteur en voit **un**, et se demande pourquoi il est écrit deux
fois.

- ✅ un seul objet, plusieurs glyphes : on lit l'état principal, le second
  **qualifie**.
- ❌ une seconde pastille à côté de la première.

Précédent (FRE-118) : « Enregistré » et « Sur ton téléphone » sont des promesses
**inverses** — l'une dit que ce qu'on a tapé est parti, l'autre que ce que le
serveur a donné est gardé ici, et on peut avoir l'une sans l'autre. Elles ont
pourtant été lues comme un doublon au premier coup d'œil, par la personne qui
avait demandé la seconde. La distinction était réelle ; c'est la mise en page qui
l'effaçait.

⚠️ Corollaire : un indicateur qui n'a **presque jamais** quelque chose à dire ne
s'affiche que quand il l'a. « Pas encore disponible hors ligne » serait exact
pendant la seconde qui suit le chargement, donc faux le reste du temps — et une
alerte qui a presque toujours tort s'apprend à ignorer.

## 9. Avant de committer un écran

1. Le regarder **en dev-mock** (`npm run dev`, ou la config `eitri-mock`), en
   **desktop et en mobile** — pas seulement dans sa tête ;
2. le regarder **en anglais** : un texte en dur s'y voit immédiatement ;
3. relire la liste des ❌ ci-dessus ;
4. `npm run lint` — le budget d'avertissements ne monte pas.

---

## Ce que ce document ne dit pas encore

Le mouvement, les états de chargement, les graphiques (voir la palette validée
en tête d'`index.css`, qui a ses propres règles et son validateur), et le
tableau de bord — qui garde ses cartes à dessein, cf. §3. À écrire quand ces
écrans passeront à leur tour.
