// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import { DonneesDeLAthlete } from './donnees-de-l-athlete';
import type { Participant } from './types';

await i18next.changeLanguage('fr');
afterEach(cleanup);

/** LE POIDS DU JOUR SE TAPE AVEC SA VIRGULE (William, 03/10, en pleine pesée).
 *  Le champ renvoyait le NOMBRE lu à chaque frappe : « 79, » ne se lit pas,
 *  donc le poids retombait à rien et le champ se vidait — impossible de taper
 *  « 79,5 ». Ce qui s'affiche est ce qu'on tape ; ce qui part est ce qui se lit. */

function Banc({ depart }: { depart?: number }) {
  const [p, setP] = useState<Participant>({ name: 'Aubin', bodyweight: depart, score: 0, movements: [] });
  return (
    <>
      <DonneesDeLAthlete p={p} categories={{ M: [], F: [] }} jours={null} onChange={patch => setP(x => ({ ...x, ...patch }))} onRemove={() => {}} />
      <output data-testid="poids">{p.bodyweight ?? 'aucun'}</output>
    </>
  );
}
const champ = () => screen.getByRole('textbox', { name: /Poids du jour/ }) as HTMLInputElement;
const taper = (texte: string) => fireEvent.change(champ(), { target: { value: texte } });

describe('le poids du jour', () => {
  it('se tape avec une virgule, chiffre après chiffre', () => {
    render(<Banc />);
    taper('7'); taper('79'); taper('79,');
    expect(champ().value).toBe('79,');
    expect(screen.getByTestId('poids').textContent).toBe('79');
    taper('79,5');
    expect(champ().value).toBe('79,5');
    expect(screen.getByTestId('poids').textContent).toBe('79.5');
  });

  it('avec un point aussi', () => {
    render(<Banc />);
    taper('86.'); taper('86.4');
    expect(champ().value).toBe('86.4');
    expect(screen.getByTestId('poids').textContent).toBe('86.4');
  });

  it('vidé, le poids disparaît', () => {
    render(<Banc depart={79} />);
    expect(champ().value).toBe('79');
    taper('');
    expect(champ().value).toBe('');
    expect(screen.getByTestId('poids').textContent).toBe('aucun');
  });
});
