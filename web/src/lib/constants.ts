import type { DayTiers, OneRepMax } from "@/api/types";

/** Les mouvements dont on suit le maximum.
 *
 *  ⚠️ « PRINCIPAUX » N'EST PAS « DE STREET » (FRE-147). Le bench et le deadlift
 *  ont rejoint la liste parce que 110 et 376 lignes d'entraînement les portent
 *  et qu'on ne pouvait pas en noter le maximum — pas parce qu'ils entreraient
 *  dans un total de street. Toute règle qui veut « les mouvements du street »
 *  doit les NOMMER (`SOCLE_STREET` plus bas) et surtout pas soustraire d'ici. */
export const PRINCIPAL_MOVEMENTS = [
  "MUSCLE UP", "PULL UP", "CHIN UP", "DIPS", "SQUAT", "BENCH PRESS", "DEADLIFT",
] as const;
export type PrincipalMovement = (typeof PRINCIPAL_MOVEMENTS)[number];

export const MOVEMENT_LABELS: Record<PrincipalMovement, string> = {
  "MUSCLE UP": "Muscle-up",
  "PULL UP": "Pull-up",
  "CHIN UP": "Chin-up",
  DIPS: "Dips",
  SQUAT: "Squat",
  "BENCH PRESS": "Bench press",
  DEADLIFT: "Deadlift",
};

export const MOVEMENT_SHORT: Record<PrincipalMovement, string> = {
  "MUSCLE UP": "MU",
  "PULL UP": "PU",
  "CHIN UP": "CU",
  DIPS: "DIP",
  SQUAT: "SQ",
  "BENCH PRESS": "BP",
  DEADLIFT: "DL",
};

export const MOVEMENT_TO_ORM: Record<PrincipalMovement, keyof OneRepMax> = {
  "MUSCLE UP": "muscleUp",
  "PULL UP": "pullUp",
  "CHIN UP": "chinUp",
  DIPS: "dip",
  SQUAT: "squat",
  "BENCH PRESS": "benchPress",
  DEADLIFT: "deadlift",
};

/** LA PLACE DISPUTÉE DU TOTAL DE STREET (FRE-147).
 *
 *  Le total officiel vaut `MU + DIPS + SQUAT + max(PU, CU)` : quatre places,
 *  dont une que le pull up et le chin up se disputent. C'est déjà la règle du
 *  barème côté serveur (`total_bareme_kg`, FRE-92).
 *
 *  ⚠️ ET CE N'EST PAS LE BARÈME DE COMPÉTITION. Celui-ci additionne des 1RM
 *  d'ENTRAÎNEMENT saisis à la main ; le barème additionne des charges réellement
 *  validées en compétition. Les confondre ferait apparaître un total que
 *  l'athlète n'a jamais réalisé. */
export const PLACE_DISPUTEE = ["PULL UP", "CHIN UP"] as const satisfies readonly PrincipalMovement[];

export type MouvementDispute = (typeof PLACE_DISPUTEE)[number];

/** Les trois places du street qu'aucun mouvement ne dispute.
 *
 *  ⚠️ ÉNUMÉRÉ, ET C'EST LE CORRECTIF DE FRE-147. Ce socle valait
 *  `PRINCIPAL_MOVEMENTS − PLACE_DISPUTEE`, ce qui était vrai tant que « mouvement
 *  principal » et « mouvement de street » désignaient la même chose. Le jour où
 *  le bench et le deadlift ont rejoint les principaux, la soustraction les
 *  aurait ABSORBÉS dans le total de street : un total faux, plus gros, et que
 *  rien n'aurait signalé — un total ne se relit pas comme un écran cassé.
 *
 *  Une liste de plus à tenir, oui. C'est le prix, et il est plus petit que celui
 *  d'une règle qui a l'air de se déduire alors qu'elle se décide. */
export const SOCLE_STREET = ["MUSCLE UP", "DIPS", "SQUAT"] as const satisfies readonly PrincipalMovement[];

/** Les trois barres du SBD — squat, bench, deadlift, et rien ne s'y dispute.
 *
 *  ⚠️ CE N'EST PAS UNE DISCIPLINE, C'EST UN TOTAL. Demande de William, mot pour
 *  mot : « on veut pas créer SBD comme sport ». Le produit ne connaît que des
 *  mouvements ; une compétition déclare les siens et son score les additionne,
 *  sans que rien n'ait à savoir qu'on appelle ces trois-là un SBD. Le seul
 *  endroit où ce mot existe est cette ligne, et l'étiquette d'une carte. */
export const SOCLE_SBD = ["SQUAT", "BENCH PRESS", "DEADLIFT"] as const satisfies readonly PrincipalMovement[];

export const DEFAULT_COMP_MOVEMENTS: PrincipalMovement[] = ["MUSCLE UP", "PULL UP", "DIPS", "SQUAT"];

/** LES JOURS D'UN CYCLE — « J1 » … « Jn » (20/09).
 *
 *  ⚠️ CE SONT DES JOURS DE CYCLE, PLUS DES JOURS DE SEMAINE. La grille parlait
 *  Lundi … Dimanche : une couleur par jour ne portait aucun sens (deux coachs
 *  ont confondu jeudi et vendredi), et surtout sept lignes ne peuvent pas porter
 *  le cycle de 9 jours que suivent certains athlètes — `routers/guichet.py` le
 *  dit depuis toujours. La migration du 20/09 a renommé les 181 grilles de
 *  production dans l'ordre de la semaine (Lundi → J1 … Dimanche → J7).
 *
 *  ⚠️ CE N'A JAMAIS ÉTÉ UNE DATE, et c'est ce qui rend le changement sûr : rien
 *  dans les deux dépôts ne dérive un jour de semaine d'une date. Le jour sert à
 *  trois comparaisons de chaînes — l'ordre des séances, le rattachement d'un
 *  accessoire, le nom donné à la séance engendrée.
 *
 *  ⚠️ ET IL NE SE TRADUIT PAS : « J1 » est un code, stocké tel quel dans
 *  `daySplit` et `accessories`, et identique dans les deux langues. C'est ce qui
 *  remplace `libelleJour`, dont toute la raison d'être était de traduire sans
 *  jamais toucher à la valeur stockée. */
export const CYCLE_MIN = 1;
export const CYCLE_MAX = 14;
export const CYCLE_PAR_DEFAUT = 7;

/** Les libellés d'un cycle de `n` jours, bornés à [1, 14]. */
export function joursDuCycle(n: number): string[] {
  const borne = Math.min(CYCLE_MAX, Math.max(CYCLE_MIN, Math.round(n) || CYCLE_PAR_DEFAUT));
  return Array.from({ length: borne }, (_, i) => `J${i + 1}`);
}

/** LES JOURS DE LA SEMAINE, dans l'ordre du cycle — le NOM PAR DÉFAUT des jours
 *  d'un cycle de sept (FRE-187, puis 30/09 : le défaut a remplacé le bouton).
 *
 *  ⚠️ CE SONT DES NOMS, PAS UN RETOUR EN ARRIÈRE. La grille reste un cycle :
 *  `J1` identifie le jour, rattache les accessoires et donne le rang. « Lundi »
 *  ne fait que le nommer, et seulement tant que le cycle fait sept jours. */
export const JOURS_DE_LA_SEMAINE = [
  'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche',
] as const;

/** Le rang d'un jour de cycle. ⚠️ UN NOMBRE, PAS UNE CHAÎNE : « J10 » vient
 *  après « J9 », là où un tri de texte le rangerait entre « J1 » et « J2 ».
 *  Un libellé qui n'est pas un jour de cycle passe en dernier. */
export function rangDeCycle(jour: string | null | undefined): number {
  const trouve = /^J(\d+)$/.exec((jour ?? '').trim());
  return trouve ? Number(trouve[1]) : Number.MAX_SAFE_INTEGER;
}

/** ⚠️ UN JOUR DE SEMAINE SE LIT ENCORE, ET IL LE FAUT (20/09, après incident).
 *
 *  Le front a été ouvert sur une base pas encore migrée : la grille ne portait
 *  que des « Lundi » … « Dimanche », l'éditeur n'en a reconnu aucun, a affiché
 *  sept lignes VIDES — et le premier geste du coach les a enregistrées. Une
 *  répartition perdue, et il a fallu la reconstituer depuis les semaines déjà
 *  engendrées.
 *
 *  La faute n'était pas la migration manquante : c'est qu'une valeur non
 *  reconnue était JETÉE au lieu d'être gardée. Le sélecteur de variantes, à
 *  deux écrans de là, fait l'inverse depuis toujours — « une valeur héritée
 *  absente du catalogue reste affichée ET sélectionnable : sans ça, rouvrir une
 *  vieille séance l'effacerait silencieusement ». La même règle vaut ici.
 *
 *  La correspondance est celle de la migration, dans l'ordre de la semaine.
 *  Une grille lue ainsi se réécrit en jours de cycle : elle se migre d'elle-même
 *  au premier enregistrement, au lieu de se vider. */
const RANG_DU_JOUR_FR: Record<string, number> = {
  lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7,
};

/** Le jour de cycle d'un libellé — le sien s'il en est déjà un, celui de la
 *  correspondance s'il est un jour de semaine, et sinon la valeur telle quelle
 *  (on ne détruit pas ce qu'on ne comprend pas). */
export function versJourDeCycle(jour: string | null | undefined): string {
  const propre = (jour ?? '').trim();
  if (rangDeCycle(propre) !== Number.MAX_SAFE_INTEGER) return propre;
  const rang = RANG_DU_JOUR_FR[propre.toLowerCase()];
  return rang ? `J${rang}` : propre;
}

/** LA COULEUR D'UN JOUR DE CYCLE (20/09, retour de William : « avant il y avait
 *  des couleurs et plus maintenant »).
 *
 *  ⚠️ ELLE NE PARLE PAS LA LANGUE DES TIERS, et c'est la contrainte qui a tout
 *  décidé. Le repère par jour existait avant (lundi bleu, mardi vert…) et il
 *  manque ; mais trois des sept tons de l'écran — l'or, le bleu, le gris — sont
 *  DÉJÀ ceux des tiers 1, 2 et 3, dans les cases juste à côté. Les rendre aux
 *  jours ferait lire une couleur pour une information qu'elle ne porte pas. Les
 *  jours ont donc leur propre palette, et elle ne se pose JAMAIS dans une case :
 *  un liseré, une pastille, le libellé. La case reste au tier.
 *
 *  ⚠️ ET DEUX JOURS VOISINS SONT LOIN L'UN DE L'AUTRE. C'est le défaut d'origine
 *  du ticket : « un coach confond jeudi et vendredi, orange et rouge sont trop
 *  proches ». Ici, deux rangs consécutifs sont séparés d'au moins 60° de teinte.
 *  Quatorze valeurs, soit exactement le cycle le plus long que le stepper
 *  autorise : aucune ne se répète.
 *
 *  Saturation et luminosité constantes, basses : ces couleurs situent, elles
 *  n'alertent pas. */
const TEINTES_DES_JOURS = [210, 150, 35, 275, 95, 330, 190, 55, 250, 130, 15, 300, 170, 75];

export function couleurDuJour(jour: string | null | undefined): string {
  const rang = rangDeCycle(jour);
  if (rang === Number.MAX_SAFE_INTEGER) return 'hsl(0 0% 60%)';
  return `hsl(${TEINTES_DES_JOURS[(rang - 1) % TEINTES_DES_JOURS.length]} 45% 62%)`;
}

/** Les en-têtes courts des colonnes, sur téléphone : « MUSCLE UP » → « MU ».
 *
 *  ⚠️ UNIQUES DANS LA LISTE, ET C'EST TOUT L'INTÉRÊT DE LES CALCULER ENSEMBLE.
 *  « PULL UP » et « PUSH UP » donnent le même « PU » : deux colonnes
 *  indistinguables sur l'écran le plus étroit, là où la confusion coûte le plus.
 *  On rallonge jusqu'à les séparer (« PUL », « PUS ») plutôt que de laisser un
 *  doublon — c'est la même leçon que « le nom seul ne dit pas l'exercice ». */
export function abregerMouvements(noms: readonly string[]): Record<string, string> {
  const pris = new Set<string>();
  const out: Record<string, string> = {};
  for (const nom of noms) {
    const propre = nom.trim();
    const mots = propre.split(/\s+/).filter(Boolean);
    const initiales = mots.length > 1 ? mots.map(m => m[0]).join('') : propre;
    let court = initiales.length <= 4 ? initiales : initiales.slice(0, 2);
    for (let n = court.length + 1; pris.has(court.toUpperCase()) && n <= propre.length; n++) {
      court = propre.slice(0, n).trim();
    }
    pris.add(court.toUpperCase());
    out[nom] = court.toUpperCase();
  }
  return out;
}

/** LA GRILLE AUX DIMENSIONS DU CYCLE : `n` lignes J1 … Jn, et rien que les tiers
 *  des mouvements encore sélectionnés.
 *
 *  ⚠️ DÉPLACÉE ICI DEPUIS L'ÉDITEUR pour être éprouvable seule : c'est la
 *  fonction qui décide de ce qui SURVIT à un enregistrement de la trame, et ce
 *  qu'elle laisse tomber est perdu sans un mot. */
/** LES MOUVEMENTS D'UNE TRAME : ceux que le coach a SÉLECTIONNÉS, plus ceux que
 *  sa grille PLACE DÉJÀ (FRE-198).
 *
 *  ⚠️ C'EST LA RÈGLE DE `versJourDeCycle`, ÉTENDUE AUX MOUVEMENTS. Elle n'avait
 *  été posée que sur les JOURS après l'incident du 20/09 — une demi-règle, et
 *  c'est l'autre moitié qui a effacé quatre cases le 19/09 : `BENCH` n'était
 *  dans aucune sélection, `normaliseDaySplit` l'a jeté, et le premier
 *  enregistrement de trame a gardé ce qu'il voyait.
 *
 *  ⚠️ CE N'EST PAS UNE TOLÉRANCE, C'EST LA SEULE LECTURE JUSTE. Le retrait
 *  DÉLIBÉRÉ d'un mouvement a son propre chemin, confirmé, qui nettoie la grille
 *  lui-même (`retirerDesPrincipaux`). Un mouvement placé sans être sélectionné
 *  n'est donc JAMAIS un geste du coach : c'est une incohérence — un renommage,
 *  une migration, un front servi trop tôt. La jeter détruit la seule trace de
 *  ce qu'il avait posé.
 *
 *  L'HÉRITÉ VIENT APRÈS LA SÉLECTION, et cet ordre n'est pas cosmétique : c'est
 *  celui que `generation_semaine` applique déjà — un mouvement hors sélection y
 *  vaut `10**6`, donc il sort en fin de séance. L'écran dit la même chose que
 *  ce qui sera engendré. */
export function mouvementsDeLaTrame(split: DayTiers[], selection: string[]): string[] {
  const vus = new Set(selection);
  const herites: string[] = [];
  for (const jour of split) {
    for (const mouvement of Object.keys(jour.tiers ?? {})) {
      if (vus.has(mouvement)) continue;
      vus.add(mouvement);
      herites.push(mouvement);
    }
  }
  return herites.length ? [...selection, ...herites] : selection;
}

export function normaliseDaySplit(split: DayTiers[], movements: string[], n: number): DayTiers[] {
  const byDay = new Map(split.map(s => [s.day, s]));
  return joursDuCycle(n).map(day => {
    const existing = byDay.get(day);
    const tiers: { [key: string]: number } = {};
    if (existing) for (const [m, t] of Object.entries(existing.tiers)) if (movements.includes(m)) tiers[m] = t;
    // ⚠️ LE LIBELLÉ SE REPORTE, SINON IL DISPARAÎT SANS UN MOT (FRE-187). Il ne
    // tient à rien d'autre : ni le nombre de jours, ni les mouvements
    // sélectionnés ne le concernent. Un jour neuf n'en a pas — `undefined`, et
    // jamais `''`, pour qu'il n'existe qu'une façon de dire « pas de nom ».
    return existing?.label ? { day, label: existing.label, tiers } : { day, tiers };
  });
}

/** LE NOM D'UN JOUR DU CYCLE, TEL QU'IL S'AFFICHE (William, 30/09).
 *
 *  Le libellé posé par le coach d'abord. Sinon, sur un cycle de SEPT jours, le
 *  jour de la semaine — J1 « Lundi » … J7 « Dimanche » : c'est le cas de toutes
 *  les trames, et le geste qui les nommait était oublié presque partout. Sur
 *  tout autre cycle, `J<n>`.
 *
 *  ⚠️ LA MÊME RÈGLE QUE `nom_du_jour` DE BROKKR (`generation_semaine.py`), qui
 *  nomme la séance générée : l'écran annonce ici le nom qu'elle portera. */
/** Retire les noms de semaine d'une grille qui QUITTE les sept jours (William,
 *  30/09 : « si on change le nombre de jours, le nommage semaine disparaît »).
 *  Un ancien clic sur « Nommer comme la semaine » a pu ÉCRIRE « Lundi » sur J1 :
 *  à huit jours il n'a plus de sens. Un nom propre au coach (« Jambes ») reste.
 *  La comparaison ignore la casse — la production porte aussi « LUNDI ». */
export function sansNomsDeSemaine(split: DayTiers[]): DayTiers[] {
  return split.map((jour) => {
    const rang = rangDeCycle(jour.day);
    const deSemaine = rang >= 1 && rang <= JOURS_DE_LA_SEMAINE.length
      && (jour.label ?? '').trim().toLocaleLowerCase() === JOURS_DE_LA_SEMAINE[rang - 1].toLocaleLowerCase();
    return deSemaine ? { day: jour.day, tiers: jour.tiers } : jour;
  });
}

export function nomDuJour(jour: { day: string; label?: string | null }, cycle: number): string {
  const propre = (jour.label ?? '').trim();
  if (propre) return propre;
  const rang = rangDeCycle(jour.day);
  return cycle === JOURS_DE_LA_SEMAINE.length && rang >= 1 && rang <= JOURS_DE_LA_SEMAINE.length
    ? JOURS_DE_LA_SEMAINE[rang - 1] : jour.day;
}

/** Plus petit incrément de charge possible (kg). 1.25 partout, 2.5 au SQUAT. */


