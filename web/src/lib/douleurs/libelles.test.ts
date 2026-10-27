import { describe, expect, it } from 'vitest';

import { libelleDExercice } from './libelles';

const ligne = { name: 'MUSCLE UP', variant: ['Strict'], sets: '5', reps: '3', weight: '6', format: null };

describe('la ligne de séance sur une note de douleur', () => {
  it('mouvement, variantes, schéma, charge, format — dans cet ordre', () => {
    expect(libelleDExercice({ ...ligne, format: 'EMOM' })).toBe('MUSCLE UP Strict · 5×3 @ 6 kg · EMOM');
  });

  it('sans variante ni format, rien ne traîne', () => {
    expect(libelleDExercice({ ...ligne, variant: [], format: null })).toBe('MUSCLE UP · 5×3 @ 6 kg');
  });

  it('le poids du corps reste un mot : « PDC », pas « PDC kg »', () => {
    expect(libelleDExercice({ ...ligne, weight: 'PDC' })).toBe('MUSCLE UP Strict · 5×3 @ PDC');
  });

  it('une ligne sans charge ni reps garde ce qu’elle a', () => {
    expect(libelleDExercice({ name: 'FACE PULL', variant: [], sets: '3', reps: null, weight: null, format: null }))
      .toBe('FACE PULL · 3');
  });
});
