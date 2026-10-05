import { describe, expect, it } from 'vitest';

import type { Macrocycle } from '@/api/types';
import { apercuDepuis } from './reglage-progression';

/** L'APERÇU DU RÉGLAGE CHOISIT UN EXERCICE CHARGÉ (William, 28/09 : sur sa
 *  fiche, l'exercice retenu était à l'élastique, et l'aperçu ne disait rien de
 *  la charge). Le plus de semaines en kilos, dans le bloc le plus récent qui en
 *  a au moins deux ; sans candidat, `null` — et l'écran montre l'exemple. */

const exo = (name: string, weight: string, assistance = '') =>
  ({ id: `${name}-${weight}`, name, variant: [], tier: 1, sets: '3', reps: '5', weight, assistance, repsDone: '', weightDone: '', feltRPE: '' });
const semaine = (weekNumber: number, exercises: ReturnType<typeof exo>[]) =>
  ({ id: `s${weekNumber}`, weekNumber, sessions: [{ id: `seance-${weekNumber}`, name: 'Push', exercises }] });
const macro = (...blocks: unknown[]) => [{ blocks }] as unknown as Macrocycle[];

describe('apercuDepuis', () => {
  it('préfère l’exercice qui porte des kilos à celui qui porte un élastique', () => {
    /** MUTATION QUI ROUGIT : compter l'assistance comme une charge. */
    const macros = macro({ weeks: [
      semaine(1, [exo('MUSCLE UP', '', 'RB30'), exo('DIPS', '20')]),
      semaine(2, [exo('MUSCLE UP', '', 'RB20'), exo('DIPS', '22.5')]),
    ] });
    expect(apercuDepuis(macros)?.titre).toBe('DIPS');
  });

  it('prend le bloc le plus récent qui a au moins deux semaines, et la dernière semaine faite comme courante', () => {
    const macros = macro(
      { weeks: [semaine(1, [exo('SQUAT', '100')]), semaine(2, [exo('SQUAT', '105')])] },
      { weeks: [semaine(1, [exo('DEADLIFT', '140')])] },
    );
    const apercu = apercuDepuis(macros);
    expect(apercu?.titre).toBe('SQUAT');
    expect(apercu?.points.map(p => p.kgEffective)).toEqual([100, 105]);
  });

  it('rend null sans deux semaines chargées : l’écran montre l’exemple', () => {
    expect(apercuDepuis(macro({ weeks: [semaine(1, [exo('SQUAT', '100')]), semaine(2, [exo('SQUAT', '')])] }))).toBeNull();
    expect(apercuDepuis([])).toBeNull();
  });
});
