import type { ExerciseEditing, SessionEditing, WeekEditing } from '@/api/types';

export const RPE_OPTIONS = ["", "Sub5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "FAIL"];

export const AIMED_RPE_OPTIONS = ["", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10"];

export function rpeToNumber(rpe: string | null | undefined): number | null {
  if (!rpe) return null;
  if (rpe === "FAIL") return 10;
  if (rpe === "Sub5") return 4.5;
  const v = parseFloat(rpe);
  return isNaN(v) ? null : v;
}

/** Returns a CSS color token (HSL/oklch via CSS vars). Red only at 9.5+. */
export function rpeDotColor(rpe: string): string {
  const n = rpeToNumber(rpe);
  if (n === null) return "var(--muted-foreground)";
  if (rpe === "FAIL") return "var(--destructive)";
  if (n <= 6) return "var(--success)";
  if (n <= 7.5) return "var(--success)";
  if (n <= 8.5) return "var(--warning)";
  return "var(--destructive)";
}



/** LE VERDICT RPE D'UNE SUITE DE SEMAINES — « est-ce que ça s'est bien passé ».
 *
 *  ⚠️ IL VIT ICI, ET PAS DANS LES DEUX ÉCRANS QUI LE POSENT. L'historique de la
 *  BASE (FRE-167) et le tableau du bloc (FRE-114) demandent la MÊME chose ; deux
 *  implémentations auraient divergé au premier ajustement, et c'est le défaut que
 *  ce dépôt nomme « une règle dupliquée » — on déplace le CALCUL, on ne
 *  synchronise pas la règle.
 *
 *  ⚠️ ET « SANS CIBLE » N'EST PAS « TENU ». Une suite dont aucune semaine ne
 *  porte de RPE visé ne dit rien de la façon dont elle s'est passée : répondre
 *  « tenu » affirmerait ce que la donnée tait. C'est la même règle que le `''`
 *  rendu plutôt qu'un « PDC » inventé quand la charge manque — d'où trois rendus,
 *  et non deux. */
export type VerdictRPE = { cible: false } | { cible: true; depassements: number };

/** Une semaine vue par le verdict : ce qui était visé, ce qui a été ressenti.
 *  `null` des deux côtés veut dire « rien à comparer », pas « zéro ». */
export interface SemaineRPE { cible: number | null; ressenti: number | null }

export function verdictDesSemainesRPE(semaines: SemaineRPE[]): VerdictRPE {
  let avecCible = 0;
  let depassements = 0;
  for (const { cible, ressenti } of semaines) {
    if (cible === null) continue;
    avecCible++;
    // Le ressenti porte déjà FAIL→10 : un échec dépasse toute cible sous 10.
    if (ressenti !== null && ressenti > cible) depassements++;
  }
  return avecCible === 0 ? { cible: false } : { cible: true, depassements };
}

function averageExerciseRPE(exercises: ExerciseEditing[]): number | null {
  const values = exercises
    .map((ex) => rpeToNumber(ex.feltRPE))
    .filter((value): value is number => value !== null);

  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sessionAverageRPE(session: SessionEditing): number | null {
  return averageExerciseRPE(session.exercises);
}

export function weekAverageRPE(week: WeekEditing): number | null {
  return averageExerciseRPE((week.sessions ?? []).flatMap((session) => session.exercises));
}

export function formatAverageRPE(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** L'ÉCART D'UNE SÉANCE — « est-ce que la journée s'est passée comme prévu ».
 *
 *  ⚠️ CE N'EST PAS `rpeDotColor`, ET C'EST TOUT LE POINT (refonte des écrans, 09/2026). Le barème de
 *  couleur ne connaît que la valeur ABSOLUE : tout ce qui est sous 7,5 est vert.
 *  Un athlète qui tourne à 5,8 voit donc une semaine uniformément verte, c'est-à
 *  -dire sans information. Ce qui renseigne, c'est l'ÉCART entre le ressenti et
 *  ce qui était visé — un 6 sur un 5 prescrit est un dépassement, un 9 sur un 9
 *  prescrit ne l'est pas.
 *
 *  ⚠️ ET LA RÈGLE N'EST PAS RÉÉCRITE ICI. `verdictDesSemainesRPE` compare déjà
 *  une suite de paires (cible, ressenti) ; une séance est une suite d'exercices,
 *  donc la même forme. Deux implémentations auraient divergé au premier
 *  ajustement — c'est le défaut que ce dépôt nomme « une règle dupliquée ».
 *
 *  Quatre états et non trois : « aucune cible » ne se confond pas avec « tenu ».
 *  Une séance dont aucun exercice ne porte de RPE visé ne dit rien de la façon
 *  dont elle s'est passée, et la peindre en vert affirmerait ce que la donnée
 *  tait. */
export type EcartSeance = 'echec' | 'depasse' | 'tenu' | 'sans-cible';

export function ecartDeLaSeance(session: SessionEditing): EcartSeance {
  // ⚠️ L'ÉCHEC PASSE AVANT LE RESTE, et il se lit sur le RESSENTI BRUT. Une fois
  // converti, `FAIL` vaut 10 : il devient un dépassement comme un autre, alors
  // qu'une barre ratée n'est pas « un peu trop lourd ».
  if (session.exercises.some((e) => e.feltRPE === 'FAIL')) return 'echec';

  const verdict = verdictDesSemainesRPE(session.exercises.map((e) => ({
    cible: rpeToNumber(e.aimedRPE),
    ressenti: rpeToNumber(e.feltRPE),
  })));
  if (!verdict.cible) return 'sans-cible';
  return verdict.depassements > 0 ? 'depasse' : 'tenu';
}

/** La couleur de l'écart, dans les jetons du thème. `undefined` quand il n'y a
 *  rien à dire : c'est l'absence de couleur qui doit se voir, pas un gris qu'on
 *  prendrait pour une valeur. */
export function couleurDeLEcart(ecart: EcartSeance): string | undefined {
  if (ecart === 'echec') return 'var(--destructive)';
  if (ecart === 'depasse') return 'var(--warning)';
  if (ecart === 'tenu') return 'var(--success)';
  return undefined;
}
