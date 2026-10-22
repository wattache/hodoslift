import { describe, expect, it } from 'vitest';

import type { SessionEditing, WeekEditing } from '@/api/types';
import { buildExerciseProgressionPoints } from './exercise-progression-data';

/** UN « 0 » PRESCRIT EST UN POINT DE LA COURBE, pas un trou : au poids du corps.
 *  Avec une bande, la bande s'écrit à sa place, comme avant. */
const seance = (weight: string, assistance = '') => ({
  id: 's', name: 'Mardi', exercises: [{ name: 'CHIN UP', variant: [], tier: 2, weight, assistance }],
}) as unknown as SessionEditing;
const semaine = (n: number, s: SessionEditing) => ({ id: `w${n}`, weekNumber: n, sessions: [s] }) as unknown as WeekEditing;

describe('la charge de chaque semaine', () => {
  it('0 sans bande vaut 0 kg ; vide reste un trou ; 0 avec bande laisse la bande', () => {
    /** MUTATION QUI ROUGIT : `prescrit` qui confond 0 et vide. */
    const points = buildExerciseProgressionPoints(seance('0'), 0, [
      semaine(1, seance('')), semaine(2, seance('0')), semaine(3, seance('0', 'RB15')), semaine(4, seance('5')),
    ]);
    expect(points.map(p => p.kgEffective)).toEqual([null, 0, null, 5]);
    expect(points[2].assistance).toBe('RB15');
  });
});
