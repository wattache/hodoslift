/** Contrat API brokkr — types miroirs des réponses/payloads du backend.
 *
 *  Source de vérité : brokkr/app/routers/*.py + brokkr/app/schemas/*.py.
 *  Convention : le backend renvoie du camelCase ; les champs optionnels omis
 *  quand NULL sont marqués `?`. Aucun type « view-model » ici — les vues
 *  consomment ces types directement (c'était le rôle de l'adapter v2, supprimé).
 */

import type { components } from '@/api/brokkr.gen';

/* ----------------------------------------------------------------------------
 * Identité — GET /users/me, GET /users, PUT /users/{uid}/coach
 * ------------------------------------------------------------------------- */

/** Qui suis-je, et à quels titres.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type Me = components['schemas']['MoiLu'];

/** Les réglages d'affichage de la personne, et le vocabulaire fermé des rendus
 *  de la progression (brief progression, 27/09).
 *
 *  GÉNÉRÉS depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type Preferences = components['schemas']['Preferences'];
export type PreferencesPatch = components['schemas']['PreferencesPatch'];
export type RenduProgression = NonNullable<components['schemas']['Preferences']['progression']>;

/** Les notifications push (28/09) : l'abonnement du navigateur, son retrait, la
 *  clé publique VAPID.
 *
 *  GÉNÉRÉS depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type AbonnementPush = components['schemas']['AbonnementPush'];

/** Le suivi de poids par semaine (29/09) : le tableau lu, et le départ posé.
 *
 *  GÉNÉRÉS depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type PoidsSemaines = components['schemas']['PoidsSemainesLu'];
export type SemainePoids = components['schemas']['SemainePoids'];
export type PoidsDepartEcrit = components['schemas']['PoidsDepartEcrit'];
export type RetraitPush = components['schemas']['RetraitPush'];
export type ClePubliquePush = components['schemas']['ClePubliquePush'];

/** Une ligne de l'annuaire des comptes (admin).
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type UserRow = components['schemas']['UtilisateurLu'];

/** Un kiné déclaré — GET /kines (réservé aux coachs, pour le sélecteur
 *  « Suivi kiné » de la fiche athlète). */
export type Kine = components['schemas']['KineLu'];

/** Les corps des `PUT /users/{uid}/kine` et `PUT /users/{uid}/coach` (admin). */
export type UserKineSet = components['schemas']['UserKineSet'];
export type UserCoachSet = components['schemas']['UserCoachSet'];

/* ----------------------------------------------------------------------------
 * Athlètes — GET /athletes (annuaire), GET /athletes/mine, POST /athletes,
 * PATCH /athletes/{id}/profile, PATCH /athletes/{id}/coach, POST /athletes/link
 * ------------------------------------------------------------------------- */

/** Les 1RM par mouvement.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type OneRepMax = components['schemas']['UnRM'];

/** Profil public (annuaire Communauté) — PAS d'email ni linkedUserId.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type AthleteDirectoryEntry = components['schemas']['AthletePublic'];

/** Profil complet (mes athlètes) — email + linkedUserId + kineUid inclus.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type Athlete = components['schemas']['AthleteMine'];
/** Une fiche vue par l'admin (FRE-190) : sept champs, ni programme ni mesure. */
export type AthleteAnnuaire = components['schemas']['AthleteAnnuaire'];
/** Un athlète qu'un coach peut inscrire à une compétition (FRE-190). */
export type AthleteInscriptible = components['schemas']['AthleteInscriptible'];
/** L'accès support d'un admin à un athlète (FRE-202). */
export type AccesSupportDemande = components['schemas']['AccesSupportDemande'];
export type AccesSupportEcrit = components['schemas']['AccesSupportEcrit'];

/** Le corps du `PATCH /athletes/{id}/profile`.
 *
 *  ⚠️ CORPS DE REQUÊTE, ET C'EST LA PREMIÈRE FOIS QUE LE FRONT EN TIRE UN DU
 *  CONTRAT. FastAPI documente les payloads autant que les réponses ; les
 *  recopier à la main était le même pari perdant que pour les lectures. */
export type AthleteProfilePatch = components['schemas']['AthleteProfilePatch'];

/** Le corps du `POST /athletes` — création/invitation. */
export type AthleteCreate = components['schemas']['AthleteCreate'];

/** Le corps du `PATCH /athletes/{id}/kine` — `kineUid: null` DÉTACHE, et
 *  l'absence de la clé ne ferait rien : la nuance est dans le contrat. */
export type AthleteKineSet = components['schemas']['AthleteKineSet'];

/** Le corps du `PATCH /athletes/{id}/archive`.
 *
 *  ⚠️ LE SEUL SCHÉMA À NOM COMPOSÉ du contrat : brokkr en engendre une variante
 *  d'entrée et une de sortie (`-Input` / `-Output`), parce que le même modèle
 *  sert dans les deux sens avec un défaut. C'est bien celle d'ENTRÉE qu'il faut. */
export type AthleteArchive = components['schemas']['AthleteArchive-Input'];

/** Le corps du `PATCH /athletes/{id}/coach` — réassignation (admin). */
export type AthleteCoachReassign = components['schemas']['AthleteCoachReassign'];

/* ----------------------------------------------------------------------------
 * Programme d'entraînement — GET /programs/{pid}/training + écritures T1→T3
 * (lu de Postgres depuis la bascule du 16/08 : brokkr rend l'arbre tel que ses
 * tables le portent, plus une recomposition de documents).
 * ------------------------------------------------------------------------- */

/** Unité d'un incrément semaine-sur-semaine — le vocabulaire CHOISISSABLE.
 *
 *  ⚠️ DÉRIVÉ DU CONTRAT MOINS LA CHAÎNE VIDE, et les deux moitiés comptent. Le lien
 *  au contrat fait qu'une unité ajoutée côté serveur arrive ici toute seule ;
 *  l'exclusion dit que `''` est une valeur STOCKABLE (713 lignes de production
 *  n'ont pas d'unité) sans être une valeur qu'on PROPOSE. Recopier la liste
 *  perdait le premier point, la dériver telle quelle aurait perdu le second. */
export type IncrementUnit = Exclude<Exercise['incrementUnit'], ''>;


/** Nature d'une ligne d'exercice (FRE-10) — ce qu'elle est, pas où elle est.
 *
 *  Portée par la LIGNE et non par la séance : une séance d'échauffement n'est
 *  qu'une séance dont toutes les lignes sont `warmup`, tandis que l'inverse —
 *  deux lignes de mobilité en tête d'une séance de squat — resterait impossible
 *  avec un marqueur plus haut.
 *
 *  ⚠️ `NonNullable` : le serveur rend `null` pour « entraînement », et ce type-ci
 *  nomme les trois natures, pas l'absence. Le contrat d'écriture REJETTE en
 *  revanche la chaîne vide — un `kind: ''` faisait tomber la semaine ENTIÈRE en
 *  422. La valeur, `null`, ou rien. */
export type ExerciseKind = NonNullable<Exercise['kind']>;

/* ═══════════════════════════════════════════════════════════════════════════
   L'ARBRE D'ENTRAÎNEMENT — six niveaux, et le plus gros contrat du projet.

   ⚠️ DEUX FAMILLES DE TYPES ICI, ET LA DISTINCTION EST TOUT L'INTÉRÊT (FRE-70).

   Ce fichier confondait jusqu'ici ce que le front REÇOIT et ce qu'il FABRIQUE.
   Les deux portaient le même type, et l'ambiguïté se réglait en semant des `?` :
   `id?` parce qu'une ligne pas encore enregistrée n'en a pas, `sessions?` parce
   qu'une semaine en cours de construction n'en a pas encore. Résultat, le code
   d'affichage devait se défendre d'absences qui n'arrivent JAMAIS — le serveur
   envoie tous les champs, toujours.

   Désormais :

   • LECTURE (`Exercise`, `Week`, `Block`…) — engendrée depuis `docs/openapi.json`,
     donc stricte. Tout est là. L'écran qui affiche n'a plus rien à tester.

   • BROUILLON (`ExerciseDraft`, `WeekDraft`…) — ce que l'éditeur assemble avant
     d'enregistrer. Partiel par nature, et c'est dit.

   La conversion se fait à l'enregistrement, là où le brouillon devient une chose
   que le serveur connaît. C'est le même défaut de frontière que `''` contre NULL,
   transposé aux types : « pas encore écrit » et « reçu vide » ne sont pas la même
   chose, et un seul type ne peut pas dire les deux.
   ═══════════════════════════════════════════════════════════════════════════ */


/* ── LECTURE ──────────────────────────────────────────────────────────────── */

/** Une ligne de prescription dans une séance.
 *
 *  Ce que le type engendré garantit, et qui a coûté cher à établir :
 *
 *  • `variant` est TOUJOURS une liste (FRE-33) — variantes cumulées, « DS » +
 *    « PAUSE » plutôt qu'une entrée `DS PAUSE` de plus au référentiel. 5 086
 *    lignes sur 9 935 n'en ont aucune : la liste vide est la NORME, pas `null`.
 *  • `weightLocked` est un BOOLÉEN, pas la chaîne `'true'` d'avant Postgres.
 *    Comparer à `'true'` rendait le verrou invisible et effaçait la charge des
 *    997 lignes verrouillées à chaque copie de semaine.
 *  • `weight` est une CHAÎNE : un coach écrit « 47,5 » ou « PDC ».
 *  • `repsUnit` et `incrementUnit` admettent la chaîne VIDE en plus de leur
 *    vocabulaire — la colonne est contrainte mais nullable, et 3 157 lignes sont
 *    dans ce cas. Le type écrit à la main l'ignorait : il mentait sur un tiers
 *    des lignes.
 *  • `kind` vaut `null` pour « entraînement », jamais `''` : le contrat d'écriture
 *    REJETTE la chaîne vide, et un `kind: ''` faisait tomber la semaine en 422. */
/** ⚠️ PLUS DE `ChampsDeCalcul` (26/08). Le front portait ici un `incrementRef`
 *  que brokkr n'a jamais persisté : une référence de calcul pour l'incrément en
 *  pourcentage, semée par l'éditeur et perdue au premier rechargement. Le calcul
 *  ayant rejoint le serveur, le pourcentage porte désormais sur la Table RM lue
 *  en base — il n'y a plus de référence à transporter, ni d'écran à qui la
 *  demander. Une ligne d'exercice est exactement ce que le contrat en dit. */
export type Exercise = components['schemas']['LigneDeSeance'];

export type Session = components['schemas']['SeanceLue'];

/** ⚠️ `athlete` EST UN INSTANTANÉ DATÉ, pas la fiche courante : poids et taille
 *  sont ceux de CETTE semaine-là. Il se lit `Week['athlete']` — le nommer à
 *  part n'ajoutait qu'un alias que personne n'écrivait. */
export type Week = components['schemas']['SemaineLue'];

/** Une case du tableau des records — calculée par brokkr (FRE-71 §9).
 *
 *  ⚠️ PAS `Record` TOUT COURT : c'est l'utilitaire natif de TypeScript, et le
 *  masquer casse `Record<string, …>` partout ailleurs dans ce fichier. Le
 *  compilateur l'a signalé tout de suite — mais un nom qui compile n'est pas
 *  forcément un nom libre. */
export type RecordDeForce = components['schemas']['RecordLu'];

export type BlockObjective = components['schemas']['ObjectifDeBloc'];

export type DayTiers = components['schemas']['JourDeLaGrille'];

/** Un PRINCIPE de la trame : porte un `tier`, et PAS de jour — sa place dans la
 *  semaine vient de la grille du bloc (`daySplit`), pas d'une date. */
export type Principle = components['schemas']['PrincipeDeBase'];

/** Un ACCESSOIRE de la trame : porte un `day` et un `groupId`, et PAS de tier.
 *
 *  ⚠️ CETTE ASYMÉTRIE EST UNE RÈGLE MÉTIER, pas un oubli (FRE-31). `groupId` lie
 *  deux accessoires en bi-set et n'existe QUE sur eux — vérifié sur les 84
 *  groupes réels, aucun ne porte de ligne à tier. L'ajouter aux principes par
 *  symétrie les exposerait au retri par mouvement puis par tier (FRE-29), qui
 *  séparerait deux lignes liées. */
export type BaseAccessory = components['schemas']['AccessoireDeBase'];

/** La TRAME d'un bloc : ce qui engendre les semaines.
 *
 *  ⚠️ `selectedPrincipaux` est LE SEUL champ de l'arbre où `null` et `[]` ne
 *  disent pas la même chose. `null` = le coach n'a jamais configuré sa sélection
 *  (48 BASE sur 111), et le front retombe alors sur l'ordre canonique de la
 *  bibliothèque ; `[]` = il a retiré les mouvements un par un, geste délibéré.
 *  Les avoir aplatis ensemble avait vidé l'éditeur de BASE de ses cinq sections. */
export type BlockBase = components['schemas']['BaseDuBloc'];

export type Block = components['schemas']['BlocLu'];

export type Macrocycle = components['schemas']['MacroLu'];

export type TrainingResponse = { macros: Macrocycle[] };

/** Un point de la courbe de forme — servi par brokkr depuis FRE-119.
 *  La règle de date (repli sur le début de semaine) vit dans la requête. */
export type PointForme = components['schemas']['PointDeForme'];

/* ── LA CHARPENTE ─────────────────────────────────────────────────────────────
 *
 * ⚠️ UNE SECONDE FORME DE L'ARBRE, PLUS LÉGÈRE (FRE-119), et pas un doublon par
 * négligence. `GET /training` rend l'arbre ENTIER — mesuré le 02/09 sur les 67
 * programmes réels : 512 Ko pour le plus fourni, 104 Ko en médian, et ça grossit
 * d'une semaine par semaine. Le calendrier n'en lit que la frise : 10 Ko.
 *
 * Les deux types viennent du MÊME contrat généré, donc ils ne peuvent pas
 * diverger en silence : un champ retiré côté brokkr fait rougir la compilation
 * des deux côtés.
 */
export type SemaineDeStructure = components['schemas']['SemaineDeStructure'];

/** LE CONTENU d'un bloc — ce qu'il faut AJOUTER à la charpente pour l'éditer.
 *  Il ne redit aucun champ de la charpente : les deux lectures se recollent par
 *  identifiant de semaine, et une valeur n'a jamais deux sources. */
export type ContenuDeBloc = components['schemas']['ContenuDeBloc'];

export type BlocDeStructure = components['schemas']['BlocDeStructure'];

export type MacroDeStructure = components['schemas']['MacroDeStructure'];

/* ── BROUILLON ────────────────────────────────────────────────────────────── */

/** Ce que l'éditeur assemble AVANT d'enregistrer.
 *
 *  ⚠️ `id` ABSENT EST LA DIFFÉRENCE ESSENTIELLE, et elle porte du sens : une
 *  ligne sans id n'existe que dans le navigateur. C'est ce qui distingue un ajout
 *  d'une modification au moment d'écrire, et c'est pourquoi le brouillon ne peut
 *  pas être le type de lecture avec un `?` de plus — l'absence signifie quelque
 *  chose ici, alors qu'elle n'arrive jamais là. */
export type ExerciseDraft = Partial<Exercise> & Pick<Exercise, 'name'>;
export type PrincipleDraft = Partial<Principle> & Pick<Principle, 'name' | 'tier'>;
export type AccessoryDraft = Partial<BaseAccessory> & Pick<BaseAccessory, 'name' | 'day'>;

export type SessionDraft = Omit<Partial<Session>, 'exercises'> & {
  name: string;
  exercises: ExerciseDraft[];
};

export type WeekDraft = Omit<Partial<Week>, 'sessions'> & {
  weekNumber: number;
  sessions: SessionDraft[];
};

/** Un objectif de bloc pas encore enregistré — même règle que la ligne : seul
 *  `id` manque, et c'est lui qui dit « pas encore en base ». */
export type ObjectiveDraft = Partial<BlockObjective>;

/* ── L'ARBRE EN COURS D'ÉDITION ───────────────────────────────────────────── */

/** ⚠️ IDENTIQUE À LA LECTURE, À UNE SEULE CHOSE PRÈS : l'identité peut être EN
 *  ATTENTE. Tout le reste est là, exactement comme le serveur l'envoie.
 *
 *  C'est la réponse précise à la question « pourquoi l'éditeur ne peut-il pas se
 *  contenter des types de lecture ? ». Quand le coach ajoute une ligne, elle
 *  s'affiche AVANT que le `POST` ne réponde — c'est délibéré, attendre l'aller-
 *  retour pour dessiner une ligne vide se verrait. Pendant ces quelques centaines
 *  de millisecondes, elle existe sans id.
 *
 *  La tentation était de tout passer en `Partial`, et c'est ce que faisait le
 *  contrat écrit à la main : `sessions?`, `athlete?`, `weight?`. Le prix en était
 *  payé à l'affichage, qui devait se défendre d'absences n'arrivant jamais. Ici
 *  UN SEUL champ s'élargit, et il dit quelque chose de vrai : « pas encore
 *  enregistré ». C'est aussi ce que `schedulePatch` teste avant d'écrire — sans
 *  id, il ne fait rien, ce qui est exactement ce qu'il faut. */
export type ExerciseEditing = Omit<Exercise, 'id'> & { id?: string };

export type SessionEditing = Omit<Session, 'id' | 'exercises'> & {
  id?: string;
  exercises: ExerciseEditing[];
};

/** ⚠️ `id` OPTIONNEL AUX TROIS NIVEAUX, et pas seulement sur la ligne : une
 *  semaine fabriquée par `buildNextWeek` ou `createEmptyWeek` n'a pas encore la
 *  sienne non plus. Elle l'obtient au `POST`, et `adopterLesIds` la recolle. */
export type WeekEditing = Omit<Week, 'id' | 'sessions'> & {
  id?: string;
  /** ⚠️ ABSENT ≠ VIDE, et c'est tout le découpage de FRE-119 qui tient là.
   *
   *  Depuis que le contenu se charge PAR BLOC, une semaine d'un bloc qu'on n'a
   *  pas ouvert n'a pas de séances À CONNAÎTRE — elle en a peut-être douze. Lui
   *  donner `[]` par commodité dirait « aucune séance », ce qui est faux, et
   *  c'est précisément le défaut que ce projet répète le plus : `''` et NULL, ou
   *  ici `[]` et `undefined`, confondus à une frontière.
   *
   *  Le compilateur oblige donc chaque lecture à trancher. `?? []` reste juste
   *  partout où l'on affiche le bloc COURANT — il est chargé — et devient une
   *  question ailleurs. */
  sessions?: SessionEditing[];
};
/** ⚠️ `base` OPTIONNELLE POUR LA MÊME RAISON QUE `sessions` : depuis FRE-119,
 *  la trame d'un bloc n'arrive qu'avec son contenu. Absente veut dire « bloc
 *  non ouvert », jamais « trame vide » — et la nuance a déjà coûté cher ici : le
 *  jour où `null` et `[]` ont été aplatis sur `selectedPrincipaux`, l'éditeur de
 *  BASE a perdu ses cinq sections (17/08). */
export type BlockEditing = Omit<Block, 'weeks' | 'base'> & {
  base?: BlockBase;
  weeks: WeekEditing[];
};
export type MacrocycleEditing = Omit<Macrocycle, 'blocks'> & { blocks: BlockEditing[] };


/* ── CORPS D'ÉCRITURE DE L'ARBRE (FRE-144) ─────────────────────────────────
 *
 * ⚠️ TROISIÈME FAMILLE, ET ELLE N'EST NI LA LECTURE NI LE BROUILLON. Un
 * brouillon décrit ce que l'ÉCRAN assemble ; ceux-ci décrivent ce que brokkr
 * ACCEPTE — et les deux ne coïncident pas, parce que le serveur est en
 * `extra="forbid"` partout et refuse la requête ENTIÈRE sur un champ de trop.
 *
 * ⚠️ ET ILS SONT PLUS ÉTROITS QUE LA LECTURE SUR QUATRE CHAMPS. `repsUnit`,
 * `incrementUnit` et `groupKind` admettent la chaîne VIDE en lecture (c'est ce
 * que portent des milliers de lignes en base) et la REFUSENT en écriture, où
 * l'absence se dit `null` ; `tier` est un entier quelconque en lecture, mais
 * `1 | 2 | 3` à l'écriture. Renvoyer tel quel ce qu'on vient de lire est donc
 * un 422 en puissance — la forme exacte du défaut de FRE-92. */
export type ExerciseLineCreate = components['schemas']['ExerciseLineCreate'];
export type SessionCreate = components['schemas']['SessionCreate'];
export type MacroCreate = components['schemas']['MacroCreate'];
export type BlockCreate = components['schemas']['BlockCreate'];

/** Les corps des `PATCH` de méta — un par niveau, et ils ne se ressemblent pas :
 *  `hidden` n'existe que sur la semaine, `trainingFrequency` que sur le macro. */
export type MacroPatch = components['schemas']['MacroPatch'];
export type BlockPatch = components['schemas']['BlockPatch'];
export type WeekPatch = components['schemas']['WeekPatch'];

/** Les corps des `PUT .../order` — deux noms de champ pour un même geste,
 *  `ids` pour les séances et `exerciseIds` pour les lignes. Les confondre
 *  produisait un 422 que rien dans le front ne pouvait signaler. */
export type SessionOrder = components['schemas']['Order'];
export type ExerciseOrder = components['schemas']['ExerciseOrder'];
export type ExerciseMove = components['schemas']['ExerciseMove'];

/** Le corps du `PUT /blocks/{id}/base` — la trame ET la re-datation des
 *  semaines, en UNE écriture atomique. */
export type BaseReplace = components['schemas']['BaseReplace'];

/** Le corps du `POST /blocks/{id}/base/preview-week` — l'aperçu ne persiste
 *  rien, mais il passe par le même modèle de trame. */
export type BasePreview = components['schemas']['BasePreview'];

/** Le corps du `PUT /blocks/{id}/objectives` — remplacement complet.
 *
 *  ⚠️ `ObjectiveIn` N'A PAS D'`id`, ET LE TYPE NE SUFFIT PAS À LE GARANTIR.
 *  `BlockObjective` en porte un ; le retirer reste un geste D'EXÉCUTION (le
 *  `.map(({id, ...rest}) => rest)` de `training-editor`), parce que TypeScript
 *  ne signale un champ en trop que sur un littéral FRAIS — jamais sur une valeur
 *  qui transite par une variable. Pydantic, lui, refuse la requête entière. */
export type ObjectivesReplace = components['schemas']['ObjectivesReplace'];
export type ObjectifsRemplaces = components['schemas']['ObjectifsRemplaces'];

/* ── RÉPONSES D'ÉCRITURE ──────────────────────────────────────────────────── */

/** L'arbre des identités qu'une création vient de frapper.
 *
 *  ⚠️ CE N'EST PAS UN ACCUSÉ DE RÉCEPTION, C'EST CE QUI REND L'ÉDITION POSSIBLE.
 *  Les objets viennent d'être dessinés à l'écran sans identité ; sans ces ids,
 *  `schedulePatch` ne sait rien persister, et chaque frappe est perdue jusqu'au
 *  prochain rechargement — en silence.
 *
 *  ⚠️ ET LA LISTE `exercises` GARDE SES TROUS : elle a la même longueur que celle
 *  envoyée, avec `null` là où le serveur a écarté une ligne sans nom. Les
 *  compacter ferait glisser l'identité d'une ligne sur sa voisine, et le coach
 *  taperait dans un exercice en écrivant dans un autre. */
export type IdsSemaine = components['schemas']['IdsCrees'];

/** `POST /athletes/link` — `linked: false` est un SUCCÈS : il dit « aucune fiche
 *  ne porte cette adresse », le cas d'un utilisateur qui n'est pas athlète. */
export type LiaisonAthlete = components['schemas']['LiaisonAthlete'];

/* ⚠️ QUATRE TYPES ONT DISPARU D'ICI : `WeekContentPatch`, `WeekMetaPatch`,
 * `BlockBasePatch` et `CreatedIds`. Ils décrivaient les payloads et les réponses
 * des routes documentaires `/programs/{p}/macrocycles/{m}/blocks/…`, supprimées de
 * brokkr avec la bascule Postgres (FRE-12), et n'étaient plus lus que par douze
 * hooks que personne n'appelait — retirés en même temps.
 *
 * Les écritures de l'arbre passent par `lib/training-editor.ts`, au grain de la
 * ligne et de l'objet. Leurs réponses sont décrites plus bas, côté serveur. */

/* ----------------------------------------------------------------------------
 * Daily logs — GET/PATCH /athletes/{id}/daily-logs
 * ------------------------------------------------------------------------- */

/** Une journée du journal quotidien.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type DailyLogEntry = components['schemas']['JourneeLue'];

/** Le corps du `PATCH /athletes/{id}/daily-logs/{date}` — fusion des seuls
 *  champs fournis.
 *
 *  ⚠️ IL SE TROUVE IDENTIQUE À LA LECTURE, ET CE N'EST PAS UNE RAISON DE LES
 *  CONFONDRE (c'est ce que faisait `usePatchDailyLog`). Rien ne lie les deux
 *  modèles côté serveur : le jour où la lecture gagnera un champ calculé, elle
 *  le gagnera SEULE, et le front l'enverrait à un `extra="forbid"`. */
export type DailyLogPatch = components['schemas']['DailyLogPatch'];

/** Une ligne du tableau des signalements : QUI, QUAND, et ce qui a été rapporté.
 *
 *  ⚠️ PREMIER TYPE GÉNÉRÉ, ET PAS RECOPIÉ (FRE-70). Il vient de l'OpenAPI de
 *  brokkr via `npm run types:brokkr` — c'est-à-dire du `response_model` de la
 *  route, pas de ma lecture de son `return`. Le premier d'une longue série :
 *  tout ce fichier dérive aujourd'hui de `brokkr.gen.ts`, par alias direct ou
 *  par `Omit` / `Exclude` / `NonNullable` / `Partial`. QUATRE EXCEPTIONS, et
 *  chacune est motivée sur place : `TrainingResponse` et `DailyLogs`, qui
 *  n'enveloppent qu'un type engendré ; `CompetitionInput` et `CompetitionPatch`,
 *  volontairement plus stricts que le contrat serveur.
 *
 *  Ce que ça change concrètement : si brokkr renomme un champ, `npm run
 *  types:brokkr` fait ROUGIR le build au lieu de laisser l'écran afficher
 *  `undefined`. C'est exactement ce qui manquait quand ce type a été écrit à la
 *  main, le 18/08 au matin. */
export type Signalement = components['schemas']['Signalement'];

/** LE GUICHET DU COACH (12/09) — la file de travail, en une réponse, dans
 *  l'ordre où elle se traite. Le discriminant est `type`. */
export type Guichet = components['schemas']['Guichet'];
export type DossierDuGuichet = Guichet['dossiers'][number];
export type DossierSeance = components['schemas']['DossierSeance'];
export type DossierDouleur = components['schemas']['DossierDouleur'];
export type DossierSemaine = components['schemas']['DossierSemaine'];

/** GET → Record<date ISO, entrée>. */
export type DailyLogs = Record<string, DailyLogEntry>;

/* ----------------------------------------------------------------------------
 * Events calendrier — GET/PUT/PATCH/DELETE /athletes/{id}/events
 * ------------------------------------------------------------------------- */

/** Dérivé du contrat : une phase ajoutée côté serveur arrive ici toute seule.
 *  Lue sur la JOURNÉE, seul endroit qui porte une phase depuis que le calendrier
 *  n'en a plus (FRE-173, puis le 13/09). `NonNullable` parce qu'un jour peut ne
 *  pas en déclarer — ce type nomme le vocabulaire, pas l'absence. */
export type CyclePhase = NonNullable<DailyLogEntry['cycle']>;

/** Un événement du calendrier de l'athlète.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type CalendarEvent = components['schemas']['EvenementLu'];

/** ⚠️ ALIAS DU MODÈLE D'ÉCRITURE, PLUS UN `Omit` SUR LA LECTURE (FRE-144). Les
 *  deux formes coïncident aujourd'hui au champ près — mais la première est
 *  RATTACHÉE au contrat, tandis que la seconde ne faisait que lui ressembler. */
export type CalendarEventInput = components['schemas']['EventCreate'];

/** Le corps du `PATCH /athletes/{id}/events/{id}` — chaque champ y admet `null`
 *  en plus de son type, ce que `Partial<CalendarEventInput>` ne dit pas. */
export type EventPatch = components['schemas']['EventPatch'];

/* ----------------------------------------------------------------------------
 * Objectifs — GET/PUT /athletes/{id}/goals (remplacement complet)
 * ------------------------------------------------------------------------- */

/** Un objectif d'athlète.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type Goal = components['schemas']['ObjectifLu'];

/** Le corps du `PUT /athletes/{id}/goals` — la liste ENTIÈRE, enveloppée, et la
 *  VERSION qu'on croit remplacer (FRE-134). */
export type GoalsReplace = components['schemas']['GoalsReplace'];

/** Ce que rend `GET /athletes/{id}/goals` : la liste et sa version.
 *
 *  ⚠️ CE N'EST PLUS UN TABLEAU NU. La version doit voyager avec ce qu'elle date,
 *  et la faire passer par un en-tête `ETag` l'aurait sortie de l'OpenAPI — donc
 *  du type, donc de `tsc`. Ici, oublier de la renvoyer ne compile pas. */
export type GoalsLus = components['schemas']['ObjectifsLus'];

/* ----------------------------------------------------------------------------
 * Records manuels — GET/POST /athletes/{id}/prs, DELETE /prs/{id}
 * ------------------------------------------------------------------------- */

/** Un record saisi à la main.
 *
 *  ⚠️ `sets` est une CHAÎNE et non un nombre — la colonne est `text`, un contexte
 *  pouvant être « 4 » comme « 4x4 ». Ce type le déclarait `number | null` tant
 *  qu'il était écrit à la main : le contrat mentait, personne ne pouvait le voir.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type ManualPr = components['schemas']['PrLu'];

/** Le corps du `POST /athletes/{id}/prs`. */
export type PrInput = components['schemas']['PrCreate'];

/* ----------------------------------------------------------------------------
 * Bibliothèque — GET /library, POST /library/entries, PATCH /library/entries/{id}
 * Modèle unifié : tout partagé, unique par (catégorie, nom).
 * ------------------------------------------------------------------------- */

/** GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`.
 *
 *  ⚠️ `competition` et `supports` sont OMIS, pas nuls : le serveur ne pose le
 *  premier que sur un exercice (la base l'impose) et le second que s'il y en a
 *  — 26 exercices sur 106. C'est ce que dit `response_model_exclude_unset`. */
export type LibraryEntry = components['schemas']['EntreeDeBibliotheque'];

/** Le corps du `PATCH /library/entries/{id}`.
 *
 *  ⚠️ PAS DE `LibraryEntryCreate` ICI, ET C'EST UN CONSTAT (FRE-144). Le modèle
 *  existe, mais `openapi-typescript` rend OBLIGATOIRE tout champ portant un
 *  défaut serveur — vrai d'une réponse, faux d'un corps de requête. Le
 *  `competition` de la création tombe dans ce cas, et le front l'omet
 *  délibérément hors de la catégorie « exercices ». Le poser quand même aurait
 *  été élargir le type ou changer ce qui part sur le fil. */
export type LibraryEntryPatch = components['schemas']['LibraryEntryPatch'];

/** Les cinq catégories, TOUJOURS présentes, même vides — le front lit
 *  `library.tempos` sans le tester. */
export type Library = components['schemas']['BibliothequeLue'];

export type LibraryCategory = keyof Library;

/* ----------------------------------------------------------------------------
 * Compétitions — GET /competitions, PUT/PATCH/DELETE /competitions/{id}
 * ------------------------------------------------------------------------- */

/** ⚠️ LA FORME EST CELLE D'UN DOCUMENT FIRESTORE, encore. Les compétitions ont
 *  été basculées en Postgres puis RECOMPOSÉES à l'identique pour ne pas casser le
 *  front : `date` doublonne `startDate`, `editorEmails` vaut toujours `[]`. Ces
 *  deux-là ne servent plus à rien et restent parce que les retirer changerait ce
 *  qui circule.
 *
 *  ⚠️ ET `competesOn` COMME `score` SONT TOUJOURS RENDUS, à la différence de
 *  `uid`, `bodyweight`, `gender` et `weightCategory`, qui disparaissent quand ils
 *  ne sont pas renseignés. Ce contrat les marquait tous les six optionnels : il
 *  mentait sur les deux premiers, que le front lit pour le J−x du tableau de bord
 *  et pour le classement. */
export type Competition = components['schemas']['CompetitionLue'];
export type CompParticipant = components['schemas']['ParticipantLu'];
/** Un flight à l'écriture : un nom et ses catégories (FRE-204). Sa place dans la
 *  liste est son ordre de passage. La forme lue est la même. */
export type Flight = components['schemas']['Flight'];
export type CompMovement = components['schemas']['MouvementLu'];
export type CompAttempt = components['schemas']['EssaiLu'];

export type AttemptTier = NonNullable<CompAttempt['selectedTier']>;
/** `''` fait partie du vocabulaire : c'est « pas encore tenté », et c'est le cas
 *  MAJORITAIRE — 168 essais sur 264 en production. */
export type AttemptResult = CompAttempt['result'];

/** PUT (create-or-replace) — les champs dérivés serveur sont refusés en entrée.
 *
 *  ⚠️ ÉCRIT À LA MAIN VOLONTAIREMENT, et c'est le seul payload dans ce cas. Ce
 *  n'est PAS un miroir oublié : `CompetitionCreate` côté brokkr est délibérément
 *  permissif — `startDate`, `endDate`, `movementNames` et `participants` y sont
 *  tous optionnels, pour accepter les corps partiels d'anciens clients. Le
 *  brancher ÉLARGIRAIT donc le front, qui exige ces champs parce que son écran
 *  les exige.
 *
 *  Une restriction locale plus stricte que le serveur est sûre — elle décrit un
 *  sous-ensemble de ce qu'il accepte. L'inverse ne le serait pas. Le type
 *  d'élément, lui, vient bien du contrat (`CompParticipant`). */
export interface CompetitionInput {
  name: string;
  startDate: string;
  endDate: string;
  location?: string;
  maxAttempts: number;
  movementNames: string[];
  // ⚠️ LES CHAMPS DÉRIVÉS SONT OMIS : le serveur les recalcule à chaque
  // écriture, les envoyer n'aurait aucun effet — et laisserait croire qu'on
  // peut les fixer. `ris` et `risTotal` rejoignent `score` pour la même raison
  // (FRE-92).
  participants: Omit<CompParticipant, 'score' | 'ris' | 'risTotal' | 'projection' | 'flight'>[];
  flights?: Flight[];
}

export type CompetitionPatch = Partial<CompetitionInput>;

/** La réponse du `PATCH /competitions/{id}` : ce qui a été écrit, et la NOUVELLE
 *  version à présenter à l'écriture suivante (FRE-162). */
export type CompetitionEcrite = components['schemas']['CompetitionEcrite'];

/** Le corps du `PUT /competitions/{id}` TEL QUE LE CONTRAT L'ACCEPTE.
 *
 *  ⚠️ IL NE REMPLACE PAS `CompetitionInput`, IL LE CONFRONTE. Le second est
 *  volontairement plus strict (cf. ci-dessus) ; le poser en type de corps fait
 *  vérifier au compilateur que la restriction locale reste un SOUS-ENSEMBLE de
 *  ce que brokkr accepte — ce que personne ne pouvait établir tant que le corps
 *  partait en `unknown`. C'est aussi ce qui rattache la liste d'exclusions tenue
 *  à la main (`score`, `ris`, `risTotal`) au `Participant` engendré.
 *
 *  ⚠️ ET SON JUMEAU DU `PATCH` N'EST PAS ATTEIGNABLE : le contrat l'appelle
 *  `CompetitionPatch`, nom que ce fichier porte DÉJÀ pour sa version stricte.
 *  Le corps du PATCH est donc typé par la version locale, faute de pouvoir
 *  nommer les deux. */
export type CompetitionCreate = components['schemas']['CompetitionCreate'];

/** Le corps du `PUT /competitions/{id}/availability` — une case de la matrice. */
export type CoachAvailabilityPut = components['schemas']['CoachAvailabilityPut'];

/** Disponibilité d'un coach sur UN jour d'une compétition.
 *
 *  `pending` est une VALEUR, pas une absence : c'est l'état qui dit qui reste
 *  à relancer. Le GET renvoie la matrice complète coach × jour, donc aucune
 *  lecture n'a à interpréter un trou. */
/** ⚠️ `coachName` N'EST JAMAIS NUL : le SQL le résout en cascade — nom affiché,
 *  à défaut l'email, à défaut l'uid. Rien à défendre à l'affichage. */
export type CoachAvailability = components['schemas']['LigneDeMatrice'];

export type CoachAvailabilityStatus = CoachAvailability['status'];

/** GET /competitions/coach-availability?coachUid=… → ce qu'UN coach a déclaré,
 *  toutes compétitions confondues (FRE-25).
 *
 *  Le coach est un paramètre et non le porteur du jeton : un calendrier décrit
 *  l'athlète qu'on REGARDE, jamais celui qui regarde.
 *
 *  Pas de matrice complétée ici, contrairement au GET par compétition : seules
 *  les lignes réellement déclarées sortent, « il n'a rien dit » étant une
 *  absence. Le statut est fourni pour que l'appelant décide — le calendrier ne
 *  retient que les `available`. */
export type CoachCompetitionAvailability = components['schemas']['DispoDeCoach'];

/** GET /weight-categories → { M: ['-66', …], F: ['-52', …] }
 *
 *  ⚠️ LES DEUX CLÉS SONT TOUJOURS LÀ, éventuellement vides : la route les force.
 *  Le modèle serveur leur donnait un défaut, ce qui les rendait OPTIONNELLES dans
 *  le contrat généré — il promettait donc moins que ce que la route garantit. */
export type WeightCategories = components['schemas']['CategoriesDePoids'];

/** Ce qu'une suppression d'arbre détruirait de RÉALISÉ (FRE-130).
 *
 *  ⚠️ CE N'EST PAS UN VERROU : la suppression reste permise, c'est un geste
 *  légitime de réajustement. Ce compte remplit la PHRASE du dialogue, qui disait
 *  la même chose d'une semaine vierge et d'une semaine où l'athlète a saisi
 *  douze séances.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type ContenuRealise = components['schemas']['ContenuRealise'];

/* ----------------------------------------------------------------------------
 * Tracking — GET /athletes/{id}/tracking?exercise=…
 * ------------------------------------------------------------------------- */

/** Une semaine pour le mouvement choisi.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type TrackingWeek = components['schemas']['SemaineDeSuivi'];

/** Une semaine, tous mouvements confondus.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type TrackingAthleteWeek = components['schemas']['SemaineAthlete'];

/** Le calibrage RPE d'un bloc.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type TrackingRpeBlock = components['schemas']['BlocRPE'];

/** Les séries d'UN lift de compétition sur UNE semaine — faites et prescrites.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type TrackingSetsByMovement = components['schemas']['SeriesDeMouvement'];

/** Le suivi de progression, dans son ensemble.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type TrackingResponse = components['schemas']['SuiviLu'];

/* ---- Profil PUBLIC d'un coach (FRE-30) ----
 *
 *  Servi tel quel au site vitrine par une route SANS authentification. Tout ce
 *  qui figure ici est public par construction : ne rien y ajouter qui ne soit
 *  destiné à être lu par n'importe qui. */
/** Le profil public d'un coach.
 *
 *  GÉNÉRÉ depuis l'OpenAPI de brokkr — `npm run types:brokkr`. */
export type CoachProfile = components['schemas']['ProfilCoachLu'];

/** Ce que le coach peut ÉCRIRE. Ni `photoUrl` (posée par l'upload) ni `oneRm`
 *  (projection nocturne) : les proposer serait promettre une écriture que
 *  brokkr refuse. Le `slug` n'est accepté qu'à la création, et immuable après. */
/** Le corps du `PATCH /coach-profiles/me`. */
export type CoachProfilePatch = components['schemas']['CoachProfilePatch'];

/* ----------------------------------------------------------------------------
 * Bilans — les MODÈLES que la kiné compose, et les INSTANCES qu'un athlète passe.
 *
 * ⚠️ SEUL DOMAINE DONT LE COACH EST EXCLU (brokkr/docs/bilan-kine.md §8) : un
 * bilan porte des antécédents et des pathologies, qui ne sont pas de la donnée
 * d'entraînement. Côté serveur c'est le mode `owner_or_kine` qui le tient — le
 * front n'a pas à le redire, mais il ne doit pas proposer l'écran à un coach.
 * La composition, elle, est réservée à la kiné (`require_kine`).
 * ------------------------------------------------------------------------- */

/** Un test D'UN MODÈLE — ce que la kiné édite. */
export type BilanTest = components['schemas']['TestLu'];
export type BilanTestCree = components['schemas']['TestCree'];
export type BilanTestPatch = components['schemas']['TestPatch'];

export type BilanRubrique = components['schemas']['RubriqueLue'];
export type BilanRubriqueCree = components['schemas']['RubriqueCree'];
export type BilanRubriquePatch = components['schemas']['RubriquePatch'];

export type BilanModeleResume = components['schemas']['ModeleResume'];
export type BilanModele = components['schemas']['ModeleLu'];
export type BilanModeleCree = components['schemas']['ModeleCree'];
export type BilanModelePatch = components['schemas']['ModelePatch'];
export type BilanModelesDisponibles = components['schemas']['ModelesDisponibles'];

/** Une ligne de la liste — SANS les antécédents, volontairement : le périmètre
 *  médical se garde étroit jusque dans les charges utiles. */
export type BilanResume = components['schemas']['BilanResume'];

/** Un bilan complet, résultats inclus. */
export type Bilan = components['schemas']['BilanLu'];

/** Un résultat, AVEC SON INSTANTANÉ — `testLibelle`, `mesure`, `bilateral` et
 *  `chargeKg` sont figés au remplissage (spec §3.1), pas relus du modèle.
 *
 *  ⚠️ L'ÉCRAN SE FIE À CET INSTANTANÉ, JAMAIS AU MODÈLE COURANT. C'est ce qui
 *  permet à la kiné de retoucher ses tests sans réécrire l'affichage des bilans
 *  déjà passés. Corollaire pratique : la vue n'a plus à joindre un référentiel,
 *  chaque résultat se suffit.
 *
 *  ⚠️ `mesureGauche: 0` ET `mesureGauche: null` NE SONT PAS LA MÊME CHOSE.
 *  `null` = test NON réalisé (matériel absent, douleur qui l'empêche) ; `0` =
 *  réalisé, échec complet. L'affichage doit les distinguer — un « — » et un
 *  « 0 » — sinon un test sauté creuse la courbe comme une régression. */
export type BilanResultat = components['schemas']['ResultatLu'];

export type BilanResultatEcrit = components['schemas']['ResultatEcrit'];
export type BilanCree = components['schemas']['BilanCree'];
export type BilanPatch = components['schemas']['BilanPatch'];

/** Une note de suivi du kiné (FRE-102) — hors bilan, au fil de l'eau.
 *
 *  ⚠️ DONNÉE DE SANTÉ AU PÉRIMÈTRE LE PLUS ÉTROIT DU PRODUIT : lisible du KINÉ
 *  DE CET ATHLÈTE SEUL. Ni le coach, ni l'athlète lui-même — contrairement aux
 *  bilans, qui lui sont ouverts parce qu'il les remplit. */
/** UN OBJECTIF TECHNIQUE PAR MOUVEMENT (FRE-122) — « garde les coudes hauts ».
 *
 *  ⚠️ `closLe` EST UNE DATE OU `null`, pas un booléen : « atteint » sans savoir
 *  quand ne raconte rien, et c'est la chronologie qui fait la valeur d'un
 *  journal. L'écran teste donc `closLe === null` pour « encore en travail ».
 *
 *  ⚠️ À NE PAS CONFONDRE avec `coachNote`, qui est une note sur UNE ligne d'UNE
 *  séance. Elle est ponctuelle et ne suit pas le mouvement. */
export type ObjectifTechnique = components['schemas']['ObjectifTechniqueLu'];

/** Les corps du `POST` et du `PATCH` d'un objectif technique.
 *
 *  ⚠️ LE MOUVEMENT NE SE CORRIGE PAS. Il est posé à la création et absent du
 *  modèle de retouche : un objectif ne change pas de mouvement, il se clôt. */
export type ObjectifTechniqueEcrit = components['schemas']['ObjectifTechniqueEcrit'];
export type ObjectifTechniqueCorrige = components['schemas']['ObjectifTechniqueCorrige'];

export type NoteKine = components['schemas']['NoteLue'];
export type NoteKineEcrite = components['schemas']['NoteEcrite'];

/** Un média de démonstration du bilan kiné (FRE-99) — le mouvement montré.
 *
 *  ⚠️ `url` EST SIGNÉE ET EXPIRE (quelques heures) : le seau est privé. Elle peut
 *  aussi valoir `null` — sans stockage configuré, ou le jour où la clé expirera
 *  (FRE-104), le catalogue répond quand même, sans les vignettes. Le front doit
 *  donc gérer l'absence : c'est un cas réel, pas une précaution théorique. */
export type MediaDemo = components['schemas']['MediaDemoLu'];

/** LES DOULEURS SUIVIES (FRE-195) — une douleur qui dure, et ses relevés.
 *
 *  ⚠️ `zone` EST UN CODE, PAS UN LIBELLÉ : `deltoids:gauche`. Le front le
 *  fabrique en touchant la figure (`lib/anatomie/zones.ts`), et le côté est
 *  celui DE L'ATHLÈTE — jamais celui de l'écran.
 *
 *  ⚠️ `recurrente` VIENT DU SERVEUR ET SE DÉDUIT du nombre de logs. Le
 *  recalculer ici ferait une seconde définition de « ça revient », et les deux
 *  divergeraient le jour où la règle bouge. */
export type Douleur = components['schemas']['DouleurLue'];
export type DouleurDeclaree = components['schemas']['DouleurCreee'];
export type DouleurModifiee = components['schemas']['DouleurModifiee'];
export type LogDeDouleur = components['schemas']['LogDouleur'];
/** Un relevé LU — ce que l'historique d'une douleur rend (FRE-197). */
export type LogLu = components['schemas']['LogLu'];
