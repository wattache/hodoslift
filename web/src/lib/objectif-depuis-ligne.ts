import type { BaseAccessory, BlockObjective, Principle } from '@/api/types';

/** UNE LIGNE DE BASE DEVIENT UN OBJECTIF PRÉ-REMPLI (FRE-252) — tout ce que la
 *  ligne prescrit et qu'un objectif sait porter : mouvement, variantes, format
 *  ET ses options, tempo, séries, reps, charge, assistance.
 *
 *  Les variantes d'une ligne sont une LISTE, celle d'un objectif une chaîne :
 *  elles se joignent en « CHEST + DS ». La charge devient le bas de la
 *  fourchette, le coach pose le haut s'il en veut une. */
export function objectifDepuisLaLigne(l: Principle | BaseAccessory): BlockObjective {
  const texte = (v: string | null | undefined) => (v ?? '').trim();
  return {
    id: '',
    exercise: texte(l.name),
    variant: (l.variant ?? []).map(v => v.trim()).filter(Boolean).join(' + '),
    format: texte(l.format),
    clusterMode: texte(l.clusterMode),
    clusterRest: texte(l.clusterRest),
    tempo: texte(l.tempo),
    sets: texte(l.sets),
    reps: texte(l.reps),
    weightMin: texte(l.weight),
    weightMax: '',
    assistance: texte(l.assistance),
    atteintLe: null,
  };
}
