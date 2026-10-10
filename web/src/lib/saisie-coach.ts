import type { ExerciseEditing } from '@/api/types';
import i18n from '@/i18n';
import { parseWeight } from '@/lib/weight';
import { seriesDeLaLigne } from '@/lib/par-serie';

/** CE QUE LE COACH ÉCRIT, ET COMMENT — les règles de saisie, hors de toute vue.
 *
 *  Le tableau du grand écran et les cartes du téléphone écrivent les MÊMES
 *  champs par les MÊMES gestes ; deux copies de ces règles divergeraient au
 *  premier correctif. */

/** Les champs qu'on parcourt au stepper du téléphone, dans l'ordre du geste :
 *  « Champ suivant » écrit une ligne entière sans jamais viser une petite cible. */
export const CHAMPS_DU_STEPPER = ['sets', 'reps', 'weight', 'aimedRPE'] as const;
export type ChampDuStepper = (typeof CHAMPS_DU_STEPPER)[number];

export function champSuivant(champ: ChampDuStepper): ChampDuStepper {
  const k = CHAMPS_DU_STEPPER.indexOf(champ);
  return CHAMPS_DU_STEPPER[(k + 1) % CHAMPS_DU_STEPPER.length];
}

/** Le pas JUSTE de chaque champ : 2,5 kg pour une charge, 1 pour des séries ou
 *  des répétitions, 0,5 pour un RPE. */
export function pasDuChamp(champ: ChampDuStepper): number {
  return champ === 'weight' ? 2.5 : champ === 'aimedRPE' ? 0.5 : 1;
}

/** Quatre raccourcis par champ : des DELTAS pour la charge, des valeurs
 *  courantes pour le reste. */
export function raccourcisDuChamp(champ: ChampDuStepper): string[] {
  if (champ === 'weight') return ['−5', '−2.5', '+2.5', '+5'];
  if (champ === 'sets') return ['2', '3', '4', '5'];
  if (champ === 'reps') return ['3', '5', '8', '10'];
  return ['6', '7', '8', '9'];
}

/** La valeur numérique d'un champ, virgule acceptée ; `null` quand ce n'est pas un nombre. */
export function nombreDuChamp(valeur: string | null | undefined): number | null {
  const n = parseFloat((valeur ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** La valeur après un pas, jamais sous zéro, sans traînée de flottant
 *  (« 82.5 », pas « 82.50000001 »). Une fourchette « 6/8 » part de sa borne
 *  basse ; un champ vide part de zéro. */
export function appliquerLePas(valeur: string | null | undefined, delta: number): string {
  const base = nombreDuChamp(valeur) ?? 0;
  const v = Math.max(0, Math.round((base + delta) * 100) / 100);
  return String(v);
}

/** Un raccourci : « −5 » et « +2.5 » se cumulent, « 3 » se pose. */
export function appliquerLeRaccourci(valeur: string | null | undefined, raccourci: string): string {
  const signe = raccourci.charAt(0);
  if (signe === '+' || signe === '−' || signe === '-') {
    const delta = (signe === '+' ? 1 : -1) * (nombreDuChamp(raccourci.slice(1)) ?? 0);
    return appliquerLePas(valeur, delta);
  }
  return raccourci;
}

/** Les champs qui se recopient vers le bas — et dont l'écriture périme un réel. */
export type ChampDePrescription = 'sets' | 'reps' | 'weight' | 'rest' | 'aimedRPE';

/** ⚠️ UNE SEULE ÉCRITURE PAR CHAMP, QUE LA VALEUR SOIT TAPÉE, RECOPIÉE OU
 *  POUSSÉE AU STEPPER. Une nouvelle consigne périme le réel de l'ancienne
 *  (reps → `repsDone`, charge → `weightDone`) ; une écriture qui poserait le
 *  champ seul laisserait sur trois lignes un réel collé à une consigne qu'il ne
 *  décrit plus. Rend les paires (champ, valeur) à écrire, dans l'ordre. */
export function ecrituresDePrescription(
  champ: ChampDePrescription, v: string,
): [string, string | boolean][] {
  if (champ === 'reps') return [['reps', v], ['repsDone', '']];
  if (champ === 'weight') {
    // Même règle que reps/repsDone : sans ça, un réel obsolète resterait collé
    // à la nouvelle charge et fausserait l'écart, le tonnage et les records.
    return [['weight', v], ['weightLocked', v.trim() !== ''], ['weightDone', '']];
  }
  if (champ === 'rest') return [['rest', v.trim()]];
  return [[champ, v]];
}

export interface ResumeDuReel {
  /** « 4 × 8 · 40 kg » — ce que l'athlète a fait, en une ligne. */
  texte: string;
  /** « RPE ressenti 7 » ou « −5 kg sur la charge » — le détail sous la ligne. */
  detail: string;
  /** Vrai quand le réel s'écarte de la consigne : la ligne passe en ambre. */
  ecart: boolean;
}

/** CE QUE L'ATHLÈTE A FAIT, POUR LE COACH — lu, jamais écrit ici.
 *
 *  `null` tant que rien n'est saisi : le vide vaut « conforme » côté serveur
 *  (`records.py`, FRE-160), mais l'écran ne l'affirme pas — il dit « pas
 *  encore fait ». Le réel s'écarte quand une répétition ou une charge saisie
 *  diffère de la consigne ; un RPE ressenti au-dessus du visé est un écart aussi. */
export function resumeDuReel(ex: Partial<Pick<ExerciseEditing,
  'sets' | 'reps' | 'repsUnit' | 'weight' | 'weightDone' | 'repsDone' | 'repsDoneBySet' | 'weightDoneBySet' | 'feltRPE' | 'aimedRPE'>>): ResumeDuReel | null {
  const repsFaites = (ex.repsDone ?? '').trim();
  const chargeFaite = (ex.weightDone ?? '').trim();
  const rpe = (ex.feltRPE ?? '').trim();
  if (!repsFaites && !chargeFaite && !rpe) return null;

  const reps = repsFaites || (ex.reps ?? '').trim();
  const charge = chargeFaite || (ex.weight ?? '').trim();
  const unite = ex.repsUnit === 'sec' ? ' s' : '';
  const morceaux = [
    [(ex.sets ?? '').trim() || '—', reps ? `${reps}${unite}` : '—'].join(' × '),
    charge ? `${charge} kg` : null,
  ].filter(Boolean) as string[];

  const details: string[] = [];
  let ecart = false;
  const chargeVoulue = parseWeight(ex.weight);
  const chargeVue = parseWeight(ex.weightDone);
  if (chargeVue && chargeVoulue && chargeVue !== chargeVoulue) {
    ecart = true;
    const delta = Math.round((chargeVue - chargeVoulue) * 100) / 100;
    const series = seriesDeLaLigne(ex.weightDoneBySet, ex.weightDone).filter(Boolean);
    const ou = series.length > 1 && series.some(s => parseWeight(s) === chargeVoulue)
      ? ` ${i18n.t('session.surNSeries', { count: series.filter(s => parseWeight(s) !== chargeVoulue).length })}` : '';
    details.push(`${delta > 0 ? '+' : '−'}${Math.abs(delta)} kg${ou}`);
  }
  if (repsFaites && (ex.reps ?? '').trim() && repsFaites !== (ex.reps ?? '').trim()) {
    ecart = true;
    details.push(i18n.t('session.auLieuDe', { fait: `${repsFaites}${unite}`, prevu: `${(ex.reps ?? '').trim()}${unite}` }));
  }
  if (rpe) {
    const vise = nombreDuChamp(ex.aimedRPE);
    const senti = nombreDuChamp(rpe);
    if (vise !== null && senti !== null && senti > vise) ecart = true;
    details.push(`${i18n.t('session.rpeRessenti', { rpe })}${!ecart && vise !== null ? ` · ${i18n.t('session.conforme')}` : ''}`);
  }
  return { texte: morceaux.join(' · '), detail: details.join(' · '), ecart };
}
