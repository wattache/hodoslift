// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import '@/i18n';
import { PrincipleRow, type CoachLib } from './block-base-editor';
import type { Principle } from '@/api/types';

beforeAll(async () => { await i18next.changeLanguage('fr'); });
afterEach(cleanup);

const lib: CoachLib = { principaux: [], renforcement: [], variantes: [], assistances: [], tempos: [], formats: [] };
const principe = (tier: number) => ({ id: 'p', name: 'PULL UP', tier, variant: [], sets: '3', reps: '8', kind: 'training' } as unknown as Principle);
const rien = () => {};

describe('le tier d’un principe', () => {
  it('se montre tel qu’il est, même absent de la répartition — et le dit', () => {
    /** Ignacy, bloc 3 : PULL UP en 1 au vendredi, principe en 2. Le sélecteur
     *  affichait « 1 » (la seule option), et aucune ligne n'était générée.
     *  MUTATION QUI ROUGIT : ne proposer que les tiers de la répartition. */
    render(<PrincipleRow p={principe(2)} lib={lib} usedTiers={new Set([1])} onUpdate={rien} onSetKind={rien} onRemove={rien} />);
    const select = screen.getByLabelText('Tier') as HTMLSelectElement;
    expect(select.value).toBe('2');
    expect([...select.options].map(o => o.value)).toEqual(['1', '2']);
    expect(screen.getByRole('note').textContent).toMatch(/Tier 2 absent de la répartition/);
  });

  it('un principe apparié ne porte aucun avertissement', () => {
    render(<PrincipleRow p={principe(1)} lib={lib} usedTiers={new Set([1])} onUpdate={rien} onSetKind={rien} onRemove={rien} />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
