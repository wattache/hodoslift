import type { Goal, RecordDeForce } from '@/api/types';

/** L'ÉCART D'UN OBJECTIF D'ATHLÈTE — ce qu'il reste à gagner, en kilos.
 *
 *  ⚠️ « MUSCLE UP 1 @ 20 » NE DIT RIEN, et c'est tout le défaut de l'écran des
 *  objectifs : neuf lignes, zéro atteint, toutes « depuis le 2 juin ». La liste
 *  se lit comme un cimetière alors que l'athlète a progressé sur la plupart.
 *  « 20 visé, 15 aujourd'hui, +5 » dit tout — et c'est la même donnée.
 *
 *  ⚠️ L'ÉCART SE CALCULE CONTRE LE RECORD AU MÊME NOMBRE DE RÉPÉTITIONS.
 *  « Dips 8 @ 70 » se compare au record à 8 reps, JAMAIS au 1RM : un 1RM de 90
 *  ne dit rien de ce qu'on tient sur huit. C'est exactement la grille que rend
 *  `AllTimePrTable` juste au-dessus, et c'est elle qui fait foi.
 *
 *  ⚠️ ET LA COMPÉTITION COMPTE. Elle a été oubliée à la première écriture, et
 *  c'était le cas MAJORITAIRE : 33 des 44 objectifs ouverts en production visent
 *  un single (mesuré le 12/09), et `computeCompetitionPRs` ne rend justement que
 *  des singles. Un athlète qui a fait 180 au squat en compétition mais jamais à
 *  l'entraînement se voyait annoncer « pas de record ». La grille du dessus
 *  fusionne TROIS sources — entraînement, compétition, manuel — et cette
 *  fonction doit fusionner les mêmes, sinon les deux écrans se contredisent sur
 *  le même athlète.
 *
 *  ⚠️ ET SANS RECORD À CE NOMBRE DE REPS, ON DIT « PAS DE RECORD » — jamais
 *  « +70 kg ». Écrire l'écart contre zéro laisserait croire qu'on part de rien,
 *  alors qu'on ne SAIT pas : l'athlète n'a simplement jamais été mesuré sur ce
 *  schéma. Même règle que le 1RM manquant de la Table RM, qui rend un tiret et
 *  non un zéro.
 */
export type EcartObjectif =
  /** Un record existe à ce nombre de reps : on sait ce qu'il reste. */
  | { etat: 'mesure'; actuel: number; cible: number; restant: number; progression: number }
  /** Rien à ce nombre de reps — on ne sait pas d'où l'on part. */
  | { etat: 'sans-record'; cible: number }
  /** L'objectif lui-même n'a pas de cible chiffrée : rien à comparer. */
  | { etat: 'sans-cible' };

const nombre = (v: string | null | undefined): number | null => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Le meilleur record connu pour ce mouvement À CE NOMBRE DE REPS — records
 *  servis par brokkr et records manuels confondus, comme dans la grille.
 *
 *  ⚠️ RIEN N'EST RECALCULÉ ICI. `dashboard.tsx` a déjà les deux sous la main et
 *  les passe à `AllTimePrTable` : les reprendre plutôt que les refaire est ce
 *  qui garantit que les deux écrans disent le même chiffre. */
export function recordAuxReps(
  records: readonly RecordDeForce[],
  manualPRs: Record<string, Record<number, number>> | undefined,
  mouvement: string,
  reps: number,
  /** Les maxima de COMPÉTITION, par mouvement. `computeCompetitionPRs` n'en rend
   *  que pour un single : ils ne comptent donc que sur `reps === 1`, exactement
   *  comme dans `AllTimePrTable`. */
  competitionPRs?: Partial<Record<string, { weight: number }>>,
): number | null {
  const cle = mouvement.trim().toUpperCase();
  const candidats: number[] = [];

  for (const r of records) {
    if (r.movement.trim().toUpperCase() === cle && r.reps === reps) candidats.push(r.weight);
  }
  const manuel = manualPRs?.[mouvement]?.[reps];
  if (typeof manuel === 'number' && manuel > 0) candidats.push(manuel);
  if (reps === 1) {
    const compet = competitionPRs?.[mouvement]?.weight
      ?? competitionPRs?.[cle]?.weight;
    if (typeof compet === 'number' && compet > 0) candidats.push(compet);
  }

  return candidats.length ? Math.max(...candidats) : null;
}

export function ecartDeLObjectif(
  goal: Goal,
  records: readonly RecordDeForce[],
  manualPRs?: Record<string, Record<number, number>>,
  competitionPRs?: Partial<Record<string, { weight: number }>>,
): EcartObjectif {
  const cible = nombre(goal.weight);
  // `reps` vaut « 1 » par défaut à l'affichage ; ici l'absence de cible CHIFFRÉE
  // est ce qui compte — un objectif à 0 kg n'a rien à comparer.
  const reps = nombre(goal.reps) ?? 1;
  if (cible === null) return { etat: 'sans-cible' };

  const actuel = recordAuxReps(records, manualPRs, goal.exercise, reps, competitionPRs);
  if (actuel === null) return { etat: 'sans-record', cible };

  return {
    etat: 'mesure',
    actuel,
    cible,
    // Négatif quand l'objectif est dépassé — l'appelant décide quoi en dire.
    restant: Math.round((cible - actuel) * 10) / 10,
    progression: Math.max(0, Math.min(1, actuel / cible)),
  };
}

/** Le plus PROCHE d'une liste : celui qu'il reste le moins à gagner.
 *
 *  ⚠️ C'EST CE QUI TRANSFORME UNE LISTE DE VŒUX EN PROCHAIN PALIER. Sans lui,
 *  neuf objectifs se valent et aucun ne se distingue ; avec lui, l'écran répond
 *  à « je travaille quoi maintenant ». Les objectifs sans record n'y prétendent
 *  pas : on ne peut pas dire qu'ils sont proches. */
export function lePlusProche<T>(
  items: readonly T[],
  ecartDe: (item: T) => EcartObjectif,
): { item: T; ecart: Extract<EcartObjectif, { etat: 'mesure' }> } | null {
  let meilleur: { item: T; ecart: Extract<EcartObjectif, { etat: 'mesure' }> } | null = null;
  for (const item of items) {
    const e = ecartDe(item);
    if (e.etat !== 'mesure' || e.restant <= 0) continue;
    if (!meilleur || e.restant < meilleur.ecart.restant) meilleur = { item, ecart: e };
  }
  return meilleur;
}
