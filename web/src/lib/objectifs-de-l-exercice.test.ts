import { describe, expect, it } from 'vitest';

import type { BlockObjective } from '@/api/types';
import { objectifsDeLExercice } from './objectifs-de-l-exercice';

const o = (exercise: string, variant = '') => ({ id: '', exercise, variant, format: '', sets: '', reps: '',
  weightMin: '', weightMax: '', assistance: '' }) as BlockObjective;

describe('les objectifs du bloc pour un exercice', () => {
  it('garde le même mouvement, variante de la ligne en tête, sans ordre ni casse', () => {
    /** MUTATION QUI ROUGIT : comparer les mouvements à la casse près. */
    const liste = [o('PULL UP'), o('MUSCLE UP', ''), o('MUSCLE UP', 'ds + CHEST'), o('DIPS')];
    const r = objectifsDeLExercice(liste, { name: 'muscle up', variant: ['CHEST', 'DS'] });
    expect(r.map(x => x.variant)).toEqual(['ds + CHEST', '']);
  });

  it('rien pour une ligne sans nom ou un bloc sans objectif', () => {
    expect(objectifsDeLExercice([o('SQUAT')], { name: '' })).toEqual([]);
    expect(objectifsDeLExercice(undefined, { name: 'SQUAT' })).toEqual([]);
  });
});
