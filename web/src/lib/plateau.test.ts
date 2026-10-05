import { describe, expect, it } from 'vitest';

import type { CompAttempt } from '@/api/types';
import { chargeAnnoncee, sequenceDesTours } from '@/lib/comp-helpers';
import { annonceLibre, annoncer, planDeLEssai, tourDuPlateau, tourFini } from '@/lib/plateau';

const essai = (o: Partial<CompAttempt> = {}): CompAttempt => ({ weight: 0, result: '', ...o });
const plan = (p: number, r: number, o: number) => ({ weights: { pessimistic: p, realistic: r, optimistic: o } });
const inscrit = (flight: string | null, attempts: CompAttempt[]) => ({ flight, movements: [{ name: 'SQUAT', attempts }] });

describe('tourDuPlateau', () => {
  const tours = (ps: ReturnType<typeof inscrit>[]) => sequenceDesTours(ps, ['A', 'B'], ['SQUAT'], 2);

  it('le premier tour de la séquence où quelqu’un attend son verdict', () => {
    const ps = [inscrit('A', [essai({ result: 'rep' }), essai({ result: 'rep' })]), inscrit('B', [essai({ result: 'rep' }), essai()])];
    const t = tours(ps);
    expect(t[tourDuPlateau(ps, t)]).toEqual({ flight: 'B', mouvement: 'SQUAT', essai: 1 });
  });

  it('tout est jugé : le dernier tour', () => {
    const ps = [inscrit('A', [essai({ result: 'rep' }), essai({ result: 'norep' })])];
    const t = tours(ps);
    expect(tourDuPlateau(ps, t)).toBe(t.length - 1);
  });

  it('un tour sans personne ne retient pas le plateau', () => {
    /** MUTATION QUI ROUGIT : tenir pour ouvert un tour dont la file est vide. */
    const ps = [inscrit('A', [essai({ result: 'rep' })]), inscrit('B', [essai(), essai()])];
    const t = tours(ps);
    expect(t[tourDuPlateau(ps, t)]).toEqual({ flight: 'B', mouvement: 'SQUAT', essai: 0 });
    expect(tourFini(ps, { flight: 'A', mouvement: 'SQUAT', essai: 1 })).toBe(false);
  });
});

describe('annoncer', () => {
  it('la charge du tier devient celle de l’essai, et le plan hérité s’y écrit', () => {
    const essais = [essai({ ...plan(100, 105, 110), selectedTier: 'realistic', weight: 105, result: 'rep' }), essai()];
    expect(annoncer(essais, 1, 'optimistic')).toMatchObject({ selectedTier: 'optimistic', weight: 110, weights: { realistic: 105 } });
  });

  it('re-cliquer le tier annoncé retire l’annonce', () => {
    const essais = [essai({ ...plan(100, 105, 110), selectedTier: 'realistic', weight: 105 })];
    expect(annoncer(essais, 0, 'realistic')).toMatchObject({ selectedTier: null, weight: 0 });
  });

  it('refusé sous le plancher : une annonce ne baisse pas', () => {
    const essais = [essai({ weight: 105, selectedTier: 'realistic', ...plan(100, 105, 110) }), essai(plan(100, 110, 115))];
    expect(annoncer(essais, 1, 'pessimistic')).toBeNull();
    expect(annoncer(essais, 1, 'realistic')).not.toBeNull();
  });
});

describe('annonceLibre', () => {
  it('la charge s’écrit dans le tier annoncé, et c’est elle que montre la case', () => {
    /** ⚠️ LE PIÈGE DU BRIEF : `chargeAnnoncee` ne lit `weight` que si un tier est
     *  choisi. MUTATION QUI ROUGIT : poser `weight` sans `selectedTier` — la case
     *  et l'ordre de barre montreraient le R du plan, 105, que personne n'annonce. */
    const essais = [essai(plan(100, 105, 110))];
    const libre = annonceLibre(essais, 0, 107.5)!;
    expect(chargeAnnoncee([libre], 0)).toBe(107.5);
    expect(libre).toMatchObject({ selectedTier: 'realistic', weights: { pessimistic: 100, realistic: 107.5, optimistic: 110 } });
  });

  it('garde le tier déjà annoncé', () => {
    const essais = [essai({ ...plan(100, 105, 110), selectedTier: 'optimistic', weight: 110 })];
    expect(annonceLibre(essais, 0, 112)).toMatchObject({ selectedTier: 'optimistic', weight: 112, weights: { optimistic: 112 } });
  });

  it('refusée sous le plancher, AVANT tout envoi', () => {
    /** MUTATION QUI ROUGIT : ne pas comparer au plancher — brokkr répondrait 422. */
    const essais = [essai({ weight: 105, selectedTier: 'realistic', ...plan(100, 105, 110) }), essai()];
    expect(annonceLibre(essais, 1, 102.5)).toBeNull();
    expect(annonceLibre(essais, 1, 105)).toMatchObject({ weight: 105 });
  });

  it('une charge nulle ou illisible n’est pas une annonce', () => {
    expect(annonceLibre([essai()], 0, 0)).toBeNull();
    expect(annonceLibre([essai()], 0, Number.NaN)).toBeNull();
  });
});

describe('le plan', () => {
  it('se lit tier par tier : propre, sinon hérité', () => {
    const essais = [essai(plan(100, 105, 110)), essai(plan(0, 107.5, 0))];
    expect(planDeLEssai(essais, 1)).toEqual({ pessimistic: 100, realistic: 107.5, optimistic: 110 });
  });
});
