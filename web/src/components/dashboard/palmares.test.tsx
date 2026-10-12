// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MemoryRouter, Route, Routes } from 'react-router-dom';

import '@/i18n';
import { Palmares } from './palmares';
import { RmPercentageTable } from './rm-percentage-table';
import type { Palmares as PalmaresDoc } from '@/api/types';

beforeAll(async () => { await i18next.changeLanguage('fr'); });
afterEach(() => { cleanup(); try { window.localStorage.removeItem("eitri-palmares-historique"); } catch { /* pas de stockage */ } });

const doc: PalmaresDoc = {
  genre: 'M', categorie: '-80', total: 544, ris: 108.92,
  records: [
    { mouvement: 'SQUAT', charge: 235, date: '2026-10-04', source: 'competition', contexte: 'EUROS 2026' },
    { mouvement: 'MUSCLE UP', charge: 47.5, date: null, source: 'manuel', contexte: null },
  ],
  competitions: [{ id: 'e', nom: 'EUROS 2026', date: '2026-10-02', total: 544, ris: 108.92, place: 1, classes: 6 }],
  unRm: { muscleUp: 50, squat: 235 },
};

describe('le palmarès', () => {
  it('dit chaque single par mouvement, dans l’ordre des mouvements, avec d’où il vient', () => {
    render(<MemoryRouter><Palmares palmares={doc} /></MemoryRouter>);
    const region = screen.getByRole('region', { name: /Palmarès/ });
    expect(within(region).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Muscle-up47.5kgSaisi par le coach',
      expect.stringMatching(/^Squat235kgEUROS 2026 · oct\. 2026$/),
    ]);
    // H, pas « senior » : un genre et une catégorie.
    expect(within(region).getByText('H · -80 kg')).toBeTruthy();
  });

  it('l’historique se déplie, et une compétition mène à sa page', () => {
    render(<MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<Palmares palmares={doc} />} />
        <Route path="/competitions/:id" element={<p>page de la compétition</p>} />
      </Routes>
    </MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'EUROS 2026' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Historique des compétitions/ }));
    expect(screen.getByRole('row', { name: /EUROS 2026/ }).textContent).toMatch(/544 kg108\.92🥇1er \/ 6$/);
    fireEvent.click(screen.getByRole('link', { name: 'EUROS 2026' }));
    expect(screen.getByText('page de la compétition')).toBeTruthy();
  });
});

describe('la table RM', () => {
  it('affiche le 1RM effectif, mais édite la saisie du coach', () => {
    /** MUTATION QUI ROUGIT : éditer `oneRM` — le coach verrait 235 dans le
     *  champ et réécrirait le single comme saisie. */
    render(<RmPercentageTable oneRM={{ squat: 235 }} saisi={{ squat: 200 }} onUpdateOneRM={() => {}} athleteId="a" />);
    expect(screen.getAllByText('235').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /Éditer/ })[0]);
    expect(screen.getAllByRole('textbox').map(i => (i as HTMLInputElement).value)).toContain('200');
  });
});
