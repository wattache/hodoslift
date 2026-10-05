# Plateau — revue après la refonte (24/09)

Relecture de `components/competition/*`, `lib/plateau.ts`, `use-plateau.ts` et `competition-detail.tsx` après la séparation Plateau / Feuilles. Classé par ce que ça coûte au bord du plateau, pas par difficulté.

## Ce que la séparation a réglé

La feuille de préparation à part était le bon geste : le jour J, personne ne veut voir douze cellules à trois champs. Le Plateau qui en résulte se lit. Trois choses tiennent particulièrement :

- **`lib/plateau.ts` refuse ce que brokkr refuserait.** `annoncer` et `annonceLibre` rendent `null` au lieu de laisser partir un 422, et `annonceLibre` écrit dans le tier annoncé — le piège que j'avais signalé sur `chargeAnnoncee` est fermé, commentaire à l'appui.
- **Les flèches avancent d'un passage, pas d'un tour.** C'est le rythme réel d'un plateau, et ça évite la gymnastique mentale « où en est le groupe ».
- **Le no-rep épingle l'essai le temps du motif.** C'est exactement le genre de détail qui ne se voit pas dans une maquette et qui sauve une saisie.

## 1. Le récapitulatif se dérobe sous les doigts

`SuiviParGroupe` garde l'athlète consulté tant que `plateau.selection` n'a pas bougé. Or pendant la compétition, l'encart bouge **à chaque verdict**. Le coach qui ouvre la feuille d'Ignacy pour préparer son deuxième essai la perd dès que quelqu'un valide sa barre.

Le même problème est déjà résolu une fois, pour le tour : un verrou explicite, et un bouton « Revenir au tour en cours ». **Applique la même règle à l'athlète et au groupe consultés** : on suit l'encart tant qu'on n'a rien touché ; dès qu'on choisit quelqu'un, on reste sur lui, et un seul bouton — le même — ramène tout au plateau.

Aujourd'hui il y a quatre états de consultation avec trois règles de péremption différentes (`usePlateau.manuel/suivi`, `Plateau.choix`, `SuiviParGroupe.choix`). Un seul concept « consultation » (groupe + athlète + tour), un seul verrou, un seul retour : c'est moins de code, et surtout une seule chose à comprendre pour qui l'utilise.

## 2. On ne voit pas qui suit

`EnBarre` dit « passe en 3e sur 5 », mais pas **qui** passe après. C'est la question qu'on pose dix fois par heure au bord du plateau — l'athlète suivant doit s'échauffer, le coach doit savoir s'il a deux minutes ou trente secondes.

Une ligne sous le verdict suffit : « ensuite · Théo 15 · Karim 20 », les deux ou trois suivants dans l'ordre de barre, cliquables. Tu as déjà `plateau.enAttente`, c'est trois lignes de JSX.

## 3. Rien ne dit le temps

Un essai se déclare et se charge sous horloge. L'app a déjà un chrono qui survit au verrouillage du téléphone (`components/chrono.tsx`, `lib/chrono.ts`) : le brancher sur le passage en cours — départ au moment où l'athlète est appelé, remise à zéro au verdict — donnerait au Plateau la seule information qui lui manque vraiment.

À creuser avec toi : est-ce le rôle de l'app, ou celui du chronomètre officiel de la fédération ? Si c'est l'officiel qui fait foi, un simple compteur « depuis l'appel » reste utile sans prétendre arbitrer.

## 4. Un verdict posé sur le mauvais athlète n'a pas de sortie de secours

`verdictBascule` permet d'annuler en recliquant — mais après un REP, le panneau est déjà passé au suivant. Pour revenir, il faut comprendre le modèle : retrouver le tour, retrouver l'athlète, recliquer. Sous la pression, ce n'est pas un chemin.

Un toast « REP enregistré · Willi · 12,5 kg — Annuler », cinq secondes, avec sonner qui est déjà là. C'est le filet dont dépend la confiance dans l'avance automatique.

## 5. La feuille de préparation juge encore

`TierAttemptCell` porte les boutons REP / NO REP. Dans une vue qui s'appelle « préparation », ils n'ont plus de raison d'être et ouvrent la porte à une erreur silencieuse — un clic à côté, un verdict posé la veille sur un essai qui n'a pas eu lieu. **Retire-les de la préparation** : le Plateau les porte.

Deux autres points sur cette vue :

- **Les cibles y sont minuscules** : le `±` fait 16 px de large et 20 de haut, l'input 40 px. C'est de la souris uniquement, alors que le plan se retouche souvent au téléphone. Une ligne par tier avec des boutons de 32–36 px tiendrait dans la même largeur.
- **Elle est réservée aux `canWrite`.** Un athlète ne peut donc pas lire son propre plan, ni le staff en lecture seule. La même vue, sans les contrôles, se justifie pour tout le monde.

## 6. Trois listes d'athlètes au même écran

Sur large, on a les pastilles d'athlètes du groupe, le récapitulatif de l'un d'eux, et le classement du groupe juste au-dessus — trois fois les mêmes noms, trois hiérarchies différentes.

**Fusionne les pastilles et le classement** : une liste, rang · catégorie · nom · total, où la ligne sélectionnée ouvre le récapitulatif. On choisit et on se classe au même endroit, et il reste de la place pour le reste.

## 7. Le bloc « Groupes et athlètes » fait trois métiers à la fois

Choisir un groupe, régler ses catégories, éditer la fiche d'un athlète, lire ses douze essais : c'est beaucoup pour un écran qu'on ouvre en pleine compétition. La pesée et les catégories se règlent le matin ; le jour J, on ne veut que lire.

Suggestion : garder la lecture par défaut, et mettre l'édition — `DescriptionDuGroupe` en mode édition, `DonneesDeLAthlete` — derrière un bouton « Réglages » du bloc, ou dans la vue Feuilles. Ça enlève d'un coup la moitié des contrôles de l'écran du jour J.

## 8. Motifs de no-rep : le menu coûte deux gestes

Tu as eu raison de refuser treize pastilles. Mais le menu a un défaut symétrique : il s'ouvre sur « Ne sait pas » déjà sélectionné, donc un no-rep non renseigné et un no-rep « on ne sait pas » se ressemblent, et choisir demande d'ouvrir, viser, valider.

Compromis : **deux ou trois motifs en boutons** — ceux qui sortent vraiment (trop lourd, position finale, départ anticipé selon le mouvement) — **et « Autre… » qui ouvre le menu complet**. Et un placeholder « Motif ? » en or tant que rien n'est choisi, pour que l'essai épinglé se voie.

## 9. Petits manques d'accessibilité

- **L'encart change d'athlète tout seul** après un verdict, sans rien annoncer : un `aria-live="polite"` sur l'en-tête d'`EnBarre` (nom + charge) le dirait à voix haute, et rendrait aussi service à qui ne regarde pas l'écran en permanence.
- **`title` sur les boutons désactivés** de `TierAttemptCell` (annonce en baisse) : c'est réglé dans `EnBarre` avec `aria-describedby`, pas dans la feuille. Même traitement.
- **Raccourcis clavier** au poste de marque : `R` rep, `N` no rep, flèches pour les passages, avec la légende visible dans la carte du tour. Portés par la section qui a le focus, pas par `window`.

## 10. Idées pour plus tard

- **Un affichage public** : une route en lecture seule, gros caractères — en barre, charge, ordre de barre, classement du groupe — à projeter dans la salle. C'est le même état, une autre peau.
- **Le nom des vues** : « Plateau » et « Feuilles » sont clairs pour toi ; « Jour J » et « Préparation » le seraient pour un bénévole qui prend l'écran une fois par an.
- **Le jour de passage** (`competesOn`) n'apparaît nulle part dans le Plateau alors qu'il existe sur une compét multi-jours. Filtrer les groupes sur le jour courant éviterait de faire défiler des athlètes qui passent demain.

## Ce que je ferais en premier

1. Le verrou de consultation unique (§1) — c'est le seul point qui gêne à chaque verdict.
2. Le toast d'annulation (§4) — il rend l'avance automatique acceptable.
3. « Ensuite : … » (§2) — trois lignes, question posée dix fois par heure.
4. Retirer les verdicts de la préparation (§5) — une erreur de moins, gratuit.
