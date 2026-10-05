# Carte « 1RM estimés »

**Fichier unique de ce chantier.** Écrit le 01/10/2026, forme revue le 01/10 au soir.

| Fichier | Ce qu'il montre |
|---|---|
| `rm1-sombre.png` | La carte en thème sombre : Squat, Dips, Muscle up normaux, Tractions fragile, variante Dips absent, infobulle |
| `rm1-clair.png` | La même en thème clair |
| `maquette-1rm.html` | Maquette cliquable (bascule clair / sombre) |

⚠️ Maquette jetable : elle dit la forme et le comportement, pas la façon de coder.

---

## 1. La règle de la ligne

> « Pour moi tu affiches juste le nom du mouvement avec une frise et sur la frise les charges écrites : mouvement - lest - frise »

**Trois éléments par ligne, pas quatre.** Il n'y a plus de colonne de chiffres : les charges sont écrites sur la frise.

```
SQUAT          à la barre                    182,2 kg
               8 séances · prog 180 · +2,2  ───┨████▐───
                                            176,6    187,9
```

| Colonne | Largeur | Contenu |
|---|---|---|
| **Mouvement** | 132 px | le nom, en condensé — plus la pastille « 1 séance » si l'état est fragile |
| **Lest** | 176 px | `+92,2 kg de lest` pour un mouvement lesté, `à la barre` sinon ; en dessous, en gris : `6 séances · prog 162 · +12,2` |
| **Frise** | le reste | le dessin, avec les charges écrites dessus |

Le lest est une colonne à part parce que **l'athlète pense en lest et la frise parle en total** : la deuxième colonne fait le pont, une fois, sans jamais réécrire un chiffre que la frise porte déjà.

## 2. Ce qui est écrit sur la frise

| Où | Quoi | Spec |
|---|---|---|
| **Au-dessus du trait épais** | l'estimation, `182,2 kg` | 15 px, chiffres tabulaires, demi-gras, couleur d'encre — le seul chiffre gros de la ligne |
| **Au bout gauche du trait fin** | `176,6` | 11 px, gris |
| **Au bout droit du trait fin** | `187,9` | 11 px, gris |

Rien d'autre n'est écrit. **Le 1RM de programmation garde son trait pointillé mais pas son étiquette** : à 2,2 kg de l'estimation, l'étiquette entrerait en collision avec elle à chaque fois. Sa valeur et l'écart vivent dans la colonne « lest », en petit — c'est un repère, il ne doit pas concurrencer l'estimation.

## 3. La frise elle-même

| Élément | Rôle | Spec |
|---|---|---|
| Trait fin | p10–p90, les 80 % | 2 px, bouts arrondis, accent à 55 % d'opacité |
| Barre épaisse | p25–p75, la moitié des cas | hauteur 16 px, rayon 4, accent à ~25 % d'opacité, sans contour |
| Trait vertical plein | p50, l'estimation | 3 px, couleur d'encre |
| Trait vertical pointillé | 1RM de programmation | 1,5 px, gris moyen, jamais la couleur d'accent, sans étiquette |
| Points | les séries des 6 semaines | r = 3,2 px, gris, anneau 2 px de la couleur de la carte, dispersés sur trois niveaux autour du trait |

## 4. L'échelle — le point qui a changé

**Il n'y a plus d'axe absolu commun 90 → 200 kg.** La première version mettait les quatre mouvements sur le même axe : le muscle up se retrouvait écrasé dans 7 % de la largeur, et dès qu'on a écrit les charges dessus, `96,8` et `104,2` se touchaient.

À la place :

- **Chaque frise est centrée sur sa propre estimation.** Les traits épais s'alignent en colonne au milieu de la carte.
- **Toutes les frises partagent la même échelle en px/kg** — 15 px/kg sur grand écran, 8,5 px/kg sur téléphone. C'est elle qui porte la comparaison : *une frise plus large, c'est plus d'incertitude*, sans lire un chiffre. Les tractions (1 séance) occupent trois fois la largeur du muscle up : on le voit immédiatement.
- **Une règle d'échelle est affichée une fois**, en bas de carte : un segment de 10 kg et son étiquette, avec la mention « même échelle sur les quatre frises ».

La demande d'origine — « l'incertitude doit être vue, pas lue » — est donc tenue, mais par la **largeur** et non par la position. On perd la lecture « le squat est plus lourd que le muscle up » ; ce n'était pas la question posée, et les charges écrites y répondent de toute façon.

**Conséquence côté code** : `pxParKg` est une constante du composant, pas une échelle calculée par ligne. Si une ligne déborde de sa fenêtre (un 1RM de programmation très éloigné, une série aberrante), la position est **bornée aux bords de la frise** plutôt que de faire grandir la fenêtre — une seule valeur ne doit pas écraser les quatre lignes.

## 5. Les trois états

| État | Condition | Rendu |
|---|---|---|
| **Normal** | ≥ 2 séances | tel que décrit ci-dessus |
| **Fragile** | 1 séance | la boîte p25–p75 passe **en contour tireté, sans remplissage** — un intervalle qu'on ne remplit pas — et une pastille « 1 séance » suit le nom. Rien d'autre ne change : pas d'icône d'alerte, pas de rouge. La largeur dit déjà la prudence. |
| **Absent** | aucune série exploitable | colonne mouvement inchangée, colonne lest à `pas d'estimation` / `0 séance retenue`, et à la place de la frise : un rail tireté vide + **une phrase qui dit pourquoi** |

Les trois raisons à écrire, au mot près :

- « Seulement des dips DS sur la période : une descente ne dit pas un maximum. »
- « Pas de RPE sur ces séries : sans effort perçu, rien à estimer. »
- « Pas de pesée depuis trois semaines : sur un mouvement lesté, le total dépend de ton poids. »

## 6. L'infobulle d'une série

Au survol ou au toucher d'un point, trois lignes :

```
26/09 · +7,5 kg × 3 @8,5
→ 1RM implicite +20,3 kg
102,4 kg au total · muscle up
```

- **L'unité suit le mouvement** : lest pour les lestés, charge à la barre pour le squat. Le total reste en troisième ligne, en gris — c'est la grandeur de la frise, pas celle de l'athlète.
- Cible tactile de 24 px minimum autour d'un point de 6,4 px : l'anneau fait partie de la cible.
- Au clavier : les points d'une ligne sont atteignables en tabulation groupée (une seule tabulation par mouvement, puis les flèches), et l'infobulle devient le nom accessible.

## 7. Téléphone (375 px)

Les deux premières colonnes se replient sur une seule ligne, la frise passe dessous :

```
SQUAT  à la barre
        182,2
   ───┨███▐───
 176,6     187,9
8 séances · prog 180 · +2,2
```

- Le nom et le lest sur la même ligne, séparés par une espace — le lest en mono, plus petit.
- La frise fait 320 px de large, 52 px de haut ; l'étiquette de l'estimation est au-dessus, les bornes en dessous, en 10 px.
- Les séances et le 1RM de programmation passent **sous** la frise.
- La règle d'échelle apparaît une fois, en bas de carte. Rien ne défile horizontalement.

## 8. Thème clair et sombre

Les deux sont **choisis**, pas déduits l'un de l'autre :

| Jeton | Sombre | Clair |
|---|---|---|
| Carte | `#1B1A1F` | `#FFFFFF` |
| Encre | `#EEECF2` | `#1B1A1F` |
| Encre secondaire | `#A9A5B0` | `#55525C` |
| Encre tertiaire (bornes, séances) | `#7C7886` | `#7A7682` |
| Accent (boîte, trait) | `#D4A843` | `#B98713` |
| Remplissage de boîte | accent à 28 % | accent à 22 % |
| Points | `#6E6A76` | `#A9A5B0` |
| Alerte (écart négatif, pastille) | `#E0A93C` | `#9A6B10` |

L'or clair du thème sombre ne passe pas le contraste sur fond blanc : le thème clair descend d'un cran. Pas de dégradé, pas d'ombre, bordures 1 px.

## 9. Contrat de données

```ts
type Mouvement = {
  mvt: string;
  pdc: number;            // poids du corps, 0 pour le squat
  prog: number | null;    // 1RM de programmation, charge totale
  seances: number;        // 0 = état absent
  p10: number; p25: number; p50: number; p75: number; p90: number;  // charge TOTALE
  pts: Array<{ v: number; jour: string; charge: number; reps: number; rpe: number }>;
  raison?: 'variantes' | 'sans_rpe' | 'sans_pesee';  // seulement si seances === 0
};
```

Tout ce que la carte affiche se déduit de là : `lest = p50 − pdc`, `delta = p50 − prog`, l'état vient de `seances` et de `raison`. **La carte ne calcule aucun 1RM** : les quantiles et les 1RM implicites viennent du serveur, comme le RIS et les projections ailleurs dans l'app.

## 10. Vérification

- Un rendu par état, en clair et en sombre, à 375 px et à 1280 px.
- **Aucun chiffre écrit sur la frise ne doit en toucher un autre** — c'est le défaut qui revient en premier. Le cas le plus serré est un mouvement à faible dispersion (muscle up : 7,4 kg entre p10 et p90) ; à 15 px/kg il reste 50 px entre les deux bornes.
- Un mouvement dont des points sortent de l'intervalle (le squat en a plusieurs) : rien ne doit être coupé par les bords de la frise.
- Un mouvement sans `prog` : pas de pointillé, pas d'écart, et la colonne « lest » ne laisse pas de trou.
- Un `prog` très éloigné de l'estimation : son trait se borne au bord de la frise, et les quatre lignes gardent la même échelle.
- Contraste vérifié sur les deux thèmes, y compris le gris des bornes et l'ambre de l'écart négatif.
