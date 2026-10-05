# Comment on travaille ici

⚠️ **Ce fichier ne décrit pas la stack** — c'est le rôle des `README.md`, un par
dépôt. Il décrit les RÈGLES, celles que ce projet a payées pour apprendre. Chaque
ligne ci-dessous existe parce qu'un défaut est passé, pas parce qu'elle sonne
bien. Quand une règle te paraît excessive, elle correspond à un incident.

---

## 1. Avant d'écrire du code

L'échelle, dans l'ordre. On ne descend d'un barreau que si le précédent est
fermé.

1. **Ne rien écrire.** Le besoin est-il réel ? Combien de lignes de production
   sont concernées ?
2. **Réutiliser ce qui existe** dans le dépôt. Une fonction, une requête, une
   fixture.
3. **La bibliothèque standard**, puis une **fonctionnalité native** (Postgres,
   le navigateur, TypeScript).
4. **Une dépendance déjà installée.** Pas une nouvelle.
5. **Le minimum qui tienne**, et ses gardes.

⚠️ **Un outil qui existe se recommande, il ne se recode pas.** dbdiagram.io pour
un schéma, pas un générateur maison.

⚠️ **Ce qui ne sert à personne se supprime, il ne se sécurise pas.** C'est ce
qu'on a fait du rôle `analytics_ro`.

⚠️ **LE COMMENTAIRE DIT L'INVARIANT, AU PRÉSENT. LE RÉCIT VA DANS LE COMMIT.**
Ce qui reste dans le code : pourquoi le pooler refuse `options`, pourquoi `''`
n'est pas `NULL`, ce qu'une règle garde et ce qui casse sans elle. Ce qui en
sort : les dates, les incidents, les « on a longtemps cru », ce que le code
faisait avant — le commit et le ticket les portent déjà. Un commentaire qui
raconte finit par décrire un code qui n'existe plus (FRE-184 : 38 mentions de
Firestore dans brokkr, un mois après sa coupure).

* **Docstring PEP 257** : une ligne de résumé, puis le POURQUOI s'il ne se lit
  pas dans le code ; `Raises:` quand une erreur métier est levée. Dix lignes au
  plus en tête de module.
* **`FRE-xx` reste** quand il explique une règle ; pas quand il date un geste.
* **Un ⚠️ qui garde un invariant vivant ne se coupe pas.**

---

## 2. Mesurer, toujours, avant d'agir

⚠️ **La production est lisible en LECTURE SEULE** (`api-python/.env`, `DATABASE_URL`).
S'en servir avant d'écrire une ligne, pas après.

* **Compter avant de ménager.** Avant d'écrire un chemin de compatibilité,
  compter les lignes concernées : c'est souvent zéro.
* **Un signalement se vérifie dans la DONNÉE**, avec une population témoin. Le
  code ne montre que le chemin qu'on regarde.
* **Un chiffre faux ? Soupçonner la donnée avant la sémantique d'affichage.**
* **Un commentaire n'affirme jamais un état de la donnée par un chiffre.** Il
  cite l'invariant qui le garde (`make invariants`). Un chiffre vieillit en
  silence — celui de `supports` a menti deux jours après avoir été écrit.

---

## 3. Une spec jamais vue échouer n'existe pas

⚠️ **LA RÈGLE LA PLUS COÛTEUSE À OUBLIER, et elle est tombée deux fois le même
jour.** Une spec écrite verte ne prouve rien.

* **La voir ROUGE sur la faute qu'elle prétend garder**, en la fabriquant.
* **La mutation vise ce que le ticket PROMET**, pas ce qu'il touche.
* ⚠️ **Se méfier de la spec qui ne peut pas rougir.** Deux exemples réels : un
  candidat fautif qui perdait de toute façon face au bon ; un ressenti déjà
  effacé au moment où la règle joue. Les deux passaient au vert avec ou sans le
  correctif. Si la mutation ne rougit pas, c'est la spec qui est fausse.
* **Traverser le VRAI chemin.** Une vérification par URL tapée à la main ne
  prouve rien ; une spec qui ne traverse pas l'état où le défaut vit est verte
  pour rien. Le harnais réel (`scripts/e2e-reel.sh`) est là pour ça.

---

## 4. Où vivent les garde-fous

⚠️ **LA CI N'EST JAMAIS LUE ICI** — les deux `ci.yml` ont été retirés le 09/09.
Une vérification se place dans l'un des trois seuls endroits qu'on lit :

| endroit | ce qu'il garde |
| -- | -- |
| une cible `make` | le contrat, le schéma, les migrations, les invariants |
| le démarrage du harnais réel | la dérive du bac à sable |
| le déploiement | tout ce qui précède, avant de partir |

`make deploy` joue `contrat`, `schema-verifier STRICT=1` et `migrations` avant
de déployer, puis `verifier` après — SHA servi ET bornes de session reçues.

⚠️ **Un vérificateur qui sort vert pour la mauvaise raison est PIRE que pas de
vérificateur : il rassure.** Il doit lever, pas afficher.

---

## 5. Les défauts que ce projet répète

* ⚠️ **`''` contre `NULL`.** Le plus récurrent. À l'écriture comme à
  l'affichage. En Python, un tableau VIDE est faux : `if supports:` confondait
  `[]` et `NULL`. Quand une distinction n'est exprimable nulle part, la rendre
  IMPOSSIBLE vaut mieux que la faire vivre.
* ⚠️ **Une règle dupliquée.** Deux définitions d'une même notion : déplacer le
  CALCUL côté serveur, pas synchroniser la règle. La divergence devient
  impossible au lieu d'être corrigée.
* ⚠️ **Une demi-règle.** Appliquée à la création et pas à la suppression, à
  l'écriture et pas à la lecture. Une semaine masquée l'était à l'écriture, pas
  à la lecture — pendant des mois.
* ⚠️ **Un état « pas encore chargé » qui prend la forme d'une valeur.** Un
  `?? ''` sur une liste vide crée un objectif que le serveur refuse.
* ⚠️ **Le rôle plutôt que le lien.** « Est-il l'athlète ? » est presque toujours
  la mauvaise question ; « programme-t-il ? » est la bonne. Les 4 coachs de
  production sont AUSSI athlètes, et toute règle branchée sur un rôle unique
  leur passe au vert sans être éprouvée.

---

## 6. Les frontières du produit

* **Le front ne propose une écriture QUE là où brokkr l'accepte.** Si le serveur
  refuse, le bouton n'existe pas.
* **Le maximum de logique dans brokkr** — argument de PROPRIÉTÉ : William est
  seul, et lit mal le TypeScript.
* **On n'arbitre pas entre humains.** Ouvrir large entre gens du staff ; les
  frontières s'affinent à l'usage, pas par anticipation. Exception : le bilan
  kiné, dont le coach est exclu.
* **Le suivi n'affiche que ce qui porte une TRACE de réalisation.**

---

## 7. Les gestes

```bash
make dev                     # la stack locale (mprocs)
make anciennes-origines      # qui passe encore par les adresses à fermer
scripts/e2e-reel.sh          # le harnais réel — ne rend pas la main dans un pipe
```

| dossier | vérifier | déployer |
| -- | -- | -- |
| api-python | `make test`, `make invariants`, `make contrat` | `make deploy` |
| api | `make test`, `make lint` ; `make contrat` (racine) après `proto/` ou une requête SQL | `make deploy` |
| web | `npx tsc -b`, `npm test`, `npm run test:e2e` | `make hosting` |
| infra | `terraform fmt`, `validate` | `terraform apply` — depuis hodos SEULEMENT |

⚠️ **`tsc --noEmit` NE VÉRIFIE RIEN** dans web (tsconfig solution) : `tsc -b`.

⚠️ **LE DÉPLOIEMENT EST MANUEL, et ne se propose jamais.** William déploie
lui-même, et pousse lui-même. On prépare, on vérifie, on dit ce qui reste.

⚠️ **LE SERVEUR PASSE AVANT LE FRONT — `make livrer`, à la racine.** Lancés
ensemble, l'hébergement du front finit toujours le premier : il publie des
fichiers, l'autre construit une image. Deux incidents en deux jours, le même
mécanisme. Le 09/09, la carte Objectifs s'est affichée vide pour tout le monde ;
le 10/09, noter un RPE l'effaçait. Un nouveau serveur comprend l'ancien contrat ;
l'inverse est faux.

⚠️ **La version est le SHA du commit**, et elle se vérifie APRÈS coup.

---

## 8. La donnée est réelle

⚠️ **Deux à trois ans d'entraînement de vrais athlètes, et des bilans kiné.**

* **Aucune écriture en production sans demande explicite.** Une mesure se fait
  en lecture seule (`conn.read_only = True`).
* **Une migration se joue à la main** (`python -m scripts.migrer --apply`), et
  `make deploy` refuse tant qu'il en reste une en attente.
* ⚠️ **Une migration NE S'ÉPROUVE PAS dans une transaction annulée** — le fichier
  porte son propre `BEGIN; … COMMIT;`, qui ferme la transaction enveloppante : le
  `rollback()` n'annule plus rien, et le script affiche « annulée » après avoir
  écrit. C'est arrivé le 12/09. Pour éprouver le CONTENU, copier le corps SANS
  son `BEGIN`/`COMMIT`/`INSERT INTO schema_migrations`, et vérifier le rollback
  par un COMPTE en sortie de bloc, pas par le message du script. `migrer.py` le
  sait déjà : il travaille en AUTOCOMMIT pour cette raison.
* **Ne jamais supprimer sans demande.** Un dump local porte des données de
  santé : il s'efface après usage.
* ⚠️ **Un `ALTER ROLE … SET` ne s'applique qu'aux connexions NEUVES.** Le
  service garde son pool : il faut redéployer pour le voir.
* ⚠️ **Ne jamais recopier un secret à la main.** Une copie abîmée a coûté une
  heure de doute sur un rôle parfaitement correct.

---

## 9. Le backlog et l'écrit

* **Le backlog vit dans Linear** (équipe FRE, label = nom du dossier). Ne pas
  créer de fichier backlog dans le dépôt.
* **Un ticket porte ses MESURES**, pas des impressions.
* **Un commit dit POURQUOI**, et ce qu'il a vu rouge.
* **Répondre COURT.** Le fait et l'action. La rigueur reste, c'est la longueur
  qui saute.
* **Une question se pose par deux CAS concrets**, en tableau, jamais par la
  tension abstraite.
