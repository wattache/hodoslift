/** Les règles de dessin des six cartes de progression du Tracker (25/10) —
 *  des fonctions pures, sans rien recalculer de ce que brokkr sert.
 *
 *  Ce qui vit ici : des graduations RONDES (pas des min/max de données), les
 *  fenêtres sans mesure (une courbe se coupe sur un trou, elle n'interpole
 *  pas), les deux repères d'une courbe (le meilleur et le dernier mesuré), et
 *  la comparaison « au début / sur les dernières semaines ». */

/** LES TEINTES DU SUIVI, une par famille de mesure : l'or pour l'intensité
 *  (charge max, 1RM estimé), le bleu pour le travail lourd (tonnage au top set,
 *  séries lourdes), l'ardoise pour le volume, le violet pour le RPE. Charge & RPE
 *  et les six cartes les lisent ICI. */
export const COULEURS_DE_SUIVI = {
  intensite: '#F5B841',
  lourd: '#3B82F6',
  volume: '#64748B',
  rpe: '#A855F7',
} as const;

/** Les nombres « ronds » d'une décade : un plafond de barres se choisit parmi
 *  eux (1 500, 3 000, 12, 40), un pas de courbe parmi les plus simples. */
const PLAFONDS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const PAS = [1, 2, 2.5, 5, 10];

function* ronds(brut: number, echelle: number[]): Generator<number> {
  const exp = Math.floor(Math.log10(Math.max(brut, 1e-9)));
  for (let e = exp; e < exp + 4; e++) {
    for (const n of echelle) {
      const r = n * 10 ** e;
      if (r >= brut - 1e-9) yield Number(r.toPrecision(12));
    }
  }
}

/** Trois graduations rondes qui ENCADRENT les valeurs : `0 / 1 500 / 3 000`,
 *  `75 / 85 / 95`, `6 / 8 / 10`. Les barres partent de zéro et montent au
 *  plafond rond le plus proche ; une courbe se cadre sur ses valeurs, le bas
 *  tombant sur un pas, ou sur un demi-pas quand le pas entier n'encadre pas
 *  (`12,5 / 17,5 / 22,5`). */
export function graduations(
  valeurs: (number | null | undefined)[],
  depuisZero: boolean,
): [number, number, number] {
  const v = valeurs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return [0, 1, 2];
  const min = depuisZero ? 0 : Math.min(...v);
  let max = Math.max(...v);
  if (max <= min) max = min + (min === 0 ? 1 : Math.abs(min) * 0.1);
  if (depuisZero) {
    const hi = ronds(max, PLAFONDS).next().value as number;
    return [0, hi / 2, hi];
  }
  for (const pas of ronds((max - min) / 2, PAS)) {
    // Le demi-pas n'est permis que s'il est lui-même rond : la moitié de 5 est
    // 2,5, celle de 2,5 est 1,25 — et 13,75 n'est pas une graduation.
    const demiRond = !/^2\.5(e|$)/.test(String(pas)) && !/^0\.25/.test(String(pas)) && !/^25/.test(String(pas));
    for (const cale of demiRond ? [pas, pas / 2] : [pas]) {
      const lo = Number((Math.floor(min / cale + 1e-9) * cale).toPrecision(12));
      const hi = Number((lo + 2 * pas).toPrecision(12));
      if (hi >= max - 1e-9) return [lo, Number((lo + pas).toPrecision(12)), hi];
    }
  }
  return [min, (min + max) / 2, max];
}

/** Les suites d'indices où la valeur EST mesurée, dans l'ordre. Une courbe se
 *  trace par suite : rien ne relie deux suites, le trou reste un trou. */
export function suitesMesurees(valeurs: (number | null | undefined)[]): number[][] {
  const suites: number[][] = [];
  let courante: number[] = [];
  valeurs.forEach((v, i) => {
    if (typeof v === 'number') courante.push(i);
    else if (courante.length) { suites.push(courante); courante = []; }
  });
  if (courante.length) suites.push(courante);
  return suites;
}

/** Les fenêtres SANS mesure, `[from, to]` inclus. C'est ce qu'on dessine en
 *  cadre tireté avec « pas d'estimation » : une courbe qui s'arrête sans rien
 *  dire se lit comme une chute. */
export function fenetresSansMesure(valeurs: (number | null | undefined)[]): { from: number; to: number }[] {
  const fenetres: { from: number; to: number }[] = [];
  valeurs.forEach((v, i) => {
    if (typeof v === 'number') return;
    const derniere = fenetres[fenetres.length - 1];
    if (derniere && derniere.to === i - 1) derniere.to = i;
    else fenetres.push({ from: i, to: i });
  });
  return fenetres;
}

/** Les deux repères d'une courbe : le MEILLEUR et le DERNIER mesuré. Pas un
 *  point par semaine. Pour le RPE, « meilleur » n'a pas de sens : `sens: 'aucun'`
 *  ne garde que le dernier. */
export function reperes(
  valeurs: (number | null | undefined)[],
  sens: 'haut' | 'aucun' = 'haut',
): { meilleur: number | null; dernier: number | null } {
  let meilleur: number | null = null;
  let dernier: number | null = null;
  valeurs.forEach((v, i) => {
    if (typeof v !== 'number') return;
    dernier = i;
    if (sens === 'haut' && (meilleur == null || v > (valeurs[meilleur] as number))) meilleur = i;
  });
  return { meilleur, dernier };
}

/** « Au début » contre « sur les dernières semaines » : la moyenne des `n`
 *  premières valeurs mesurées et des `n` dernières, `n` = 8 au plus, et jamais
 *  plus de la moitié des mesures — sinon les deux fenêtres se recouvrent et la
 *  comparaison ne dit rien. `null` sous deux mesures. */
export function debutEtFin(
  valeurs: (number | null | undefined)[],
  fenetre = 8,
): { debut: number; fin: number; n: number } | null {
  const v = valeurs.filter((x): x is number => typeof x === 'number');
  const n = Math.min(fenetre, Math.floor(v.length / 2));
  if (n === 0) return null;
  const moyenne = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { debut: moyenne(v.slice(0, n)), fin: moyenne(v.slice(-n)), n };
}
