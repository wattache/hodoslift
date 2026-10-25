// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { TrackingResponse, TrackingWeek } from '@/api/types';
import i18n from '@/i18n';
import { ProgressionDuMouvement } from './progression-du-mouvement';

/** LA PROGRESSION DU TRACKER : ce que l'écran dit d'un trou, et de rien d'autre.
 *
 *  Le cas principal est la vraie donnée du muscle up : `e1` nul sur les
 *  dernières semaines parce qu'aucune série n'est en forme de compétition. La
 *  courbe s'arrête, la fenêtre tiretée apparaît, la pastille et le chiffre du
 *  haut écrivent la RAISON — pas « arrêtée ». */

const reponse = vi.hoisted(() => ({ courante: null as TrackingResponse | null }));
vi.mock('@/api/hooks/use-tracking', () => ({
  useTracking: () => ({ data: reponse.courante, isLoading: false, isPlaceholderData: false }),
}));

function semaine(i: number, partiel: Partial<TrackingWeek> = {}): TrackingWeek {
  const d = new Date(Date.UTC(2026, 1, 16 + 7 * i));
  return {
    week: d.toISOString().slice(0, 10), chargeMaxKg: 5, tonnageAtMaxKg: 100, topSetFormat: '3×3',
    tonnageTotalKg: 700 + 50 * i, tonnagePrevuTotalKg: 700 + 50 * i, repsTotal: 10 + i, repsPrevuTotal: 10 + i,
    feltRpe: 7 + (i % 3) * 0.5, aimedRpe: 7.5, sessions: 2, fails: 0, failsAtMax: 0,
    macroNumber: i < 6 ? 1 : 2, blockNumber: i < 3 || (i >= 6 && i < 9) ? 1 : 2,
    lourdes: i % 3, e1Kg: 17 + (i % 4), intensite: 80 + (i % 3), e1Raison: null,
    ...partiel,
  };
}

const muscleUp = (): TrackingResponse => ({
  exercise: 'MUSCLE UP',
  exercises: [{ name: 'MUSCLE UP', count: 200 }, { name: 'SQUAT', count: 120 }],
  lastSessionDate: '2026-05-04', oneRmKg: 12, rpeBlocks: [], athleteWeeks: [], courbes: [], setsByMovement: [],
  auPoidsDuCorps: true,
  weeks: [
    ...Array.from({ length: 4 }, (_, i) => semaine(i)),
    // Un trou INTÉRIEUR : pas de RPE cette semaine-là.
    semaine(4, { e1Kg: null, intensite: null, e1Raison: 'sans_rpe' }),
    ...Array.from({ length: 3 }, (_, i) => semaine(5 + i)),
    // Et la FIN : quatre semaines sans forme de compétition.
    ...Array.from({ length: 4 }, (_, i) => semaine(8 + i, { e1Kg: null, intensite: null, e1Raison: 'variantes' })),
  ],
  refaits: [
    { competition: true, variant: [], tempo: null, format: null, sets: 3, reps: 3, lestKg: 5,
      points: [{ date: '2026-04-23', rpe: 10 }, { date: '2026-07-13', rpe: 7.5 }], delta: -2.5 },
    { competition: false, variant: ['NO DIPS'], tempo: null, format: 'EMOM', sets: 6, reps: 2, lestKg: 2.5,
      points: [{ date: '2026-06-26', rpe: 7 }, { date: '2026-08-14', rpe: 7.5 }], delta: 0.5 },
  ],
});

function rendre(data: TrackingResponse) {
  reponse.courante = data;
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}><ProgressionDuMouvement athleteId="a1" /></QueryClientProvider>,
  );
}

beforeAll(async () => { await i18n.changeLanguage('fr'); });
afterEach(cleanup);

describe('la force estimée quand plus rien ne s’estime', () => {
  it('la courbe se coupe sur le trou intérieur et s’arrête avant la fin : deux suites, deux fenêtres', () => {
    const { container } = rendre(muscleUp());
    const carte = container.querySelector('[data-carte="e1"]')!;
    expect(carte.querySelectorAll('[data-suite]')).toHaveLength(2);
    expect(carte.querySelectorAll('[data-fenetre]')).toHaveLength(2);
    expect(carte.textContent).toContain("pas d'estimation");
  });

  it('la pastille et le chiffre du haut disent POURQUOI, et depuis quand', () => {
    const { container } = rendre(muscleUp());
    const pastille = container.querySelector('[data-carte="e1"] [data-pastille]')!;
    expect(pastille.textContent).toContain('pas de série de compétition');
    expect(pastille.textContent).toContain('depuis le 6 avr.');
    const chiffre = container.querySelector('[data-chiffre]')!;
    expect(chiffre.textContent).toContain('1RM estimé (lest)');
    expect(chiffre.textContent).toContain('20,0');
    expect(chiffre.textContent).toContain('pas de série de compétition · depuis le 6 avr.');
  });

  it('une autre raison, un autre texte — « arrêtée » n’existe nulle part', () => {
    const data = muscleUp();
    data.weeks = data.weeks.map((w) => w.e1Raison === 'variantes' ? { ...w, e1Raison: 'sans_pesee' } : w);
    const { container } = rendre(data);
    expect(container.querySelector('[data-carte="e1"] [data-pastille]')!.textContent).toContain('pas de pesée');
    expect(container.textContent).not.toMatch(/arrêtée/);
  });

  it('sans aucun trou, ni fenêtre ni pastille, et deux repères : le meilleur et le dernier', () => {
    const data = muscleUp();
    data.weeks = data.weeks.map((w) => ({ ...w, e1Kg: 17, intensite: 80, e1Raison: null }));
    data.weeks[3].e1Kg = 21;
    const { container } = rendre(data);
    const carte = container.querySelector('[data-carte="e1"]')!;
    expect(carte.querySelector('[data-fenetre]')).toBeNull();
    expect(carte.querySelector('[data-pastille]')).toBeNull();
    expect(carte.querySelectorAll('[data-repere]')).toHaveLength(2);
    expect(container.querySelector('[data-chiffre]')!.textContent).toContain('meilleur estimé');
  });
});

describe('les six cartes', () => {
  it('six cartes, une mesure chacune, et les mêmes bandes de bloc sur toutes', () => {
    const { container } = rendre(muscleUp());
    const cartes = container.querySelectorAll('[data-carte]');
    expect(cartes).toHaveLength(6);
    const bandes = [...cartes].map((c) => [...c.querySelectorAll('span')].map((s) => s.textContent).filter((t) => /^M\dB\d$/.test(t ?? '')).join(' '));
    expect(bandes[0]).toBe('M1B1 M1B2 M2B1 M2B2');
    expect(new Set(bandes).size).toBe(1);
  });

  it('les barres partent de zéro vers un plafond rond, une courbe se cadre sur ses valeurs', () => {
    const { container } = rendre(muscleUp());
    const graduations = (cle: string) =>
      [...container.querySelector(`[data-carte="${cle}"]`)!.querySelectorAll('.font-mono.text-\\[9px\\] span')]
        .map((s) => s.textContent!.replace(/[\s\u202f\u00a0]/g, ' ')).slice(0, 3);
    expect(graduations('tonnage')).toEqual(['1 500', '750', '0']);
    expect(graduations('intensite')).toEqual(['82', '81', '80']);
  });

  it('« chez toi » : une phrase, avec l’écart brut, jamais un pourcentage', () => {
    const { container } = rendre(muscleUp());
    const chezToi = container.querySelector('[data-carte="tonnage"] [data-chez-toi]')!.textContent!;
    expect(chezToi).toMatch(/^\d[\d\s ]* kg au début, \d[\d\s ]* kg sur les 6 dernières semaines mesurées\.$/);
    expect(container.textContent).not.toMatch(/%\s*vs/);
    expect(screen.getAllByText(/vs les 6 premières/).length).toBeGreaterThan(0);
  });
});

describe('même charge, même format', () => {
  it('se replie sous trois lignes plutôt que d’afficher deux lignes seules', () => {
    const { container } = rendre(muscleUp());
    const section = container.querySelector('[data-refaits]')!;
    expect(section.querySelector('details')).not.toBeNull();
    expect(section.querySelector('details')!.hasAttribute('open')).toBe(false);
    expect(section.querySelectorAll('[data-refait]')).toHaveLength(2);
    expect(section.textContent).toContain('2 travaux refaits');
  });

  it('s’ouvre dès trois lignes, du plus grand progrès au plus grand recul, le delta signé', () => {
    const data = muscleUp();
    data.refaits = [...data.refaits, { competition: false, variant: [], tempo: 'DS', format: null, sets: 4, reps: 3, lestKg: 5,
      points: [{ date: '2026-09-18', rpe: 8.5 }, { date: '2026-10-05', rpe: 7 }], delta: -1.5 }];
    const { container } = rendre(data);
    const section = container.querySelector('[data-refaits]')!;
    expect(section.querySelector('details')).toBeNull();
    expect([...section.querySelectorAll('[data-delta]')].map((d) => d.textContent)).toEqual(['−2,5', '+0,5', '−1,5']);
    expect(section.textContent).toContain('3×3 @ 5 kg');
    expect(section.textContent).toContain('compétition');
    expect(section.textContent).toContain('NO DIPS · EMOM');
    expect(section.textContent).toContain('23 avr. @10 → 13 juil. @7,5');
  });

  it('absente sans aucun travail refait', () => {
    const data = muscleUp();
    data.refaits = [];
    const { container } = rendre(data);
    expect(container.querySelector('[data-refaits]')).toBeNull();
  });
});
