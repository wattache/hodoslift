import { describe, expect, it } from 'vitest';

import { blocDuJour, evenementsDuJour, moisVoisin, semainesDuMois } from './calendrier-mois';
import type { BandeDeBloc, EvenementDeFrise } from './frise-periodisation';

describe('le mois du calendrier', () => {
  it('commence un lundi, finit un dimanche, et couvre tout le mois', () => {
    /** Octobre 2026 commence un jeudi : la grille part du lundi 28 septembre. */
    const semaines = semainesDuMois('2026-10-15');
    expect(semaines[0][0]).toBe('2026-09-28');
    expect(semaines.every(s => s.length === 7)).toBe(true);
    const jours = semaines.flat();
    expect(jours).toContain('2026-10-01');
    expect(jours).toContain('2026-10-31');
    expect(jours.at(-1)).toBe('2026-11-01');
  });

  it('passe d’un mois à l’autre, années comprises', () => {
    expect(moisVoisin('2026-12-10', 1)).toBe('2027-01-01');
    expect(moisVoisin('2026-01-31', -1)).toBe('2025-12-01');
  });

  it('dit le bloc et les évènements de chaque jour, compétition en tête', () => {
    const bloc = { id: 'b', debut: '2026-10-05', fin: '2026-10-25' } as BandeDeBloc;
    expect(blocDuJour('2026-10-05', [bloc])?.id).toBe('b');
    expect(blocDuJour('2026-10-26', [bloc])).toBeNull();
    const ev = (id: string, nature: 'competition' | 'evenement', debut: string, fin = debut) =>
      ({ id, nature, debut, fin }) as EvenementDeFrise;
    expect(evenementsDuJour('2026-10-04', [ev('vac', 'evenement', '2026-10-01', '2026-10-07'), ev('euros', 'competition', '2026-10-02', '2026-10-04')])
      .map(e => e.id)).toEqual(['euros', 'vac']);
  });
});
