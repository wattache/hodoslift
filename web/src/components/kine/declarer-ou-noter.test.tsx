// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import type { Douleur } from '@/api/types';
import i18n from '@/i18n';
import { DeclarerOuNoter } from './declarer-ou-noter';

/** « À QUELLE DOULEUR ? » EST UNE LISTE (FRE-196) : une zone peut porter
 *  plusieurs douleurs vivantes, et l'écran doit toutes les proposer — l'ancien
 *  n'en tenait qu'une, plus « nouvelle ».
 *  MUTATION QUI ROUGIT : ne garder que la première candidate. */
vi.mock('@/api/hooks/use-douleurs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/hooks/use-douleurs')>()),
  useNoterDouleur: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeclarerEtNoter: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const douleur = (id: string, nom: string, zones: string[], date: string, intensite: number): Douleur => ({
  id, nom, zones, debut: null, fin: null, logs: 1, recurrente: false,
  derniere: { date, intensite, commentaire: null, exercices: [] },
});

beforeAll(async () => { await i18n.changeLanguage('fr'); });
afterEach(cleanup);

it('une zone portée par DEUX douleurs les propose toutes, la plus récemment notée d’abord', () => {
  render(<DeclarerOuNoter athleteId="a" jour="2026-10-28" zones={['biceps:droite']}
                          vivantes={[
                            douleur('d1', 'Mon épaule', ['deltoids:droite', 'biceps:droite'], '2026-10-20', 3),
                            douleur('d2', 'Claquage', ['biceps:droite'], '2026-10-27', 5),
                          ]}
                          onFini={() => {}} onAnnuler={() => {}} />);
  const radios = screen.getAllByRole('radio');
  expect(radios.map(r => r.textContent)).toEqual([
    expect.stringContaining('Claquage'), expect.stringContaining('Mon épaule'),
    expect.stringContaining('nouvelle douleur'),
  ]);
  expect(radios[0].getAttribute('aria-checked')).toBe('true');
  // Choisir l'autre reprend SA dernière note.
  fireEvent.click(radios[1]);
  expect(screen.getByRole('button', { name: /Enregistrer la note \(3\/10\)/ })).toBeTruthy();
});
