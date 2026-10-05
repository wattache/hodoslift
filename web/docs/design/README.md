# Specs d'écran

Un dossier par chantier. Chaque dossier porte **un fichier de brief** — c'est lui
qu'on lit en premier, et le seul à tenir à jour — plus les captures et les
maquettes cliquables qui l'illustrent.

| Chantier | À lire | État |
|---|---|---|
| Compétition — écran Plateau (feuille de match + live réunis) | [`competition/BRIEF.md`](competition/BRIEF.md), puis [`competition/REVUE.md`](competition/REVUE.md) | fait le 24/09 ; la forme livrée s'écarte du brief (grille remplacée par le bloc « Groupes et athlètes », onglet Feuilles) ; revue du design à arbitrer |
| Douleurs — déclarer en touchant le corps | [`douleurs/prompt-refonte-douleurs.md`](douleurs/prompt-refonte-douleurs.md) | à faire |
| Entraînement — mode coach (grand écran et téléphone) | [`entrainement/BRIEF-COACH.md`](entrainement/BRIEF-COACH.md) | fait le 27/09 ; tableau dès 1024 px (question ouverte n° 1 tranchée : une tablette en paysage le tient), le RPE par série reste dans le dépli (n° 2), « déplacer vers… » dans le menu ⋮ (n° 3) ; la barre du bas du téléphone ne change pas (William) |
| Progression sur le bloc — rendus au choix | [`progression/BRIEF-PROGRESSION.md`](progression/BRIEF-PROGRESSION.md) | fait le 27/09, réduit le 28/09 : DEUX rendus (Courbe = la carte telle qu'elle est, défaut ; Chiffres = sa vue tableau avec la ligne Écart) et UNE préférence par personne, vue partout — pli, dépli coach, BASE (William : « plus de distinction » athlète / coach) ; réglage compact dans la page Profil (vignettes + aperçu à la taille de la carte) et les mêmes silhouettes en 26 px dans l'en-tête de la carte ; `users.preferences` (brokkr), `localStorage` en repli |
| 1RM estimés — la carte et ses états | [`1rm/BRIEF-1RM.md`](1rm/BRIEF-1RM.md) | à faire, proposé le 01/10 |

Les maquettes `.html` de ces dossiers sont des **prototypes jetables** : elles
disent le comportement et les couleurs, pas la façon de coder. Les règles de
dessin de l'app, elles, sont dans [`../design.md`](../design.md).
