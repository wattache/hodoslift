# Brief pour Claude Design — French Forge Trainer

*Rédigé le 09/09/2026, à partir de mesures sur la production, pas d'impressions.
À coller tel quel en ouverture de session.*

---

## Ce que je te demande

Trois livrables, dans cet ordre de priorité :

1. **Une revue du design de l'interface existante** — ce qui ne tient pas, et
   pourquoi. Pas une refonte spéculative : des défauts nommés, avec le geste qui
   les corrige.
2. **Un logo**, et le système d'icônes qui va avec (favicon, icône PWA
   maskable). L'actuel est un problème, voir plus bas.
3. **Des propositions de nom** pour l'application, avec pour chacune ce qu'elle
   gagne et ce qu'elle coûte.

Tu peux traiter les trois dans une seule réponse structurée. Si tu ne dois en
faire qu'un correctement, fais le 2 : c'est le plus cassé.

---

## Le produit, en une phrase

Une application de coaching en **force athlétique et street-lifting** : le coach
programme des cycles d'entraînement, l'athlète les exécute à la salle et note ce
qu'il a réellement fait, et une kinésithérapeute suit les blessures en parallèle.

Ce n'est pas une app de fitness grand public. C'est un outil de **travail**, pour
des gens qui préparent des compétitions.

## La population réelle, mesurée aujourd'hui

| ce qu'on compte | combien |
| -- | -- |
| athlètes | 70 |
| coachs | 4 |
| programmes d'entraînement | 70 |
| semaines programmées | 613 |
| séances | 2 682 |
| lignes d'exercice | 15 346 |
| compétitions | 8 |
| entrées de bibliothèque de mouvements | 244 |
| séances des 30 derniers jours | 35 |

Historique depuis mars 2026. **Ce sont de vraies personnes, avec de vraies
données de santé** (des bilans kiné, des blessures). L'app n'est pas un
prototype.

⚠️ **Les 4 coachs sont AUSSI des athlètes.** Le même compte programme et
s'entraîne. Toute maquette qui suppose « écran coach » d'un côté et « écran
athlète » de l'autre se trompe : c'est la même personne qui bascule.

## Les rôles

* **coach** — programme, écrit la bibliothèque de mouvements, gère les
  compétitions, a une page publique.
* **athlète** — lit son programme, saisit son réalisé (charges, répétitions,
  RPE ressenti), fixe ses objectifs.
* **kiné** — une seule personne, Thomas. Bilans, signalements de douleur. Le
  coach est explicitement EXCLU du bilan kiné.
* **admin** — gestion des comptes.

## Les écrans

Quinze vues : tableau de bord athlète, programmation (l'arbre
macro → bloc → semaine → séance → ligne), éditeur de trame de bloc, suivi
(graphes), calendrier, compétitions et détail de compétition, bibliothèque de
mouvements, bilan kiné, modèles de bilan, signalements, profil public du coach,
admin.

L'écran le plus important et le plus dense est la **séance** : un tableau de
lignes d'exercice où chaque ligne porte un nom de mouvement, une variante, des
séries, des répétitions, une charge, un RPE prescrit — et en face, ce que
l'athlète a réellement fait, éventuellement **série par série**.

---

## 1. La revue de design

### Le contexte d'usage, qui doit gouverner les choix

* **L'athlète saisit à la salle, sur téléphone, entre deux séries**, souvent les
  mains moites, parfois hors ligne (sous-sol). L'app est une PWA avec écriture
  hors ligne et lecture sur cache disque.
* **Le coach programme assis, sur grand écran**, en manipulant beaucoup de
  lignes à la fois.
* **Le jour de compétition, on saisit des essais en direct**, au bord du
  plateau, sous pression et sans droit à l'erreur.

Ces trois situations n'ont pas les mêmes besoins et partagent aujourd'hui la
même mise en page.

### Ce que je sais déjà être faible

* **Il n'y a AUCUNE mise en page mobile dédiée.** Zéro `md:hidden`, zéro
  barre de navigation basse dans le shell. Tout repose sur une sidebar rétractable
  et des paddings responsives. Or c'est le téléphone qui porte l'usage le plus
  fréquent (la saisie du réalisé).
* **La densité de la séance n'a jamais été dessinée**, elle s'est accumulée. Des
  badges se sont ajoutés au fil des tickets : un compteur `n/N` de séries
  renseignées, un triangle d'alerte quand une ligne dépliée par série n'est pas
  complète, des pastilles de variante, des marqueurs de bi-set et de dropset.
  Chacun se défend seul ; ensemble, je ne sais pas s'ils se lisent.
* **La hiérarchie de l'arbre est plate à l'écran** alors qu'elle a cinq niveaux.
* **Les couleurs de bloc portent du sens métier** (bleu accumulation, orange
  intensification, rouge réalisation, gris décharge) et cohabitent avec le rouge
  destructif et l'or d'accent. Je ne sais pas si un daltonien s'y retrouve.

### Ce qui est DÉJÀ validé, et que je ne veux pas voir rouvert sans raison

* **La typographie.** Barlow Condensed pour l'affichage, Barlow pour le texte,
  IBM Plex Mono pour les chiffres. Servie par nous (`@fontsource`), pas par
  Google Fonts — l'app porte des données de santé et doit rendre pareil hors
  ligne. Les chiffres sont en chasse fixe et `tabular-nums` parce qu'une charge,
  une série et un RPE se comparent en colonne.
* **La palette des séries du graphe journalier** (poids, eau, forme, sommeil,
  calories). Elle est passée par un validateur : bande de clarté, plancher de
  chroma, séparation sous dyschromatopsie, contraste sur la surface, dans les
  deux modes. **L'ordre des teintes est porteur** — violet et bleu voisins
  tombaient à ΔE 1,7 en protanopie, c'est le vert qui les sépare. Réassigner une
  couleur, c'est refaire la validation.

Le reste est ouvert.

### La palette actuelle

Identité **sombre et or**, tokens OKLCH dans `eitri/src/index.css` :

```
--background  oklch(0.16 0.005 270)   fond quasi noir, légèrement violacé
--card        oklch(0.20 0.006 270)
--gold        oklch(0.76 0.13 82)     l'accent unique  (#D4A843 environ)
--destructive oklch(0.62 0.22 25)
--success     oklch(0.72 0.16 155)
--warning     oklch(0.78 0.15 75)
```

Le thème clair existe aussi (variables `--sidebar-*` en clair dans le même
fichier), mais l'app est verrouillée en sombre (`<html data-theme="dark">`).
**À interroger : le mode clair vaut-il d'exister ?** Une salle est mal éclairée,
mais un coach programme parfois en plein jour.

### Ce que j'attends de la revue

Des constats classés par gravité, chacun avec :
* l'écran ou le composant concerné ;
* ce qui ne va pas, en une phrase ;
* le geste qui corrige, assez précis pour être implémenté.

Pas de « moderniser », pas de « ajouter du blanc ». Nomme les choses.

---

## 2. Le logo

⚠️ **C'est le point le plus cassé, et il y a DEUX problèmes distincts.**

### Problème A — le logo ne va avec rien

`eitri/public/logo.png` : un écu façon blason, casque viking à cornes,
enclume, en **bleu-blanc-rouge** sur fond noir circulaire.

* Il est **bleu et rouge** alors que toute l'identité de l'app est **noir et
  or**. La couleur de thème déclarée est `#D4A843`. Le logo n'en contient pas.
* Il est **1179 × 1067**, donc **pas carré**, alors que le manifeste PWA le
  déclare `"sizes": "512x512"` et `"purpose": "any maskable"`. Une icône
  maskable non carrée sera rognée n'importe comment sur Android.
* Il pèse **1,01 Mo** pour une icône.
* Il porte un fond noir **opaque** avec un débord clair : posé sur le fond
  sombre de l'app, il fera un disque visible.
* Le style — mascotte e-sport détourée, dégradés, contours épais — ne
  ressemble à aucun autre pixel de l'interface, qui est sobre et typographique.

### Problème B — le favicon n'est pas le nôtre du tout

`eitri/public/favicon.svg` est un **losange violet `#863bff`**. C'est le logo par
défaut de Lovable, l'outil qui a servi à générer la première maquette. Il traîne
là depuis. Il n'est pas référencé par `index.html` (qui pointe sur `logo.png`),
mais il est dans le dépôt et il n'a rien à y faire.

### Ce que je veux

Un système de marque cohérent avec l'interface :

* **une marque principale** — le symbole seul et le lockup symbole + nom ;
* **un favicon**, lisible à 16 px ;
* **une icône PWA maskable**, carrée, avec la zone de sécurité respectée
  (le contenu tient dans le cercle intérieur à 80 %) ;
* **fond transparent**, et une version qui tient sur clair comme sur sombre.

Contraintes :

* **SVG**, léger, pas de dégradé compliqué ni de détourage photographique.
* Il doit tenir **à côté du nom en Barlow Condensed**, dans une sidebar
  rétractée à ~40 px de large.
* **L'or reste l'accent.** Un logo monochrome or sur fond sombre est
  probablement la bonne réponse, mais c'est toi qui juges.

Pistes de sens, à prendre ou à laisser : la **forge** (enclume, marteau, étincelle,
métal chauffé), la **barre** et les **disques**, la **progression par blocs** (la
périodisation est littéralement une suite de blocs colorés). Le viking et le
blason ne me tiennent pas à cœur.

⚠️ **Ne me livre pas trois variantes d'un même dessin.** Trois DIRECTIONS
différentes, avec ce que chacune raconte, puis ta recommandation.

---

## 3. Le nom

### L'existant

* Nom long : **French Forge Trainer**
* Nom court PWA : **FF Trainer**
* Domaine : **trainer.french-forge.com**
* La structure s'appelle **French Forge** — c'est le nom du club/coaching, et
  il n'est pas en question. Ce qui est en question, c'est le nom de
  l'**application**.

### Ce qui me gêne

* « Trainer » est générique, anglais, et ne dit rien de ce que l'app fait de
  particulier.
* « French Forge Trainer » fait trois mots et se raccourcit mal — « FF Trainer »
  n'évoque rien.
* L'app est en **français et en anglais**, et sera peut-être lue en polonais.
  Un nom qui ne fonctionne qu'en français est un plafond.

### Ce que je cherche

Des noms qui :

* tiennent en **un ou deux mots**, et supportent d'être dits à voix haute ;
* se prononcent en français **et** en anglais sans hésitation ;
* évoquent le travail, la charge, la progression méthodique — pas le fitness
  ni le lifestyle ;
* peuvent cohabiter avec **French Forge** comme maison mère, ou l'absorber.

Pour chaque proposition, donne-moi :
* le nom ;
* ce qu'il raconte, en une phrase ;
* ce qu'il coûte (ambiguïté, collision probable, prononciation) ;
* comment il s'écrit en logo (ça se tient, ces deux choses).

⚠️ **Signale-moi les collisions évidentes** si tu en connais : un nom déjà pris
par un produit du même secteur est une impasse, autant le savoir tout de suite.

Huit à douze propositions, groupées par famille (littéral, métaphorique,
abstrait…), puis ta recommandation avec le nom court et le domaine qui va avec.

---

## Notes pratiques

* Le front est dans `eitri/`, React + TypeScript + Tailwind v4 + shadcn/ui,
  77 composants `.tsx`. Les tokens sont dans `eitri/src/index.css`.
* Interface en **français** par défaut, anglais disponible. Les libellés
  d'interface se tutoient (« Connecte-toi », « supprime-la d'abord »).
* Tu peux tout proposer, mais **rien ne part en production sans que je le
  déploie moi-même**. Livre des maquettes et des fichiers, pas des changements.
