import type { AttemptTier, CompAttempt } from '@/api/types';
import { chainedInheritedTiers, effectiveTiers, ordreDuTour, plancherDAnnonce, type EffectiveTiers, type Tour } from '@/lib/comp-helpers';

/** Ce que l'écran Plateau décide sans React : le tour où en est le plateau, et
 *  les trois gestes d'annonce (un tier, une charge libre, le plan).
 *
 *  ⚠️ Chaque geste rend `null` quand brokkr le refuserait : l'écran ne propose
 *  pas l'écriture, au lieu de laisser le serveur répondre 422 après coup. */

type Inscrit = { movements: { name: string; attempts: CompAttempt[] }[]; flight?: string | null };

/** Le tour où en est le plateau : le premier de la séquence où quelqu'un attend
 *  son verdict. Un tour sans personne ne retient pas. Tout jugé : le dernier. */
export function tourDuPlateau(participants: Inscrit[], tours: Tour[]): number {
  const ouvert = tours.findIndex(t => ordreDuTour(participants, t.flight, t.mouvement, t.essai).some(e => !e.juge));
  return ouvert >= 0 ? ouvert : Math.max(0, tours.length - 1);
}

/** Un tour est fini quand quelqu'un y est passé et que tous sont jugés. */
export function tourFini(participants: Inscrit[], tour: Tour): boolean {
  const file = ordreDuTour(participants, tour.flight, tour.mouvement, tour.essai);
  return file.length > 0 && file.every(e => e.juge);
}

export const memeTour = (a: Tour | undefined, b: Tour | undefined) =>
  !!a && !!b && a.flight === b.flight && a.mouvement === b.mouvement && a.essai === b.essai;

/** Le plan d'un essai tel qu'il se lit : pour chaque tier, sa charge propre,
 *  sinon celle héritée des essais précédents (`chainedInheritedTiers`). */
export function planDeLEssai(attempts: CompAttempt[], ai: number): EffectiveTiers {
  const propre = effectiveTiers(attempts[ai]) ?? { pessimistic: 0, realistic: 0, optimistic: 0 };
  const herite = chainedInheritedTiers(attempts, ai) ?? { pessimistic: 0, realistic: 0, optimistic: 0 };
  return {
    pessimistic: propre.pessimistic || herite.pessimistic,
    realistic: propre.realistic || herite.realistic,
    optimistic: propre.optimistic || herite.optimistic,
  };
}

/** Annoncer un tier : la charge de l'essai devient celle du plan. Re-cliquer le
 *  tier annoncé retire l'annonce. `null` quand la charge manque ou baisse. */
export function annoncer<A extends CompAttempt>(attempts: A[], ai: number, tier: AttemptTier): A | null {
  const essai = attempts[ai];
  if (essai.selectedTier === tier) return { ...essai, selectedTier: null, weight: 0 } as A;
  const plan = planDeLEssai(attempts, ai);
  if (!(plan[tier] > 0) || plan[tier] < plancherDAnnonce(attempts, ai)) return null;
  // Le plan hérité s'écrit sur l'essai : c'est lui qu'on vient d'annoncer.
  return { ...essai, weights: plan, selectedTier: tier, weight: plan[tier] } as A;
}

/** Annoncer une charge hors plan. `null` sous le plancher : une annonce ne baisse pas.
 *
 *  ⚠️ LA CHARGE S'ÉCRIT DANS LE TIER ANNONCÉ (le R à défaut), et le plan bouge.
 *  `chargeAnnoncee` ne lit `weight` que lorsqu'un tier est choisi : une charge
 *  libre posée sans tier ferait calculer l'ordre de barre sur le R du plan, une
 *  charge que personne n'annonce. */
export function annonceLibre<A extends CompAttempt>(attempts: A[], ai: number, charge: number): A | null {
  if (!(charge > 0) || charge < plancherDAnnonce(attempts, ai)) return null;
  const essai = attempts[ai];
  const tier: AttemptTier = essai.selectedTier ?? 'realistic';
  return { ...essai, weights: { ...planDeLEssai(attempts, ai), [tier]: charge }, selectedTier: tier, weight: charge } as A;
}
