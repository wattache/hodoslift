# Progression automatique : des lignes qui ne progressent pas

Bonjour,

J'ai trouvé un défaut de l'application en enquêtant sur un signalement, et il
touche quelques lignes de vos programmes. **Rien n'est perdu et rien n'est
faux** — mais certaines lignes ne progressent pas toutes seules, alors que leur
trame prévoit un incrément.

## Ce qui se passe

L'incrément est copié **une seule fois**, quand la semaine 1 est générée depuis
la BASE. Chaque semaine suivante recopie ensuite la précédente. La trame n'est
plus relue.

Conséquence : **une ligne créée avant que son incrément ne soit posé dans la
trame ne l'a jamais reçu**, et l'ajouter à la trame après coup ne redescend pas
dans les semaines déjà créées. Vous voyez l'incrément dans la BASE, il est bien
là — il n'est simplement pas sur la ligne de la semaine.

Et l'incrément n'est affiché nulle part dans la semaine : impossible de voir
lesquelles sont concernées, ni de le corriger depuis l'écran.

## Ce que ça donne, selon le type d'incrément

**Incrément en CHARGE (kg).** La charge ne monte pas toute seule, et à la
prochaine semaine générée **elle sera effacée** au lieu d'être reprise — c'est la
règle : sans incrément, l'application ne recopie pas une charge, elle laisse le
coach la reposer. Ce sont les lignes à surveiller.

**Incrément en RPE.** La charge vide est **normale** dans ce mode : c'est
l'athlète qui choisit sa charge pour atteindre le RPE visé. Ce qui manque ici,
c'est que **le RPE visé ne monte pas** de semaine en semaine — il reste à sa
valeur au lieu d'augmenter.

## Ce que vous avez à faire : rien pour l'instant

Vous ne pouvez pas corriger ces lignes vous-mêmes — le champ n'existe pas dans
l'écran de la semaine. Je m'en occupe côté base de données.

En attendant, si une charge disparaît sur une des lignes ci-dessous, ce n'est ni
un bug d'affichage ni une perte : reposez-la simplement à la main.

Le correctif de fond est décidé : **l'incrément sera relu dans la trame à chaque
nouvelle semaine**, pour que la corriger suffise. Je vous préviendrai.

Le ⚠️ marque la dernière semaine d'un bloc — celle dont la suivante sera
générée, donc celle où le symptôme apparaîtra en premier.


---

## Pour Maxime Nowak — maximenowak2017@gmail.com

**17 ligne(s) concernée(s)** (5 en charge, 12 en RPE).


### Liam Rossignot

| bloc | semaine | séance | exercice | prescrit | incrément prévu dans la trame |
| --- | --- | --- | --- | --- | --- |
| Macro 1 · Bloc 1 | S1 | Jeudi | ROMANIAN DEADLIFT | 3×6-8 @100 | 0,5 rpe |
| Macro 1 · Bloc 1 | S1 | Jeudi | BACK EXTENSION | 3×10-12 @35 | 0,5 rpe |
| Macro 1 · Bloc 1 | S1 | Vendredi | CHEST PRESS | 2×8-10 @70 | 0,5 rpe |
| Macro 1 · Bloc 1 | S2 | Jeudi | ROMANIAN DEADLIFT | 3×6-8 @105 | 0,5 rpe |
| Macro 1 · Bloc 1 | S2 | Jeudi | BACK EXTENSION | 3×10-12, sans charge | 0,5 rpe |
| Macro 1 · Bloc 1 | S2 | Vendredi | CHEST PRESS | 2×8-10, sans charge | 0,5 rpe |
| Macro 1 · Bloc 1 | S3 | Jeudi | ROMANIAN DEADLIFT | 3×6-8, sans charge | 0,5 rpe |
| Macro 1 · Bloc 1 | S3 | Jeudi | BACK EXTENSION | 3×10-12, sans charge | 0,5 rpe |
| Macro 1 · Bloc 1 | S3 | Vendredi | CHEST PRESS | 2×8-10, sans charge | 0,5 rpe |
| Macro 1 · Bloc 1 | S4 ⚠️ | Jeudi | ROMANIAN DEADLIFT | 3×6-8, sans charge | 0,5 rpe |
| Macro 1 · Bloc 1 | S4 ⚠️ | Jeudi | BACK EXTENSION | 3×10-12, sans charge | 0,5 rpe |
| Macro 1 · Bloc 1 | S4 ⚠️ | Vendredi | CHEST PRESS | 2×8-10, sans charge | 0,5 rpe |

### Mattys Heinimann

| bloc | semaine | séance | exercice | prescrit | incrément prévu dans la trame |
| --- | --- | --- | --- | --- | --- |
| Macro 1 · Bloc 1 | S3 | Jeudi | SQUAT (ZERCHER) | 3×6 @60 | 2,5 kg |
| Macro 1 · Bloc 1 | S3 | Lundi | SQUAT (ZERCHER) | 5×5 @57,5 | 2,5 kg |
| Macro 1 · Bloc 1 | S4 ⚠️ | Jeudi | SQUAT (ZERCHER) | 3×6 @65 | 2,5 kg |
| Macro 1 · Bloc 1 | S4 ⚠️ | Lundi | SQUAT (ZERCHER) | 5×5 @62,5 | 2,5 kg |

### Tom Kearns

| bloc | semaine | séance | exercice | prescrit | incrément prévu dans la trame |
| --- | --- | --- | --- | --- | --- |
| Macro 1 · Bloc 1 | S5 ⚠️ | Training 2 | MUSCLE UP | 3×1 @10 | 1,25 kg |


---

## Pour Goutte-toquet Théo — theogoutte69@gmail.com

**8 ligne(s) concernée(s)** (4 en charge, 4 en RPE).


### Alix Davy

| bloc | semaine | séance | exercice | prescrit | incrément prévu dans la trame |
| --- | --- | --- | --- | --- | --- |
| Macro 1 · Bloc 1 | S1 | Lundi | MUSCLE UP (COMP) | 3×4 @5 | 2,5 kg |
| Macro 1 · Bloc 1 | S2 | Lundi | MUSCLE UP (COMP) | 3×4 @7,5 | 2,5 kg |
| Macro 1 · Bloc 1 | S3 | Lundi | MUSCLE UP (COMP) | 3×4 @10 | 2,5 kg |
| Macro 1 · Bloc 1 | S4 ⚠️ | Lundi | MUSCLE UP (COMP) | 3×4 @12,5 | 2,5 kg |

### Jan Walter

| bloc | semaine | séance | exercice | prescrit | incrément prévu dans la trame |
| --- | --- | --- | --- | --- | --- |
| Macro 1 · Bloc 1 | S1 | Mercredi | SQUAT (SSB) | 3×6 @160 | 0,5 rpe |
| Macro 1 · Bloc 1 | S2 | Mercredi | SQUAT (SSB) | 3×6 @170 | 0,5 rpe |
| Macro 1 · Bloc 1 | S3 | Mercredi | SQUAT (SSB) | 3×6 @190 | 0,5 rpe |
| Macro 1 · Bloc 1 | S4 ⚠️ | Mercredi | SQUAT (SSB) | 3×6, sans charge | 0,5 rpe |


---

## Pour Aubin Chevillard — skaliobin@gmail.com

**5 ligne(s) concernée(s)** (5 en charge, 0 en RPE).


### Guilhemette

| bloc | semaine | séance | exercice | prescrit | incrément prévu dans la trame |
| --- | --- | --- | --- | --- | --- |
| Macro 1 · Bloc 2 | S4 ⚠️ | Mercredi | MUSCLE UP (COMP) | 3×1 @0 | 2.5 kg |

### Killian

| bloc | semaine | séance | exercice | prescrit | incrément prévu dans la trame |
| --- | --- | --- | --- | --- | --- |
| Macro 1 · Bloc 1 | S1 | Lundi | MUSCLE UP | 4×4 @6,25 | 1,25 kg |
| Macro 1 · Bloc 1 | S2 | Lundi | MUSCLE UP | 4×4 @7 | 1,25 kg |
| Macro 1 · Bloc 1 | S3 | Lundi | MUSCLE UP | 4×4 @8 | 1,25 kg |
| Macro 1 · Bloc 1 | S4 ⚠️ | Lundi | MUSCLE UP | 4×4 @8 | 1,25 kg |