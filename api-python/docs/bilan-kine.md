# Les BILANS — spécification

Un **bilan** est une évaluation datée, protocolée, qu'on compare à elle-même
dans le temps. Le point de départ est le Google Form `FO002-bilan_kiné_fft`
(109 questions, 21 réponses, rédigé par la kiné et utilisé hors application) —
mais il n'est **pas** le modèle : il en est le premier. Un cycliste, un retour
de blessure ou un bilan d'épaule en appellent d'autres, que la kiné doit
pouvoir composer elle-même.

Ce document décrit le moteur, et le contenu du premier modèle.

---

## 1. Ce que c'est — et ce que ce n'est pas

⚠️ **À NE PAS CONFONDRE AVEC LE SIGNALEMENT QUOTIDIEN** (`daily_logs.kine`,
livré le 2026-08-18). Les deux portent sur la santé de l'athlète et partagent le
vocabulaire du ressenti, mais tout le reste diffère — et les modèles de données
divergent en conséquence :

| | Signalement quotidien | Bilan |
|---|---|---|
| Fréquence | tous les jours, 3 clics | occasionnel, une heure |
| Contenu | **pas arrêté**, il bougera | **composé** par la kiné, puis figé à l'instance |
| Stockage | `jsonb` libre | tables structurées |
| Finalité | « qui va mal en ce moment ? » | comparer dans le temps |

Le `jsonb` du quotidien évite une migration à chaque reformulation. Ici c'est
l'inverse qui prime : **la comparabilité exige la structure**. Un résultat de
grip en texte libre ne se compare pas à celui d'il y a six mois — c'est
exactement ce que le formulaire actuel ne sait pas faire, et toute la raison
d'internaliser.

⚠️ **Et c'est la tension centrale du chantier** : plus un questionnaire est
modulaire, moins ses réponses sont comparables — le sens (« ceci est *des
secondes*, *à droite*, *avec 15 kg* ») migre du schéma vers un gabarit
modifiable. La réponse à cette tension est §3.1, et c'est la décision la plus
importante du document.

---

## 2. Le principe : des MODÈLES, des INSTANCES

**Un modèle** est composé par la kiné : des rubriques, des tests, leur
protocole, leur média de démonstration. Il s'édite, se duplique, s'archive.

**Une instance** est un bilan passé par un athlète à une date : il référence le
modèle, mais **ne dépend pas de lui pour être lu** (§3.1).

Créer le bilan du cycliste, c'est donc **dupliquer** le bilan complet puis
élaguer — le même geste que « dupliquer la base » dans l'éditeur de programmes,
et bien plus praticable que repartir d'une page blanche à 32 tests.

---

## 3. Les décisions, et leur raison

### 3.1 Le résultat est AUTO-DESCRIPTIF — la décision qui protège les données

Chaque résultat emporte **l'instantané de ce qui lui a été demandé** : libellé
du test et de sa rubrique, unité de mesure, latéralité, charge réellement
utilisée.

⚠️ **SANS ÇA, CHAQUE RETOUCHE DU MODÈLE RÉÉCRIT SILENCIEUSEMENT LE PASSÉ.** La
kiné fait passer le grip de 15 à 20 kg — geste parfaitement légitime — et les
résultats déjà enregistrés se mettent à dire autre chose sans que rien ne
bouge à l'écran. Aucune alerte, aucune trace : juste une courbe devenue fausse.
C'est la version « données » du défaut que ce projet rencontre en boucle (le
déploiement qui ment sur sa version, la règle dupliquée qui diverge) : une
vérité déduite d'une source qui a bougé depuis.

Figer le référentiel réglerait le problème mais interdirait l'édition, qui est
la demande. L'instantané tient les deux : le modèle vit librement, le résultat
reste vrai.

**Corollaire** : la comparaison entre deux bilans se vérifie sur l'instantané —
même test, même unité, même charge — au lieu d'être supposée.

### 3.2 Supprimer un test ne supprime pas l'historique

Retirer un test d'un modèle le fait disparaître des **futurs** bilans ; les
résultats passés restent, lisibles grâce à §3.1. D'où `retire` sur le test
(retrait doux, le lien survit) **et** `ON DELETE SET NULL` sur le résultat, pour
qu'une suppression franche en base ne détruise jamais de donnée d'athlète.

### 3.3 NULL n'est pas zéro

`NULL` = test **non réalisé** (matériel absent, douleur qui l'empêche, pas eu le
temps). `0` = test réalisé, échec complet. Pour une kiné ces deux-là n'ont rien
à voir, et les confondre fausse toute lecture d'évolution. C'est le défaut le
plus récurrent du projet — le vide et l'absence traités pareil.

### 3.4 La charge enregistrée est celle utilisée, pas celle prescrite

Le protocole dit 15 kg ; la salle n'a qu'un disque de 12. Enregistrer le
résultat comme s'il valait 15 serait un mensonge silencieux, propagé ensuite par
chaque comparaison. La charge du modèle pré-remplit, l'athlète corrige.

### 3.5 Un test de tronc n'a pas de côté

Le formulaire actuel demande « Droite/Gauche » à l'**érecteur du rachis** et au
**transverse/grands droits** — artefact de copier-coller. D'où le drapeau
`bilateral` sur le test : une seule case quand il n'y a qu'un résultat. Sans
lui, on récolte pour des années une colonne remplie au hasard.

### 3.6 Les deux familles de médias ne partagent pas la même table

| | Médias de démonstration | Médias d'athlète |
|---|---|---|
| Contenu | le mouvement montré | le corps de l'athlète en test |
| Sensibilité | aucune | **donnée de santé nominative** |
| Portée | identique pour tous | un athlète, un bilan |
| Hébergement | CDN, cacheable | privé, périmètre HDS (FRE-58) |
| Lot | **B** (tout de suite) | **C** (après FRE-58) |

⚠️ **Une seule table `medias` ferait basculer les photos de démonstration dans
le régime des données de santé** — et annulerait le bénéfice de la
compartimentation décidée en §3.7. Deux stockages, deux régimes d'accès, une
seule mécanique d'upload.

### 3.7 L'historique médical vit sur le BILAN, pas sur `athletes`

Porté par la fiche athlète, il ferait basculer **toute la table athlètes** dans
le périmètre des données de santé — donc une migration totale le jour de
FRE-58. Sur le bilan, le périmètre médical se réduit aux tables de ce document :
le déplacement devient chirurgical.

Effet de bord heureux : chaque bilan garde l'instantané de ce qui était connu
**à sa date**, ce qui est médicalement plus honnête qu'un champ écrasé au fil du
temps. Un nouveau bilan pré-remplit depuis le précédent ; l'athlète corrige.

### 3.8 L'identité n'est plus ressaisie

La question 2 du formulaire — « Nom, Prénoms, Date de naissance, Taille, Poids »
dans **un seul champ texte** — disparaît : l'application a déjà tout, à une
exception près. **La date de naissance manque côté `athletes`** et doit être
ajoutée : prérequis de ce chantier, indépendant de lui.

---

## 4. Le schéma

### Le modèle (composé par la kiné)

```sql
CREATE TABLE bilan_modeles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nom         text NOT NULL,              -- « Bilan complet », « Cycliste »
    description text,
    cree_par    text REFERENCES kines(uid) ON DELETE SET NULL,
    -- Archivé = retiré des choix, instances passées conservées et lisibles.
    archive     boolean NOT NULL DEFAULT false,
    cree_le     timestamptz NOT NULL DEFAULT now(),
    modifie_le  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bilan_rubriques (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modele_id  uuid NOT NULL REFERENCES bilan_modeles(id) ON DELETE CASCADE,
    libelle    text NOT NULL,               -- « Tests de mobilité »
    ordre      integer NOT NULL
);

CREATE TABLE bilan_tests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rubrique_id  uuid NOT NULL REFERENCES bilan_rubriques(id) ON DELETE CASCADE,
    libelle      text NOT NULL,
    protocole    text,                      -- départ, exécution, consignes
    -- LA PRESCRIPTION — des champs, pas de la prose : c'est ce qui rend une
    -- variation détectable (cf. §3.4).
    mesure       text NOT NULL DEFAULT 'aucune'
                 CHECK (mesure IN ('aucune', 'reps', 'secondes')),
    bilateral    boolean NOT NULL DEFAULT false,
    charge_kg    numeric,
    duree_cible_sec numeric,
    vue          text,                      -- « face », « profil », « dos »
    media_demo_id uuid REFERENCES bilan_medias_demo(id) ON DELETE SET NULL,
    ordre        integer NOT NULL,
    -- Retrait DOUX : disparaît des futurs bilans, l'historique survit (§3.2).
    retire       boolean NOT NULL DEFAULT false
);

-- Médias de DÉMONSTRATION uniquement — non sensibles (§3.6).
CREATE TABLE bilan_medias_demo (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chemin    text NOT NULL,                -- objet du bucket public
    type      text NOT NULL CHECK (type IN ('image', 'video')),
    legende   text,
    cree_par  text REFERENCES kines(uid) ON DELETE SET NULL,
    cree_le   timestamptz NOT NULL DEFAULT now()
);
```

### L'instance (passée par un athlète)

```sql
CREATE TABLE bilans (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id  uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    -- Le modèle peut être supprimé sans emporter les bilans : d'où SET NULL,
    -- et le nom recopié pour que l'instance reste intelligible (§3.1).
    modele_id   uuid REFERENCES bilan_modeles(id) ON DELETE SET NULL,
    modele_nom  text NOT NULL,
    bilan_date  date NOT NULL,
    kine_uid    text REFERENCES kines(uid) ON DELETE SET NULL,
    -- 32 tests ne se remplissent pas d'une traite : sans reprise, on perd tout
    -- à l'abandon. `en_cours` est la règle, pas l'exception (§6).
    statut      text NOT NULL DEFAULT 'en_cours'
                CHECK (statut IN ('en_cours', 'finalise')),
    antecedents text,                       -- §3.7
    notes       text,
    cree_le     timestamptz NOT NULL DEFAULT now(),
    modifie_le  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bilans_athlete_date ON bilans (athlete_id, bilan_date DESC);

CREATE TABLE bilan_resultats (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bilan_id      uuid NOT NULL REFERENCES bilans(id) ON DELETE CASCADE,
    -- L'identité stable du test, pour comparer d'un bilan à l'autre. NULL si le
    -- test a été supprimé du modèle : le résultat reste lisible (§3.2).
    test_id       uuid REFERENCES bilan_tests(id) ON DELETE SET NULL,

    -- ⚠️ L'INSTANTANÉ (§3.1) — ce qui a été DEMANDÉ, figé au remplissage. Sans
    -- lui, toute retouche du modèle réécrit le passé en silence.
    test_libelle     text NOT NULL,
    rubrique_libelle text,
    -- ⚠️ LES CONSIGNES AUSSI, et c'est le FRONT qui l'a révélé : l'athlète doit
    -- lire ce qu'il a à faire, et il n'a pas accès au catalogue des modèles
    -- (réservé à la kiné). Sans elles ici, aucun chemin ne les lui apporte.
    protocole        text,
    vues             text[] NOT NULL DEFAULT '{}',
    cible            text,
    mesure           text NOT NULL CHECK (mesure IN ('aucune', 'reps', 'secondes')),
    bilateral        boolean NOT NULL,
    charge_kg        numeric,               -- celle UTILISÉE (§3.4)
    ordre            integer,               -- l'ordre du bilan tel qu'il était

    ressenti      text CHECK (ressenti IN ('ras', 'douleur', 'gene')),
    detail        text,
    -- NULL = non réalisé ; 0 = réalisé, échec (§3.3).
    mesure_gauche numeric,
    mesure_droite numeric,

    modifie_le    timestamptz NOT NULL DEFAULT now()
);

-- Un test ne peut pas avoir deux résultats dans le même bilan.
CREATE UNIQUE INDEX bilan_resultats_unicite
    ON bilan_resultats (bilan_id, test_id) WHERE test_id IS NOT NULL;
```

**Lot C, à ne pas créer avant FRE-58** : `bilan_resultat_medias` — les vidéos
d'athlète, table séparée, bucket séparé, périmètre HDS (§3.6).

---

## 5. Le premier modèle : 32 tests

Contenu à **semer** comme données (`bilan_modeles` « Bilan complet » + ses
rubriques + ses tests), pas à écrire en dur. Colonnes : **mesure** = ce qu'on
saisit (`—` : rien, le ressenti seul) ; **bilat.** = deux valeurs G/D ou une ;
**charge** = prescrite, modifiable au résultat ; **vue** = consigne de prise de
vue (utile dès maintenant à l'écran, indispensable au lot C).

Chaque test porte en plus les deux mêmes champs libres : `ressenti`
(`RAS` / `Douleur` / `Gêne`) et `detail` (« si douleur ou gêne, détaillez »).

### Tests généraux

| libellé | protocole | mesure | bilat. | charge | vue |
|---|---|---|---|---|---|
| Squat overhead | 20 squats, bras tendus tenant un bâton | — | non | — | face+profil+dos |
| Lunge overhead | 20 fentes par jambe, posture contrôlée en overhead, bâton | — | non | — | face+profil+dos |

### Tests de mobilité

| libellé | protocole | mesure | bilat. | charge | vue |
|---|---|---|---|---|---|
| Cervicale — rotation | 3 rotations droites, 3 gauches | — | non | — | face |
| Cervicale — inclinaison | 3 inclinaisons droites, 3 gauches | — | non | — | face |
| Cervicale — flexion/extension | 3 flexions (regard bas), 3 extensions (regard haut) | — | non | — | profil |
| Épaule — flexion | Debout, expirer tout l'air, lever les bras au-dessus de la tête sans cambrer | — | non | — | profil |
| Épaule — extension | Allongé, front au sol, bras le long du corps, lever le bâton dans le dos | — | non | — | profil |
| Épaule — rotation externe/interne | Allongé, épaule à 90°, tourner l'avant-bras haut et bas | — | non | — | profil |
| Coude — pronation/supination | Debout, bâton en main, coude à 90°, tourner l'avant-bras intérieur/extérieur | — | non | — | face |
| Coude — flexion pron./neutre/sup. | Bras collé au corps : 1 supination, 2 neutre, 3 pronation | — | non | — | profil |
| Poignet — flexion/extension | Avant-bras plaqué sur la table, main fermée vers le haut puis le bas | — | non | — | profil |
| Thoracique — flexion/extension | Flexion : à 4 pattes, arrondir le dos. Extension : assis, mains aux épaules opposées, sternum au plafond | — | non | — | profil |
| Thoracique — rotation | Assis, mains croisées sur les épaules, tourner sans bouger les hanches | — | non | — | face |
| Hanche — rotation interne/externe | RI : assis, objet entre les genoux, lever le pied vers l'extérieur sans lever le bassin. RE : pied opposé sur le côté, lever le pied vers l'intérieur | — | non | — | face |
| Genou — flexion | Sur le ventre, talon aux fesses sans lever les hanches | — | non | — | face |
| Genou — rotation interne | Assis, pointe de pied relevée pour bloquer la cheville, tourner le tibia vers l'intérieur | — | non | — | face |
| Cheville — flexion dorsale | Pied à 10 cm du mur, avancer le genou jusqu'au mur sans lever le talon | — | non | — | profil |

### Tests d'activation musculaire

| libellé | protocole | mesure | bilat. | charge | vue |
|---|---|---|---|---|---|
| Rotateur externe d'épaule | Assis, bras à 90°, coude à 90° sur une box ; pivoter l'avant-bras vers le haut. Max reps | reps | oui | 5 kg | face |
| Rotateur interne d'épaule | Allongé, bras à 90°, coude à 90° ; pivoter l'avant-bras vers le haut sans bouger l'épaule. Max reps | reps | oui | 10 kg | profil |
| Grand pectoral | Allongé perpendiculaire à l'élastique ; isométrie 10 s, coude tendu, vers 1 le nombril, 2 le mamelon opposé, 3 l'épaule opposée, 4 l'œil opposé | — | non | 25 kg (élastique) | profil |
| Grand dorsal | Allongé, élastique fixé derrière ; ramener le bras en isométrie 20 s vers le nombril | — | non | 20 kg (élastique) | profil |
| Trapèze supérieur | Debout, coude tendu, KTB en main ; lever l'épaule au plafond sans plier le coude. Max reps | reps | oui | 30 kg | face |
| Trapèze inférieur | Allongé, front au sol, bras en Y pouce au ciel ; lever les bras en engageant les omoplates. Max reps | reps | oui | 1,5 kg | profil |
| Dentelé antérieur | Allongé sur le dos, kettlebell en main, bras tendu ; pousser en décollant l'épaule, coude tendu. Max reps | reps | oui | 30 kg | profil |
| Grip | Tenir un disque du bout des doigts, isométrie jusqu'à l'échec | secondes | oui | 15 kg | profil |
| Obliques | GHD, hanche au bord du coussin, pieds fixés sur le côté ; inclinaison latérale jusqu'au buste parallèle au sol. Max reps | reps | oui | 15 kg | profil |
| Érecteur du rachis | GHD, hanches légèrement en dehors du coussin ; pencher le torse puis remonter en contractant les lombaires. Maintien (cible 60 s) | secondes | **non** | 40 kg | profil |
| Transverse / grands droits | Allongé sur le dos, bras derrière la tête, jambes levées ; écraser le sol avec le dos. Maintien (cible 30 s) | secondes | **non** | — | profil |
| Moyen fessier | Sur le côté, appui avant-bras et côté du pied ; hanches en ligne, lever le pied à l'horizontale. Maintien (cible 30 s) | secondes | oui | — | profil |
| Petit fessier | Assis, une jambe en rotation externe devant, l'autre en rotation interne derrière ; lever le talon arrière au plafond, genou au sol. Max reps | reps | oui | — | face |
| Quadriceps | Dos au mur, genoux à 90°, KTB ; maintenir en tendant une jambe (cible 20 s), puis l'autre | secondes | oui | 20 kg | profil |
| Triceps sural | Debout sur une jambe, genou légèrement fléchi, KTB dans la main opposée ; monter sur la pointe en contrôlant | reps | oui | 30 kg | dos |

**Récapitulatif** : 32 tests — 2 généraux, 15 de mobilité (ressenti seul), 15
d'activation dont **13 mesurés** (7 en répétitions, 6 en secondes). Le grand
pectoral et le grand dorsal n'ont pas de mesure : leur protocole fixe la durée,
il ne reste que le ressenti.

**Les médias de démonstration existent déjà** : 39 photos dans le formulaire
actuel (positions du mouvement, ~85-150 ko pièce). Elles sont récupérables, mais
mieux vaut partir des originaux de la kiné que du PDF, qui les a ré-encodées.

---

## 6. Le parcours

**Côté kiné — composer.** Deux entrées : partir de zéro, ou **dupliquer** un
modèle existant et élaguer. La duplication est la voie normale — le bilan du
cycliste naît du bilan complet, et personne ne recompose 32 tests à la main ;
la page blanche existe pour les bilans courts et sans parenté (retour de
blessure sur une articulation, par exemple). Ajouter une rubrique, un test, son
média de démonstration. Retirer un test : il disparaît des prochains bilans,
jamais des anciens.

⚠️ **Seule la kiné compose** — décidé le 2026-08-21. Les coachs ne créent ni ne
modifient de modèle, et ne téléversent donc aucun média de démonstration : le
lot B ne concerne qu'un rôle, ce qui simplifie autant l'autorisation que
l'interface.

**Côté athlète — passer le bilan.** Dans l'onglet **Suivi kiné** de l'espace
athlète (FRE-68). Pas un formulaire qui s'impose : une carte « Bilan en cours »
avec sa progression. Chaque résultat est enregistré dès sa saisie, la reprise se
fait là où on s'est arrêté, « 12 tests sur 32 » reste affiché. Un bilan
`finalise` devient la référence comparable ; un `en_cours` n'entre dans aucune
comparaison.

**La comparaison est la raison d'être du chantier.** Sur un test donné, l'écran
montre la valeur du jour et celle du bilan précédent — et **signale** quand
l'instantané diffère (charge, unité) au lieu d'afficher une évolution
mensongère.

**Le ressenti rejoint le signalement.** `ras / douleur / gene` est déjà le
vocabulaire du bloc quotidien : une gêne relevée pendant un bilan peut alimenter
le tableau « qui va mal en ce moment », en portant sa provenance.

---

## 7. Les lots

| | contenu | dépendance |
|---|---|---|
| **A** ✅ | Le moteur : modèles, rubriques, tests éditables ; bilan instancié ; résultats auto-descriptifs ; le premier modèle semé. **Livré le 2026-08-21** (brokkr `7a7caa7`, eitri `ca2597d`) | date de naissance sur `athletes` |
| **B** | Upload des médias de **démonstration** (kiné) — non sensibles, bucket public | A |
| **C** | Upload des **vidéos d'athlète** — données de santé, bucket privé | **FRE-58** |

⚠️ **Le calendrier doit être dit franchement** : A+B, c'est plusieurs semaines,
là où les 32 tests écrits en dur auraient pris quelques jours. La kiné reste sur
son Google Form jusque-là. C'est le prix du modulaire, et il se justifie parce
que l'objectif est une plateforme — pas un dépannage.

---

## 8. Ce que le coach voit — le « signal dérivé »

La règle maison est d'ouvrir large entre gens du staff, mais c'est ici qu'elle
frotte avec le cadre légal : antécédents et pathologies ne sont pas de la donnée
d'entraînement. D'où une découpe explicite plutôt qu'un accès global.

**Le bilan est lisible par la kiné et l'athlète.** Le coach en reçoit le seul
**signal dérivé** : le **mouvement** et le **niveau de ressenti**, daté —
« gêne signalée sur le squat overhead, bilan du 12/09 ».

| | coach | kiné, athlète |
|---|---|---|
| Mouvement + ressenti (`ras`/`douleur`/`gene`), daté | ✅ | ✅ |
| Texte libre « si douleur ou gêne, détaillez » | ❌ | ✅ |
| Mesures chiffrées | ❌ | ✅ |
| Antécédents, pathologies, opérations | ❌ | ✅ |
| Médias d'athlète (lot C) | ❌ | ✅ |

**Pourquoi cette ligne-là** : le signal dérivé est *exactement* ce que le coach
voit déjà dans le tableau des signalements quotidiens — même vocabulaire, même
granularité. Aucune catégorie nouvelle d'information ne lui parvient, elle gagne
seulement une source. Et c'est le strict nécessaire pour qu'il programme sans
danger. S'il lui en faut plus, il demande à l'athlète ou à la kiné : c'est une
frontière humaine, pas une cloison technique.

À câbler dans la couture d'autorisation existante (`require_athlete_access` +
matrice par rôle), pas ailleurs.

---

## 9. Hors périmètre, explicitement

**Les 21 réponses du Google Form y restent.** Le chantier vise les **prochains**
bilans ; l'historique déjà collecté n'est pas repris. Une migration reste
possible plus tard — la structure d'accueil existe — mais elle n'est pas dans ce
lot, et elle ne conditionne rien.

**Les vidéos d'athlète** : lot C, après FRE-58 (§3.6).

**Le référentiel modifiable par d'autres que la kiné** : non prévu (§6).
