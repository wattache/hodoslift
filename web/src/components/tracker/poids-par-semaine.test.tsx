// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import type { PoidsSemaines } from '@/api/types';
import { TableauDesSemaines } from './poids-par-semaine';

/** LE TABLEAU DU POIDS PAR SEMAINE — il écrit ce que brokkr a calculé, sans
 *  rien dériver : la moyenne, l'écart depuis le départ (kg et %), et la droite
 *  vers la pesée quand elle existe. */

const donnees = (partiel: Partial<PoidsSemaines> = {}): PoidsSemaines => ({
  depart: { kg: 98, date: '2026-09-07' },
  cible: null,
  reference: 98,
  semaines: [
    { numero: 1, du: '2026-09-07', au: '2026-09-13', jours: 7, moyenne: 96.67, ecartKg: -1.33, ecartPct: -1.36, theorique: null, ecartTheorique: null, resteKg: null, cheminPct: null },
    { numero: 2, du: '2026-09-14', au: '2026-09-20', jours: 0, moyenne: null, ecartKg: null, ecartPct: null, theorique: null, ecartTheorique: null, resteKg: null, cheminPct: null },
    { numero: 3, du: '2026-09-21', au: '2026-09-27', jours: 4, moyenne: 96.15, ecartKg: -1.85, ecartPct: -1.89, theorique: null, ecartTheorique: null, resteKg: null, cheminPct: null },
  ],
  ...partiel,
});

beforeAll(async () => { await i18n.changeLanguage('fr'); });
afterEach(cleanup);

const textes = (c: HTMLElement, sel: string) => [...c.querySelectorAll(sel)].map(e => e.textContent);

describe('le tableau des semaines', () => {
  it('écrit la moyenne, le nombre de pesées, et l’écart depuis le départ en kg et en %', () => {
    const { container } = render(<TableauDesSemaines donnees={donnees()} />);
    expect(textes(container, '[data-moyenne]')).toEqual(['96,67', '—', '96,15']);
    expect(textes(container, '[data-ecart]')).toEqual(['−1,33 kg', '—', '−1,85 kg']);
    expect(container.textContent).toContain('7 pesées');
    expect(container.textContent).toContain('−1,36 %');
  });

  it('avec une cible, le tableau garde UNE colonne de mesure : ce qui a été perdu depuis le départ', () => {
    /** Ce qui reste jusqu'à la pesée vit dans le cadre « Pesée visée », pas
     *  dans le tableau (William, 29/09). */
    const d = donnees({
      cible: { kg: 94, date: '2026-10-25', competition: 'Open', categorie: '-94' },
      semaines: donnees().semaines.map(s => ({ ...s, resteKg: s.moyenne == null ? null : Math.round((s.moyenne - 94) * 100) / 100, cheminPct: 30 })),
    });
    const { container } = render(<TableauDesSemaines donnees={d} />);
    expect(container.querySelector('[data-reste]')).toBeNull();
    expect(container.querySelector('[data-theorique]')).toBeNull();
    expect(container.querySelectorAll('thead th')).toHaveLength(4);
    expect(textes(container, '[data-ecart]')).toEqual(['−1,33 kg', '—', '−1,85 kg']);
  });

  it('sans aucune pesée, dit quoi faire au lieu d’un tableau vide', () => {
    const { container } = render(<TableauDesSemaines donnees={donnees({ semaines: [] })} />);
    expect(container.textContent).toContain('Aucune pesée');
    expect(container.querySelector('table')).toBeNull();
  });
});
