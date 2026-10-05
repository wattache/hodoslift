import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';

import i18n from '@/i18n';
import { rpeDotColor } from '@/lib/rpe';
import { formatSeconds, parseSeconds } from '@/lib/time';
import { formatRest } from '../format';
import type { ProgressionPoint } from '../exercise-progression-data';

/** LE SOCLE DES RENDUS — ce que tous lisent d'un `ProgressionPoint`, calculé
 *  une fois (brief progression, 27/09).
 *
 *  ⚠️ QUATRE VALEURS, TOUJOURS : séries × reps, charge, RPE, et l'écart quand
 *  il existe. Un rendu qui ne montrerait que la charge oblige à ouvrir autre
 *  chose pour comprendre. Les fonctions d'ici sont la seule écriture de ces
 *  valeurs : « 65→62,5 », « 3×2 → 3×1 », « 8→9 », « 8 visé ». */

/** ⚠️ « 112,5 » ET NON « 112.5 » : une demi-plaque est exactement l'incrément
 *  qu'on vient lire. La locale décide du séparateur. */
export const kg = (n: number): string => n.toLocaleString(i18n.language, { maximumFractionDigits: 2 });

/** Un écart signé : « +2,5 », « −5 », « 0 ». */
export const signe = (n: number): string => n === 0 ? '0' : `${n > 0 ? '+' : '−'}${kg(Math.abs(n))}`;

export interface Lecture { reel: ReactNode; prescrit?: ReactNode; ton?: string; couleur?: string }

function formatExerciseValue(value: string, unit: string): string {
  if (!value) return '—';
  if (unit !== 'sec') return value;
  const seconds = parseSeconds(value);
  return seconds > 0 ? formatSeconds(seconds) : `${value}"`;
}

/** LE VOLUME — séries × reps, dans la notation d'un coach.
 *
 *  ⚠️ NE NORMALISE PAS repsDone. C'est du texte libre : un nombre quand toutes
 *  les séries sont identiques, le détail sinon (« 8/6/6 »). Écrire « 3×6 » à la
 *  place effacerait ce que l'athlète raconte. */
export function volumePrescrit(p: ProgressionPoint): string {
  if (!p.reps.trim()) return p.sets.trim() ? `${p.sets}×—` : '';
  const reps = formatExerciseValue(p.reps, p.repsUnit);
  return p.sets.trim() ? `${p.sets}×${reps}` : reps;
}

export function lireVolume(p: ProgressionPoint): Lecture {
  const prescrit = volumePrescrit(p);
  const fait = p.repsDone.trim();
  if (!fait || fait === p.reps.trim()) return { reel: prescrit || '—' };
  return { reel: formatExerciseValue(fait, p.repsUnit), prescrit: prescrit || undefined, ton: 'font-semibold text-gold' };
}

/** « 3×2 » ou « 3×2 → 3×1 », en une chaîne — l'écriture du tableau.
 *  Un seul nombre fait = les séries prescrites, à ce compte ; le détail
 *  (« 8/6/6 ») reste tel quel, c'est ce que l'athlète raconte. `lireVolume`,
 *  elle, garde « 3×2 → 1 » : c'est l'écriture de la courbe. */
export function volumeEcrit(p: ProgressionPoint): string {
  const l = lireVolume(p);
  if (!l.prescrit) return String(l.reel);
  const fait = p.repsDone.trim();
  const reel = /^\d+$/.test(fait) && p.sets.trim() && p.repsUnit !== 'sec' ? `${p.sets}×${fait}` : String(l.reel);
  return `${l.prescrit} → ${reel}`;
}

/** LE RPE — sa propre échelle de couleur, et FAIL reste un mot.
 *
 *  ⚠️ L'ÉCART NE SE COLORE PAS EN OR ICI. Le ressenti diffère presque toujours de
 *  la cible : tout passer en or ne dirait rien. La couleur reste celle de la
 *  VALEUR (`rpeDotColor`), et c'est la cible écrite devant qui signale l'écart.
 *
 *  ⚠️ FAIL ET Sub5 SONT DES CATÉGORIES : on rend le libellé, jamais 10 ni 4,5. */
export function lireRpe(p: ProgressionPoint): Lecture {
  const ressenti = p.rpeRaw.trim();
  const cible = p.aimedRpeRaw.trim();
  if (!ressenti) return { reel: cible || '—', ton: 'text-muted-foreground' };
  return {
    reel: ressenti,
    prescrit: cible && cible !== ressenti ? cible : undefined,
    ton: 'font-semibold',
    couleur: rpeDotColor(ressenti),
  };
}

/** « 8 », « 8→9 », « 8 visé » — avec sa couleur. */
export function rpeEcrit(p: ProgressionPoint, t: TFunction): { texte: string; couleur?: string; vise: boolean } {
  const ressenti = p.rpeRaw.trim();
  const cible = p.aimedRpeRaw.trim();
  if (!ressenti) return { texte: cible ? t('progression.rpeVise', { rpe: cible }) : '—', vise: true };
  const texte = cible && cible !== ressenti ? `${cible}→${ressenti}` : ressenti;
  return { texte, couleur: rpeDotColor(ressenti), vise: false };
}

/** LE REPOS — « Libre → 3' ». La comparaison se fait sur la valeur FORMATÉE :
 *  « 180 » et « 3' » sont le même repos. */
export function lireRepos(p: ProgressionPoint): Lecture {
  const prescrit = formatRest(p.rest) || '—';
  const fait = p.restActual.trim();
  if (!fait) return { reel: prescrit };
  const reel = formatRest(fait);
  if (reel === prescrit) return { reel };
  return { reel, prescrit, ton: 'font-semibold text-gold' };
}

/** Un prescrit à montrer à côté du réel : il existe, et le réel l'a quitté. */
export const prescritQuitte = (p: ProgressionPoint): p is ProgressionPoint & { kg: number; kgDone: number } =>
  p.kg !== null && p.kgDone !== null && p.kgDone !== p.kg;

/** « 65 » ou « 65→62,5 » ; vide sans charge. */
export function chargeEcrite(p: ProgressionPoint): { texte: string; ecart: boolean } {
  if (p.kgEffective === null) return { texte: '', ecart: false };
  if (prescritQuitte(p)) return { texte: `${kg(p.kg)}→${kg(p.kgDone)}`, ecart: true };
  return { texte: kg(p.kgEffective), ecart: false };
}

/** Une semaine sans aucune trace de réalisation : à venir, ou pas faite. Son
 *  RPE se lit « visé ». */
export const pasEncoreFaite = (p: ProgressionPoint): boolean =>
  !p.rpeRaw.trim() && p.kgDone === null && !p.repsDone.trim();

/** L'écart de charge d'une semaine à la PRÉCÉDENTE CHARGÉE ; `null` pour la
 *  première et pour une semaine sans charge. Une semaine trouée ne coupe pas la
 *  suite : on compare à la dernière valeur connue. */
export function ecartsDeCharge(points: ProgressionPoint[]): (number | null)[] {
  let precedente: number | null = null;
  return points.map(p => {
    if (p.kgEffective === null) return null;
    const ecart = precedente === null ? null : p.kgEffective - precedente;
    precedente = p.kgEffective;
    return ecart;
  });
}

/** Première et dernière charge, et le delta du bloc. */
export function bornesDeCharge(points: ProgressionPoint[]): { premiere: number | null; derniere: number | null; delta: number | null } {
  const charges = points.map(p => p.kgEffective).filter((v): v is number => v !== null);
  const premiere = charges[0] ?? null;
  const derniere = charges[charges.length - 1] ?? null;
  return { premiere, derniere, delta: premiere !== null && derniere !== null ? derniere - premiere : null };
}

/** La trajectoire en toutes lettres — l'`aria-label` de chaque rendu :
 *  « 60 kg en S1, 62,5 en S2, 65→62,5 en S3, 67,5 prévu en S4 ». */
export function trajectoireEnMots(points: ProgressionPoint[], t: TFunction): string {
  const morceaux = points.map(p => {
    const semaine = p.label;
    if (p.kgEffective === null) {
      const aide = p.assistance.trim();
      return aide ? t('progression.enMots.aide', { aide, semaine }) : t('progression.enMots.rien', { semaine });
    }
    const charge = chargeEcrite(p).texte;
    return pasEncoreFaite(p) ? t('progression.enMots.prevu', { charge, semaine }) : t('progression.enMots.fait', { charge, semaine });
  });
  return morceaux.join(', ');
}
