# Déclarer une douleur — refonte

**Fichier unique de ce chantier.** Écrit le 27/10/2026, sur la version 1.0.50.
**Complété le 27/10 au soir : §8 à §12 portent la forme retenue.**
**Intégré le 28/10** (§14), avec le panneau de droite redessiné d'après la
maquette « Desktop Redesign » que William a retenue.
On le lit en premier ; les captures l'illustrent.

| Fichier | Ce qu'il montre |
|---|---|
| `1-repos-{bureau,telephone}.png` | L'onglet Douleurs au repos : la figure, les douleurs en cours |
| `2-declarer-deux-zones-…` | Deux zones libres touchées : la déclaration s'ouvre |
| `3-zone-deja-suivie-…` | Une zone qui porte déjà une douleur : sa carte s'ouvre, « Nouvelle douleur » à côté |
| `4-modifier-les-zones-…` | « Modifier les zones » depuis la carte : la figure édite les zones de CETTE douleur |
| `5-seance-zone-suivie-…` | Le volet « Signaler une gêne » d'une ligne de séance, sur une zone suivie |
| `6-seance-nouvelle-…` | Le même volet, « Nouvelle douleur » choisie |
| **`propose-bureau.png`** | **La proposition, grand écran : le choix, le sujet de la figure, l'échelle** |
| **`propose-telephone.png`** | **La proposition, 375 px : les trois écrans** |
| **`maquette-declaration.html`** | **La maquette cliquable (bascule clair / sombre)** |

Captures prises sur le dev-mock (données de démonstration, thème sombre).

⚠️ **Ce qu'on attend : une maquette cliquable et ce brief mis à jour, pas du code.**
La maquette dit la forme et le comportement ; l'intégration se fait ensuite.

---

## 1. Pourquoi

Une douleur porte désormais **plusieurs zones**, et une zone peut porter
**plusieurs douleurs** (FRE-196, livré le 27/10). Les écrans ont suivi par
ajouts successifs, et la déclaration s'est compliquée.

> « C'est bizarre, je dois cliquer sur l'épaule, PUIS sur le biceps pour
> l'ajouter. En réalité il faudrait juste cliquer sur la douleur, et là pouvoir
> ajouter une zone. C'est pas intuitif du tout. » — William, 27/10

Corrigé le jour même par « Modifier les zones » sur la carte (« beaucoup mieux »).
Mais la déclaration a maintenant **trois points d'entrée** et **deux
grammaires**, et c'est ce qu'il faut remettre à plat.

## 2. Le modèle — ce qui ne se discute pas

Ces règles viennent du serveur. La maquette ne propose rien qu'il refuse.

| Règle | Conséquence à l'écran |
|---|---|
| Une douleur = un **nom** (le mot de l'athlète : « mon épaule ») + **au moins une zone** | On ne peut pas valider sans nom, ni retirer la dernière zone |
| Une zone peut appartenir à **plusieurs** douleurs vivantes | Toucher une zone suivie doit laisser choisir : celle-ci, ou une nouvelle |
| Une zone est un **code** (`deltoids:droite`) ; le côté est celui **de l'athlète**, pas de l'écran | De face, sa droite est à notre gauche (déjà géré par la figure) |
| Une **note par jour** et par douleur : intensité 0 à 10, commentaire facultatif | Re-noter le même jour **corrige**, n'ajoute pas |
| `0` est une réponse (« plus mal ») | Le 0 reste un bouton, vert |
| « Ce jour-là : entraînement / repos / rien dit » — trois états | « Rien dit » n'est pas « repos » |
| Signalée **depuis une ligne de séance** : le jour est entraîné, et la ligne s'attache à la note | La question entraînement/repos n'est pas posée dans le volet |
| **L'athlète écrit, le staff (kiné, coach) lit** | Pour le staff : aucune saisie, aucun bouton qui mènerait à un refus |
| Clore = « ça ne fait plus mal » ; une douleur close reste lisible | Clore n'est pas supprimer |

## 3. Ce qui existe aujourd'hui

### Trois points d'entrée

1. **L'onglet Douleurs** (Suivi kiné › Douleurs) — figure à gauche, cartes à
   droite (captures 1 à 4). Toucher des zones libres ouvre la déclaration ;
   toucher une zone suivie ouvre la carte de sa douleur, avec un bandeau
   « Déjà suivie sur ces zones · Nouvelle douleur ».
2. **La carte d'une douleur** — « Noter aujourd'hui », « Modifier les zones »,
   « Voir l'historique ». En mode « Modifier les zones », un bandeau au-dessus
   de la figure ; chaque toucher ajoute ou retire une zone (capture 4).
3. **Le volet de la ligne de séance** (bouton « Signaler une gêne » dans le pli
   d'un exercice) — figure à gauche, formulaire à droite ; sur une zone suivie,
   des boutons-radio « Mon épaule | Nouvelle douleur » (captures 5 et 6).

### Les frictions relevées

| # | Ce qu'on voit | Où | Traité en |
|---|---|---|---|
| 1 | Deux grammaires pour le même choix : bandeau + cartes dans l'onglet, boutons-radio dans le volet | captures 3 et 5 | §8 |
| 2 | Trois modes sur une seule figure (sélectionner pour déclarer, ouvrir une douleur, éditer ses zones), rien ne dit lequel est actif à part un bandeau | captures 2, 3, 4 | §9 |
| 3 | Les noms de zones composés sont longs : « Deltoïde antérieur droite + Pectoraux droite » | partout | §10 |
| 4 | Téléphone, mode édition : le bandeau (et son « Enregistrer ») sort de l'écran par le haut dès qu'on descend vers la figure ; la page déborde à droite | capture 4 téléphone | §11 |
| 5 | Téléphone : la rangée des douleurs en cours affiche la **zone** (« Deltoïde antérieur droite 3/10 ») et pas le **nom** que l'athlète a donné (« Mon épaule ») | capture 4 téléphone | §10 |
| 6 | La carte en cours d'édition n'est pas distinguée des autres | capture 4 bureau | §9 |
| 7 | Le nom affiché sous la figure suit le survol de la souris avant la sélection | capture 2 bureau | §9 |
| **8** | **L'échelle 0–10 : onze cibles sur une rangée font 24 à 34 px — sous le plancher de 44 px que ce brief impose lui-même (§5)** | captures 3 et 5 | §12 |

## 4. Les cas que la maquette doit traverser

Chaque cas est réel ou tiré d'un cas réel. La maquette doit montrer chacun.

| Cas | Ce que l'athlète fait | Ce qui doit se passer |
|---|---|---|
| Première douleur | Willi a mal à l'épaule et au biceps, « pas dissociable » | Il touche les deux, nomme « Mon épaule », note 3/10, valide : une douleur, deux zones |
| La même, le lendemain | Il touche l'épaule | « Mon épaule » est proposée d'emblée, avec la note d'hier pré-remplie |
| Ajouter une zone | L'épaule tire maintenant jusqu'au pectoral | Depuis la douleur, il ajoute le pectoral — sans passer par la zone d'abord |
| Autre douleur, même zone | Trois mois plus tard, claquage du biceps sans rapport | Il touche le biceps, choisit « Nouvelle douleur » ; l'épaule n'est pas touchée |
| Zone portée par deux douleurs | Il retouche le biceps | Les deux douleurs sont proposées, plus « Nouvelle » |
| Depuis la séance | Muscle up 4×2 @ 9 kg, l'épaule gêne | Volet : la ligne et le jour sont rappelés ; il choisit la douleur, note, et la ligne s'attache |
| Corriger le jour même | Il avait noté 5, c'était 3 | La note du jour se rouvre et se corrige |
| Ça passe | L'épaule ne fait plus mal | « Ça ne fait plus mal » clôt ; la douleur reste lisible dans les anciennes |
| Le kiné regarde | Thomas ouvre la fiche de Willi | Il lit tout ; aucune saisie, aucun bouton d'écriture |

## 5. Les contraintes de dessin

- Les règles de l'app : `../../design.md` (jetons de couleur, thèmes clair ET sombre, typographie).
- **44 px** par cible tactile, y compris sur la figure (le zoom existe pour les petits muscles).
- Champs de saisie en **16 px** minimum (sinon iOS zoome).
- La figure reste accessible : chaque zone est un bouton nommé, au clavier comme au doigt ; sans droit d'écriture, elle n'est plus cliquable.
- Couleurs d'intensité, une seule échelle : `0` vert `#7FA58C`, `1–3` `#E6C77A`, `4–6` `#E08A3C`, `7–10` `#D65A4A`. L'or de la **sélection** (`#D4A843`) reste distinct du 1–3.
- Trois langues (fr, en, pl) : les libellés s'allongent en polonais.
- Téléphone : la feuille qui monte du bas ne doit jamais cacher la zone qu'on touche.

## 6. Hors du périmètre

- L'historique d'une douleur (courbe, relevés) — il marche, on n'y touche pas.
- Les bilans kiné, le tableau des signalements, le guichet du coach.
- Le modèle de données : il est fixé (§2).

## 7. Fichiers concernés (pour l'intégration)

- `src/components/kine/douleurs-suivies.tsx` — l'onglet, les cartes, le mode édition
- `src/components/kine/signaler-sur-la-ligne.tsx` — le volet de la ligne de séance
- `src/components/kine/figure-du-corps.tsx` — la figure
- `src/lib/douleurs/selection.ts`, `src/lib/douleurs/libelles.ts` — sélection et libellés
- `src/i18n/locales/{fr,en,pl}.json` — clés `douleurs.*`
- Specs : `e2e/douleurs.spec.ts`, `e2e/gene-sur-la-ligne.spec.ts`

---

# La forme retenue

## 8. Une seule grammaire : « À quelle douleur ? » est une liste

C'est la pièce centrale, et elle règle la friction 1.

Aujourd'hui, le même choix se pose de deux façons : un bandeau au-dessus des
cartes dans l'onglet, deux boutons-radio dans le volet de séance. **Les deux ont
le même défaut de fond : ils ne tiennent qu'une douleur existante, plus
« nouvelle ».** Or le modèle (§2) autorise une zone portée par *plusieurs*
douleurs vivantes — et `douleursTouchees()` rend bien une liste. La forme
dément le modèle.

À la place, **un seul composant, le même aux trois points d'entrée** :

```
Tu as touché   [Deltoïde ant. D]

À quelle douleur ?
┌─────────────────────────────────────────┐
│ ●  Mon épaule                   3/10  › │   ← 48 px, sélectionnée (or)
│    Deltoïde ant. D · Pectoraux D        │
├─────────────────────────────────────────┤
│ ●  Tendinite biceps             5/10  › │
│    Biceps D · Deltoïde ant. D           │
├─────────────────────────────────────────┤
│ ○  + Nouvelle douleur                 › │
└─────────────────────────────────────────┘
```

- **Une ligne par douleur qui porte la zone touchée**, dans l'ordre des plus
  récemment notées ; `+ Nouvelle douleur` ferme toujours la liste.
- Chaque ligne porte le **nom**, ses **zones** en petit, et sa **dernière
  intensité** avec sa pastille de couleur. On choisit sur le nom, pas sur un
  code de zone.
- 48 px de haut : au-dessus du plancher, et il faut de la place pour deux lignes.
- La ligne pré-sélectionnée est celle qu'on attend : la douleur la plus
  récemment notée sur cette zone. Un seul geste suffit dans le cas courant.

**Le volet de séance n'ajoute qu'une chose** : la ligne (`MUSCLE UP Strict ·
4×2 @ 9 kg`) et le rappel que la note comptera comme un jour entraîné. Le choix,
lui, est le même objet. Plus de boutons-radio d'un côté et de bandeau de l'autre.

**Conséquence pour `selection.ts`** : `douleursTouchees()` est déjà la bonne
fonction ; c'est l'écran qui n'en lisait qu'un élément.

## 9. La figure n'a plus de modes — elle a un sujet

Friction 2, 6 et 7.

Trois modes se superposaient sur une seule figure sans que rien, sinon un
bandeau, ne dise lequel était actif. On remplace les modes par un **sujet**,
écrit dans un bandeau permanent **au-dessus** de la figure :

| Sujet | Bandeau | Ce qu'un toucher fait |
|---|---|---|
| aucun | « Touche une zone » | ajoute la zone à la sélection ; sur une zone suivie, ouvre la liste du §8 |
| une douleur | « Zones de « Mon épaule » · 2 zones » **en or** | ajoute ou retire une zone **de cette douleur** |

Le bandeau existe toujours, même vide : sa présence constante est ce qui rend sa
couleur lisible quand il devient or.

**L'or relie la carte et la figure.** Quand une douleur est le sujet, sa carte
prend le même cadre or et le même liseré, et « Terminé » existe aux deux
endroits. On voit ce qu'on modifie — friction 6.

**Les zones des autres douleurs s'éteignent** pendant l'édition (gris sourd) :
on ne peut pas les toucher par erreur, et la figure dit qu'elles ne sont pas le
sujet.

**Le libellé sous la figure ne suit plus le survol** (friction 7) : il n'affiche
que ce qui est *sélectionné*. Le survol se dit sur la zone elle-même, par une
infobulle — c'est l'information du pointeur, pas celle de l'écran.

## 10. Le nom de l'athlète partout, la zone en second

Frictions 3 et 5.

- **Le nom de la douleur est le titre**, partout : carte, liste de choix,
  rangée « en cours » du téléphone. C'est le mot de l'athlète, c'est ce qu'il
  reconnaît. La rangée du téléphone affichait la zone : elle affiche le nom.
- **Les zones deviennent des puces courtes** : `Deltoïde ant. D`, `Pectoraux D`.
  Le côté se réduit à `D` / `G`, et le qualificatif s'abrège. La concaténation
  « Deltoïde antérieur droite + Pectoraux droite » disparaît.
- `nomDesZones()` garde sa forme longue pour les lecteurs d'écran et les
  infobulles ; l'écran lit la forme courte. **Deux fonctions, pas une** —
  `nomDeZone` (long, accessible) et `nomDeZoneCourt` (affichage).
- En polonais les libellés s'allongent : les puces se tronquent avec une
  ellipse, jamais la ligne entière.

## 11. Téléphone : la barre d'action est en bas

Friction 4, et c'est la correction la plus mécanique.

- **La barre « Terminé / Annuler » est ancrée en bas de l'écran**, au-dessus de
  la barre de navigation. En haut, elle sortait du champ dès qu'on défilait vers
  la figure — et « Enregistrer » avec elle. Sous le pouce, elle ne bouge plus.
- **La consigne vit avec la barre** (« Touche la figure pour ajouter ou retirer
  une zone »), pas trois écrans plus haut.
- **Les puces de zones sont dans la barre**, au-dessus des boutons : on voit ce
  qu'on a sélectionné au moment où on valide.
- **Le zoom passe sous la figure.** À droite d'elle, il poussait la page hors de
  l'écran — c'est l'origine du débordement horizontal. Plus rien ne dépasse à
  droite : la rangée « en cours » empile, elle ne défile pas.
- **La feuille du §8 monte du bas et ne couvre jamais la zone touchée** : la
  figure se recadre au-dessus d'elle (§5).

## 12. L'échelle 0–10, à 44 px

Friction 8 — relevée en dessinant, pas dans le brief d'origine.

Onze cibles sur une rangée donnent 24 px dans le volet de séance et 34 px dans
la carte. Le brief impose 44 px (§5) : l'écran ne le respecte pas.

- **Deux rangées de six**, chacune à 44 px de haut. Les onze boutons tiennent
  dans 290 px de large.
- **La couleur passe sous le chiffre**, en filet de 2 px, au lieu de le
  traverser — aujourd'hui les pastilles colorées chevauchent les nombres et les
  rendent illisibles.
- Le `0` garde son vert : « plus mal » est une réponse, pas une absence de
  réponse (§2).
- Les bornes restent écrites : `pas mal` à gauche, `insupportable` à droite.

## 13. Ce que la maquette ne tranche pas

- **Le nommage d'une nouvelle douleur.** La maquette montre le champ et les
  suggestions, mais le choix entre « suggestions issues de la zone » et « champ
  libre seul » dépend de ce que tes athlètes écrivent réellement. À regarder sur
  les noms déjà en base.
- **L'ordre de la liste du §8** quand trois douleurs ou plus portent la même
  zone : proposé par date de dernière note, à confirmer.
- **La vue de dos** : la maquette ne dessine que la face. Le comportement est
  identique, seul le tracé change.

## 14. Ce qui est intégré (28/10)

- **§8** : `DeclarerOuNoter` (`components/kine/declarer-ou-noter.tsx`), le même
  formulaire dans l'onglet et dans le volet de séance ; la liste tient toutes
  les douleurs qui portent la zone, la plus récemment notée en tête et choisie
  d'office, et choisir une douleur reprend sa dernière note.
- **§9** : le sujet est écrit au-dessus de la figure, toujours ; en édition, la
  carte prend le même or, et le libellé sous la figure ne suit plus le survol.
  ⚠️ **Écart** : les zones des autres douleurs s'éteignent mais restent
  **touchables** — une zone peut appartenir à plusieurs douleurs (§2), et
  ajouter le biceps à « Mon épaule » quand une tendinite le porte déjà est un
  cas permis.
- **§10** : `nomDeZoneCourt` (« Deltoïde ant. D ») partout à l'écran ; la forme
  longue reste au survol et au lecteur d'écran. La rangée du téléphone porte
  le nom de la douleur, et empile.
- **§11** : au téléphone, la barre d'édition est en bas, au-dessus de la
  navigation, avec les puces et la consigne ; le zoom passe sous la figure.
- **§12** : l'échelle en deux rangées de six, 44 px, le filet de couleur sous
  le chiffre.
- **Panneau de droite** : « Tu as touché », grand titre, lignes à bouton rond et
  badge d'intensité, sections Intensité / Contexte et notes, bouton qui
  reprend la note (« Enregistrer la note (3/10) »).
- **§13 non tranché, donc non fait** : pas de suggestions de nom.
