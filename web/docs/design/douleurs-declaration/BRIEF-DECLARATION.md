# Déclarer une douleur — refonte

**Fichier unique de ce chantier.** Écrit le 27/10/2026, sur la version 1.0.50.
On le lit en premier ; les captures l'illustrent.

| Fichier | Ce qu'il montre |
|---|---|
| `1-repos-{bureau,telephone}.png` | L'onglet Douleurs au repos : la figure, les douleurs en cours |
| `2-declarer-deux-zones-…` | Deux zones libres touchées : la déclaration s'ouvre |
| `3-zone-deja-suivie-…` | Une zone qui porte déjà une douleur : sa carte s'ouvre, « Nouvelle douleur » à côté |
| `4-modifier-les-zones-…` | « Modifier les zones » depuis la carte : la figure édite les zones de CETTE douleur |
| `5-seance-zone-suivie-…` | Le volet « Signaler une gêne » d'une ligne de séance, sur une zone suivie |
| `6-seance-nouvelle-…` | Le même volet, « Nouvelle douleur » choisie |

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

| # | Ce qu'on voit | Où |
|---|---|---|
| 1 | Deux grammaires pour le même choix : bandeau + cartes dans l'onglet, boutons-radio dans le volet | captures 3 et 5 |
| 2 | Trois modes sur une seule figure (sélectionner pour déclarer, ouvrir une douleur, éditer ses zones), rien ne dit lequel est actif à part un bandeau | captures 2, 3, 4 |
| 3 | Les noms de zones composés sont longs : « Deltoïde antérieur droite + Pectoraux droite » | partout |
| 4 | Téléphone, mode édition : le bandeau (et son « Enregistrer ») sort de l'écran par le haut dès qu'on descend vers la figure ; la page déborde à droite | capture 4 téléphone |
| 5 | Téléphone : la rangée des douleurs en cours affiche la **zone** (« Deltoïde antérieur droite 3/10 ») et pas le **nom** que l'athlète a donné (« Mon épaule ») | capture 4 téléphone |
| 6 | La carte en cours d'édition n'est pas distinguée des autres | capture 4 bureau |
| 7 | Le nom affiché sous la figure suit le survol de la souris avant la sélection | capture 2 bureau |

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
