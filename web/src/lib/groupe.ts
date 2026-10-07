import type { ExerciseEditing, SessionEditing } from '@/api/types';
import i18n from '@/i18n';
import { parseSeconds } from '@/lib/time';

/** Regroupement des exercices liés (FRE-31).
 *
 *  UN SEUL ENDROIT décrit ce qu'est un groupe et ce qu'il porte. La règle était
 *  jusqu'ici recopiée dans trois rendus — tableau coach, Détail, Aperçu — sous
 *  forme de suppressions conditionnelles (« ne pas réafficher les séries si la
 *  ligne précédente a le même groupe »). Trois copies, donc trois occasions
 *  d'oublier : la barre de liaison manquait dans Détail, les valeurs y étaient
 *  répétées, et l'Aperçu a suivi avec un tour de retard.
 *
 *  Un bi-set, c'est A puis B, repos, le tout N fois. Les SÉRIES et le REPOS
 *  décrivent donc le tour et appartiennent au groupe ; les reps, la charge et le
 *  RPE restent propres à chaque exercice. */

/** La NATURE d'un groupe (FRE-36) : deux intentions, des règles OPPOSÉES.
 *
 *  Un BI-SET, c'est A puis B, repos, le tout N fois. Un DROPSET, c'est le même
 *  exercice enchaîné en descente — 30 reps puis 8 — sans aucun repos entre les
 *  descentes.
 *
 *  ⚠️ ELLE VIENT DU SERVEUR RÉSOLUE, jamais déduite ici. En base l'absence vaut
 *  « bi-set », mais connaître cette convention ferait porter au front une SECONDE
 *  définition de la notion — et deux définitions divergent toujours. Le front lit
 *  ce qu'on lui donne ; c'est brokkr qui décide. */
export type NatureDeGroupe = NonNullable<ExerciseEditing['groupKind']>;

/** Les natures, dans l'ordre où le coach les voit (FRE-116). Les enchaînements
 *  d'abord, la descente, puis les deux groupes CHRONOMÉTRÉS. */
export const NATURES_DE_GROUPE: readonly NatureDeGroupe[] =
  ['biset', 'circuit', 'dropset', 'emom', 'amrap'];

/** La nature d'un groupe, lue sur une de ses lignes.
 *
 *  ⚠️ LA SEULE LECTURE DE `groupKind` DANS LE FRONT (FRE-116). Dix endroits
 *  écrivaient `groupKind === 'dropset' ? 'dropset' : 'biset'` — juste tant qu'il
 *  n'existait que deux natures, et faux à la troisième : un EMOM y serait devenu
 *  un bi-set, dans l'aperçu, la recopie ou la BASE, selon l'endroit oublié.
 *
 *  Le repli sur « bi-set » ne déduit rien : hors d'un groupe, le serveur rend
 *  `null`, et les vues lisent la nature sans brancher (voir `grouperExercices`). */
export function natureDe(ligne: Pick<ExerciseEditing, 'groupKind'>): NatureDeGroupe {
  // ⚠️ `||` ET NON `??` : un brouillon ou un patch en attente d'avant FRE-137 peut
  // encore porter `''`, et `??` le laissait passer comme une nature. Vu rouge par
  // `groupe.test.ts` — le défaut le plus répété du projet, vide contre NULL.
  return ligne.groupKind || 'biset';
}

/** Un groupe dont le TEMPS appartient au groupe : l'intervalle d'un EMOM en
 *  rotation, la durée d'un AMRAP (FRE-116). Ses lignes n'ont plus de format. */
export function estChronometre(nature: NatureDeGroupe): boolean {
  return nature === 'emom' || nature === 'amrap';
}

/** Les séries se saisissent-elles ? Sur un AMRAP, non : le nombre de tours est le
 *  RÉSULTAT, pas une prescription. */
export function lesSeriesSeSaisissent(nature: NatureDeGroupe): boolean {
  return nature !== 'amrap';
}

export interface Groupe {
  /** `null` pour un exercice isolé — c'est le cas courant. */
  id: string | null;
  /** La nature du groupe, lue sur son premier membre : le serveur garantit
   *  qu'ils l'annoncent tous pareil (`normaliser_groupes`). */
  nature: NatureDeGroupe;
  exercices: { exercice: ExerciseEditing; index: number }[];
  /** Séries du tour, lues sur le premier membre : l'écriture les propage à tous.
   *
   *  ⚠️ `| null` DEPUIS FRE-137 : une prescription absente se dit maintenant
   *  comme une absence, jusqu'ici. Le `?? ''` se pose à l'affichage, pas dans ce
   *  type — qui décrit la donnée, pas l'écran. */
  sets: string | null;
  /** Repos APRÈS le tour. Entre les membres, il n'y en a pas — c'est la
   *  définition d'un bi-set, et c'est pourquoi il n'est plus saisi. */
  rest: string | null;
}

/** Un groupe ORPHELIN (identifiant resté sur une ligne dont le partenaire a été
 *  supprimé) ne dit rien : il est traité comme un exercice isolé. Le cas s'est
 *  produit en vrai — 5 lignes chez un athlète, nettoyées depuis. */
function estUnVraiGroupe(session: SessionEditing, gid: string): boolean {
  return session.exercises.filter(e => (e.groupId || '').trim() === gid).length > 1;
}

/** Découpe une séance en blocs consécutifs. Un exercice isolé donne un groupe
 *  d'un seul membre avec `id: null` — les vues traitent ainsi les deux cas sans
 *  brancher, ce qui évite précisément la divergence entre elles.
 *
 *  ⚠️ Les membres d'un groupe sont supposés CONSÉCUTIFS. C'est ce que produit
 *  l'app (on lie deux voisins), et intercaler un exercice étranger au milieu
 *  n'aurait aucun sens physique — on enchaînerait autre chose entre A et B. */
export function grouperExercices(session: SessionEditing): Groupe[] {
  const blocs: Groupe[] = [];

  session.exercises.forEach((exercice, index) => {
    const gid = (exercice.groupId || '').trim();
    const groupe = gid && estUnVraiGroupe(session, gid) ? gid : null;
    const dernier = blocs[blocs.length - 1];

    if (groupe && dernier?.id === groupe) {
      dernier.exercices.push({ exercice, index });
      return;
    }
    blocs.push({
      id: groupe,
      // ⚠️ « biset » PAR DÉFAUT ET NON `''` : un exercice isolé n'a pas de nature,
      // mais les vues lisent ce champ sans brancher — c'est tout l'intérêt de
      // traiter l'isolé comme un groupe d'un membre. Lui donner la nature qui ne
      // change RIEN à l'affichage évite un `?.` à chaque lecture.
      nature: groupe ? natureDe(exercice) : 'biset',
      exercices: [{ exercice, index }],
      sets: exercice.sets,
      rest: exercice.rest,
    });
  });

  return blocs;
}

/** Libellé du bloc : « BI-SET » à deux, « TRI-SET » à trois, puis le compte.
 *  Rien n'interdit d'en lier quatre, et « QUADRI-SET » n'est pas un mot qu'un
 *  coach utilise — au-delà de trois on annonce le nombre.
 *
 *  ⚠️ UN DROPSET NE COMPTE PAS SES MEMBRES. « BI-SET » dit deux exercices
 *  enchaînés ; un dropset, ce sont des DESCENTES du même exercice, et « 4 EXOS
 *  LIÉS » y décrirait une chose qui n'existe pas. Le nombre se lit sur les
 *  lignes, qui sont juste en dessous. */
export function libelleGroupe(taille: number, nature: NatureDeGroupe = 'biset'): string {
  if (nature === 'dropset') return i18n.t('session.groupeDropset');
  // Une nature NOMMÉE par le coach se dit telle quelle, quel que soit le compte.
  if (nature === 'circuit') return i18n.t('session.groupeCircuit');
  if (nature === 'emom') return i18n.t('session.groupeEmom');
  if (nature === 'amrap') return i18n.t('session.groupeAmrap');
  if (taille === 2) return i18n.t('session.groupeBiset');
  if (taille === 3) return i18n.t('session.groupeTriset');
  return i18n.t('session.groupeNExos', { n: taille });
}

/** Le repos se saisit-il sur ce groupe ? (FRE-36)
 *
 *  ⚠️ RÈGLE D'AFFORDANCE : le front ne propose une écriture que là où elle a un
 *  sens. Un dropset n'a PAS de repos entre ses descentes — c'est sa définition,
 *  pas un réglage à zéro. Laisser la case ouverte inviterait à y écrire une
 *  valeur que rien ne lira, et un coach a déjà encodé « pas de pause » avec un
 *  repos à 0 faute de pouvoir le dire autrement (FRE-31). */
export function leReposSeSaisit(nature: NatureDeGroupe): boolean {
  // Ni sur un EMOM (la minute suivante EST le repos) ni sur un AMRAP (on
  // enchaîne jusqu'au bout du temps) — FRE-116.
  return nature !== 'dropset' && !estChronometre(nature);
}

/* ------------------------------------------------------------------------- */
/* L'ÉCRITURE — ce qu'un groupe impose quand on le modifie                     */
/*                                                                            */
/* ⚠️ CES TROIS-LÀ VIVAIENT DANS `training-editor.ts` (FRE-45), et deux d'entre */
/* elles étaient posées AU MILIEU DU CORPS DU HOOK, écrites en colonne 0 :      */
/* l'indentation les faisait passer pour des définitions de module alors        */
/* qu'elles étaient enfermées dans une fonction de 950 lignes — donc            */
/* intestables, et invisibles à qui cherche la règle des groupes.               */
/*                                                                            */
/* Elles rejoignent la LECTURE, ci-dessus, parce que c'est la même règle vue    */
/* des deux côtés : `grouperExercices` dit ce qu'un groupe MONTRE, celles-ci ce  */
/* qu'il IMPOSE quand on y touche. Un seul fichier décrit ce qu'est un bi-set.  */
/*                                                                            */
/* ⚠️ ET PAS DANS UN `groupes.ts` VOISIN, malgré ce que suggérait le ticket : un */
/* quasi-homonyme à côté de `groupe.ts` est la meilleure façon de faire ouvrir   */
/* le mauvais fichier, et de laisser la règle se dédoubler à nouveau.           */
/* ------------------------------------------------------------------------- */

/** Champs qui appartiennent au GROUPE, pas à la ligne (FRE-31).
 *
 *  Un bi-set, c'est N exercices puis UN repos, répété UN nombre de fois. Les
 *  séries et le repos décrivent donc le tour, pas chaque exercice — et deux
 *  valeurs différentes au sein d'un groupe n'ont aucun sens physique.
 *
 *  Elles restent stockées sur chaque ligne (le contrat ne bouge pas), mais on
 *  les écrit sur TOUS les membres à la fois : la divergence devient impossible à
 *  créer. Elle existait — 19 groupes en portaient une, et un coach encodait même
 *  « pas de pause entre les deux » avec un repos à 0 sur la première ligne,
 *  faute de pouvoir le dire autrement.
 *
 *  ⚠️ AU MODULE, ET NON DANS LE CORPS DU HOOK où il vivait : un `Set` y était
 *  reconstruit à chaque rendu, et `exhaustive-deps` le réclamait — à juste
 *  titre — en dépendance de `updateExercise`. Une constante n'a aucune raison
 *  de dépendre d'un rendu. */
/** ⚠️ `groupKind` EN FAIT PARTIE (FRE-36), et c'est ce qui évite d'écrire la
 *  propagation une seconde fois. La nature décrit le groupe au même titre que
 *  les séries et le repos ; la traiter à part aurait demandé une boucle
 *  particulière dans la vue, c'est-à-dire une règle des groupes de plus, hors de
 *  ce fichier — exactement ce que FRE-45 est venu défaire. */
const CHAMPS_COMMUNS = ['sets', 'rest', 'groupKind'] as const;

/** Les champs qui appartiennent au groupe, SELON SA NATURE (FRE-36).
 *
 *  ⚠️ UN DROPSET N'A QU'UN EXERCICE. C'est ce qui le distingue d'un bi-set autant
 *  que l'absence de repos : « A puis B » contre « le même mouvement, en
 *  descente ». Le nom décrit donc le groupe entier, et le modifier sur une
 *  descente doit valoir pour toutes — sinon un dropset se met à porter deux
 *  mouvements, ce qui n'existe pas.
 *
 *  ⚠️ ET LA LISTE DÉPEND DE LA NATURE, elle n'est plus constante. C'est la
 *  conséquence directe d'avoir DEUX natures aux règles opposées : figer une seule
 *  liste obligerait à choisir laquelle des deux on trahit.
 *
 *  ⚠️ `variant` N'EN FAIT PAS PARTIE, ET C'EST UNE DÉCISION, pas un oubli. La
 *  symétrie est tentante — même exercice, donc même variante — mais elle est
 *  fausse : la variante peut légitimement CHANGER d'une descente à l'autre.
 *  William, 29/08 : un principal à tempo dont le dropset se fait sans tempo, un
 *  principal en full ROM dont la descente ne l'est plus. C'est même souvent le
 *  point du dropset. La propager écraserait cette intention en silence. */
export function champsDeGroupe(nature: NatureDeGroupe): ReadonlySet<string> {
  if (nature === 'dropset') return new Set([...CHAMPS_COMMUNS, 'name']);
  // ⚠️ MIROIR DE `prescription.champs_de_groupe` (brokkr), qui fait foi. Le temps
  // d'un groupe chronométré est commun ; celui d'une ligne de bi-set en AMRAP,
  // non — deux AMRAP d'un bi-set ont chacun leur durée.
  if (nature === 'emom') return new Set(['sets', 'clusterMode', 'groupKind']);
  if (nature === 'amrap') return new Set(['clusterMode', 'toursRealises', 'groupKind']);
  return new Set(CHAMPS_COMMUNS);
}

/** Le temps d'un groupe chronométré, prêt à lire (FRE-116).
 *
 *  EMOM : « 3 tours · 1'/mouvement · 15' » — la durée totale se CALCULE
 *  (mouvements × tours × intervalle), elle ne se saisit pas, sinon elle diverge.
 *  AMRAP : « 5' · max de tours ». `null` quand le coach n'a pas encore donné le
 *  temps : on n'affiche pas une durée qu'on ne connaît pas. */
export function tempsDuGroupe(nature: NatureDeGroupe, membres: number, sets: string | null,
  clusterMode: string | null): { intervalle: number; total: number | null } | null {
  const intervalle = parseSeconds(clusterMode);
  if (!estChronometre(nature) || !intervalle || intervalle <= 0) return null;
  if (nature === 'amrap') return { intervalle, total: intervalle };
  const tours = Number.parseInt((sets ?? '').trim(), 10);
  return { intervalle, total: Number.isFinite(tours) && tours > 0 ? intervalle * membres * tours : null };
}

/** Le repère d'un mouvement de rang `rang` (0 pour le premier) dans un EMOM en
 *  rotation, lu au MINUTEUR : le temps qui RESTE quand il démarre — « 12'00 »,
 *  « 10'00 »… jusqu'au dernier, et l'on a jusqu'à « 0'00 » pour finir (William,
 *  07/10). C'est ce qu'affiche la pendule d'une salle.
 *
 *  Sans tours, la durée totale est inconnue (`tempsDuGroupe`) : on retombe sur
 *  le temps ÉCOULÉ, « MIN 3 » pour un intervalle d'une minute, « 3'00 » sinon.
 *  La minute se lit de la PLACE dans le groupe — plus rien à écrire dans la
 *  variante, où les tableurs la rangeaient (« MIN 4GOBELET »). */
export function debutDansLEmom(rang: number, temps: { intervalle: number; total: number | null } | null): string {
  const enMinSec = (s: number) => `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}`;
  if (temps?.total != null) return enMinSec(temps.total - rang * temps.intervalle);
  if (!temps || temps.intervalle === 60) return i18n.t('session.emomMinute', { n: rang + 1 });
  return enMinSec(rang * temps.intervalle);
}

/** L'ancienne constante, conservée pour les appelants qui ne connaissent pas la
 *  nature du groupe qu'ils touchent. Elle vaut celle d'un bi-set. */
export const CHAMPS_DE_GROUPE: ReadonlySet<string> = champsDeGroupe('biset');

/** Vide les `groupId` devenus SEULS dans une séance (FRE-31).
 *
 *  L'invariant est « pas de groupe à un membre », pas « on ne supprime pas ».
 *  Bloquer la suppression d'une ligne liée serait une impasse — le coach devrait
 *  deviner qu'il faut délier d'abord — et interdirait un geste légitime : retirer
 *  un exercice d'un tri-set doit laisser les deux autres liés.
 *
 *  Sans ce nettoyage, un partenaire supprimé laisse un lien qui ne relie rien.
 *  C'est arrivé : 5 lignes chez un athlète, invisibles à l'écran (l'affichage
 *  exige `groupSize > 1`) mais bien présentes en base. */
export function nettoyerGroupesSeuls(exercices: ExerciseEditing[]): void {
  const compte = new Map<string, number>();
  for (const ex of exercices) {
    const gid = (ex.groupId || '').trim();
    if (gid) compte.set(gid, (compte.get(gid) ?? 0) + 1);
  }
  for (const ex of exercices) {
    const gid = (ex.groupId || '').trim();
    if (gid && compte.get(gid) === 1) ex.groupId = '';
  }
}

/** Bornes du bloc contigu auquel appartient l'exercice `i` — lui seul s'il n'est
 *  pas groupé. Les membres sont supposés CONSÉCUTIFS : c'est ce que produit
 *  l'app, et intercaler un exercice étranger entre A et B n'aurait aucun sens
 *  physique (on enchaînerait autre chose au milieu du bi-set). */
export function blocDe(exercices: ExerciseEditing[], i: number): { debut: number; fin: number } {
  const gid = (exercices[i]?.groupId || '').trim();
  if (!gid) return { debut: i, fin: i };
  let debut = i, fin = i;
  while (debut > 0 && (exercices[debut - 1].groupId || '').trim() === gid) debut--;
  while (fin < exercices.length - 1 && (exercices[fin + 1].groupId || '').trim() === gid) fin++;
  return { debut, fin };
}

/** La place d'une ligne dans son groupe, à partir de 0 (2a, FRE-116). Le numéro
 *  de séance, identique sur toutes les lignes d'un groupe (« 3 3 3 3 »), ne
 *  disait rien ; « 2/4 » dit où l'on est dans le tour. Les membres d'un groupe
 *  sont consécutifs (voir `grouperExercices`). */
export function rangDansLeGroupe(lignes: readonly Pick<ExerciseEditing, 'groupId'>[], i: number): number {
  const gid = (lignes[i]?.groupId || '').trim();
  let rang = 0;
  for (let j = i - 1; j >= 0 && (lignes[j]?.groupId || '').trim() === gid; j--) rang++;
  return rang;
}

/** La chaîne SANS LÂCHER à laquelle appartient une ligne (2a, FRE-116).
 *
 *  Le lien `unbroken` est posé sur la ligne qui PRÉCÈDE : MU·PU·DIPS BAR sans
 *  lâcher, c'est `unbroken` sur MU et sur PU. Pour dessiner une accolade écrite
 *  une fois, il faut savoir où la chaîne commence et combien de mouvements elle
 *  enchaîne. `null` hors chaîne. */
export function chaineSansLacher(
  lignes: readonly Pick<ExerciseEditing, 'groupId' | 'unbroken'>[], i: number,
): { debut: boolean; fin: boolean; mouvements: number } | null {
  const gid = (lignes[i]?.groupId || '').trim();
  if (!gid) return null;
  const lie = (j: number) => !!lignes[j]?.unbroken && (lignes[j + 1]?.groupId || '').trim() === gid
    && (lignes[j]?.groupId || '').trim() === gid;
  const dedans = lie(i) || lie(i - 1);
  if (!dedans) return null;
  let debut = i;
  while (lie(debut - 1)) debut--;
  let fin = debut;
  while (lie(fin)) fin++;
  return { debut: debut === i, fin: fin === i, mouvements: fin - debut + 1 };
}
