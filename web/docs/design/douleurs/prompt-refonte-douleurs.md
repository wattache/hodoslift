# Prompt à copier/coller

> Les captures et les maquettes sont dans le même dossier que ce fichier :
> `desktop-declarer.png`, `desktop-noter.png`, `phone-declarer.png`, `phone-liste.png`, `phone-noter.png`,
> et deux maquettes cliquables à ouvrir dans un navigateur : `maquette-bureau.html`, `maquette-telephone.html`.
> Dis à ton agent de les regarder avant de coder.

Tu travailles dans le dépôt `eitri` (React + TypeScript + Vite, Tailwind, react-i18next, API brokkr). Je veux refondre l'écran des douleurs suivies pour qu'on déclare et qu'on note une douleur **en touchant le corps**, comme sur les captures jointes.

## Fichiers concernés

- `src/components/kine/douleurs-suivies.tsx` — l'écran, la liste et les cartes.
- `src/components/kine/figure-du-corps.tsx` — la figure cliquable.
- `src/lib/anatomie/zones.ts` — vocabulaire des zones, conversion côté écran → côté du corps. **Ne pas y toucher** : les règles face/dos y sont déjà bonnes.
- `src/i18n/locales/fr.json` — clés `douleurs.*` et `anatomie.*`.

Garde les invariants déjà écrits en commentaire dans ces fichiers : `canWrite` (le staff lit, l'athlète écrit), toucher une zone déjà suivie n'en crée pas une nouvelle, la tête et les cheveux sont du décor non cliquable, le code de zone (`chest:droite`) est ce qui part en base, jamais le libellé.

## Ce qui change

### 1. La figure porte trois états, en couleur

Aujourd'hui les zones retenues et suivies sont toutes en or, à deux opacités près. À la place :

- zone libre : gris `#B4B3B8` à 72 % d'opacité ;
- zone sélectionnée : or `#D4A843` plein ;
- zone déjà suivie : la **couleur de sa dernière intensité**, à 60 % d'opacité, et 100 % quand elle est sélectionnée.

Échelle d'intensité, une seule fonction partagée, à mettre dans un module utilitaire :

```
0     → #7FA58C   (plus mal)
1–3   → #E6C77A   (gênant)
4–6   → #E08A3C   (limitant)
7–8   → #D65A4A   (fort)
9–10  → #D65A4A   (insupportable)
```

L'or de la sélection (`#D4A843`) et l'or du 1–3 (`#E6C77A`) doivent rester distincts : c'est la seule raison pour laquelle le 1–3 est plus pâle.

Ajoute une légende sous la figure (sélection, 0, 1–3, 4–6, 7–10) et garde le nom de la zone au survol et au focus, avec « — déjà suivie » quand c'est le cas.

### 2. Toucher une zone libre ouvre la déclaration

Sur bureau (cf. `desktop-declarer.png`), le formulaire prend la colonne de droite, à la place de la liste. Sur téléphone (cf. `phone-declarer.png`), il monte du bas comme une feuille, et **la figure rapetisse** pour rester entière au-dessus : une douleur au mollet ne doit pas passer sous la feuille.

Le formulaire contient :

- le nom de la zone touchée, avec son côté, par `nomDeZone(code)` ;
- le champ du nom de la douleur, avec 4 suggestions cliquables qui remplissent le champ : Tendinite, Contracture, Élongation, Gêne en dips ;
- l'intensité de 0 à 10 en **onze boutons colorés** au lieu du curseur. Chaque bouton porte un liseré de 3 px de la couleur de son niveau ; le sélectionné prend cette couleur en fond, texte `#131316`. Le libellé du niveau s'affiche à côté du chiffre (« 3/10 · gênant ») ;
- « Suivre cette douleur », désactivé tant que le nom est vide, et Annuler.

Valider fait deux appels : `useDeclarerDouleur` puis, dans la foulée, `useNoterDouleur` avec l'intensité saisie. L'API de déclaration ne prend que `nom`, `zone` et `debut` — ne change pas son contrat pour ça. Si le second appel échoue, la douleur reste créée : affiche l'erreur sur la note, pas sur la déclaration.

### 3. Toucher une zone suivie ouvre sa note

Sa carte passe en bordure or et la saisie du jour s'ouvre dedans (cf. `desktop-noter.png` et `phone-noter.png`) : même sélecteur d'intensité de 0 à 10, le commentaire, Enregistrer, Annuler, et « Ça ne fait plus mal » à l'écart des deux autres. L'intensité est pré-remplie avec la dernière note. Retoucher la même zone, ou Annuler, referme.

### 4. Les cartes deviennent lisibles d'un coup d'œil

Chaque carte porte :

- une pastille de la couleur de l'intensité, le nom, la zone en petites capitales ;
- un badge d'état : « Noté aujourd'hui » en or si `derniere.date === todayIso()`, sinon l'ancienneté en orange (« Il y a 5 sem. ») ;
- la note en gros chiffre dans sa couleur, suivie d'une jauge de 10 cases, les cases remplies prenant la couleur de leur propre niveau ;
- le dernier commentaire en citation ;
- le bouton d'action, « Corriger la note du jour » ou « Noter aujourd'hui ».

### 5. Téléphone

- Une seule silhouette, avec les onglets Face / Dos déjà présents sous `lg`, et des repères D/G sous la figure qui s'inversent entre les deux vues.
- Les douleurs suivies passent en rangée de boutons défilante au-dessus du corps (« ● Épaules droite 1/10 »), avec un point orange sur celles qui n'ont pas été notées depuis longtemps. Les toucher ouvre la note.
- Cibles tactiles : 44 px minimum, champs de saisie en `font-size: 16px` pour éviter le zoom iOS, et garde le contour transparent large autour de chaque tracé pour les petits muscles.

## Accessibilité — non négociable

La maquette est dessinée avec des `<path>` cliquables ; **ne copie pas ça**. Garde ce que fait déjà `figure-du-corps.tsx` : chaque zone reste un `<g role="button" tabIndex={0}>` avec `aria-label`, `aria-pressed`, gestion de Entrée et Espace, et `<title>`. Sans `onChoisir`, les zones redeviennent `role="img"` et ne sont pas tabulables. Les boutons d'intensité sont de vrais `<button>` dans un groupe nommé, avec `aria-pressed`.

Vérifie le contraste : le texte gris sur les cartes et les badges colorés doivent tenir le 4.5:1.

## Ce qu'il ne faut pas faire

- Ne pas toucher aux tracés dans `src/lib/anatomie/trace-*.ts` : c'est de la donnée importée, remplaçable en bloc.
- Ne pas recalculer « récurrente » côté client : ça vient du serveur.
- Ne pas ajouter d'historique en courbe : `DouleurLue` ne renvoie que `derniere` et `logs`. Si tu veux le proposer, ouvre un ticket pour un endpoint de relevés, mais ne l'invente pas dans l'UI.
- Ne pas stocker de libellé de zone en base : le code (`chest:droite`) reste la seule vérité.

## Détails de copie

- `douleurs.commentLAppeler` dit « cette douleur à {{zone}} » et produit « Pectoraux droite ». Corrige l'accord si tu touches à cette clé, ou laisse-la telle quelle, mais ne mélange pas les deux formes.
- Nouvelles clés à ajouter sous `douleurs.*` : les 4 suggestions de nom, les libellés d'intensité (plus mal, gênant, limitant, fort, insupportable), l'ancienneté (« Il y a {{count}} sem. »).

## Vérification attendue

- Les tests existants passent, `src/lib/anatomie/zones.test.ts` compris.
- `e2e/douleurs.spec.ts` est mis à jour : déclarer une douleur en touchant une zone, la noter en la retouchant, et vérifier qu'une zone suivie ne crée pas de doublon.
- Un test au clavier : atteindre une zone à la tabulation, la choisir avec Entrée, saisir le nom et valider.
