import { describe, expect, it } from 'vitest';

import { demarrerLeChrono, ecouleMs, formatChrono, mettreEnPause, reprendre } from '@/lib/chrono';

/** LE CHRONO. Ce qu'un écran ne montre pas : qu'il reste juste après une longue
 *  absence, et qu'une pause ne compte pas. */

const t0 = 1_000_000;

describe('le chrono', () => {
  it('compte depuis son départ, même après une longue absence', () => {
    // ⚠️ AUCUN TIC ENTRE LES DEUX : c'est l'application quittée pendant 10 minutes.
    const c = demarrerLeChrono(t0);
    expect(formatChrono(ecouleMs(c, t0 + 600_000))).toBe('10:00');
  });

  it('une pause fige le temps, la reprise repart de là', () => {
    const enPause = mettreEnPause(demarrerLeChrono(t0), t0 + 30_000);
    expect(ecouleMs(enPause, t0 + 90_000)).toBe(30_000);
    const repris = reprendre(enPause, t0 + 90_000);
    expect(ecouleMs(repris, t0 + 95_000)).toBe(35_000);
  });

  it('mettre en pause deux fois ne perd rien, reprendre deux fois non plus', () => {
    const p = mettreEnPause(demarrerLeChrono(t0), t0 + 10_000);
    expect(mettreEnPause(p, t0 + 50_000)).toEqual(p);
    const r = reprendre(p, t0 + 20_000);
    expect(reprendre(r, t0 + 40_000)).toEqual(r);
  });
});

describe('formatChrono', () => {
  it('minutes et secondes, puis heures', () => {
    expect(formatChrono(0)).toBe('0:00');
    expect(formatChrono(67_900)).toBe('1:07');
    expect(formatChrono(3_727_000)).toBe('1:02:07');
  });
});
