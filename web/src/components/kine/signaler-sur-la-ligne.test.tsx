// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Douleur, ExerciseEditing } from '@/api/types';
import i18n from '@/i18n';
import { SignalerSurLaLigne } from './signaler-sur-la-ligne';

/** SIGNALER UNE GÊNE DEPUIS LA LIGNE : ce que la note EMPORTE.
 *
 *  Le volet réutilise la figure et le sélecteur de l'onglet Douleurs ; ce qui
 *  lui est propre, et que ces specs gardent, c'est le contenu de l'appel : le
 *  JOUR DE LA SÉANCE (pas aujourd'hui), « entraîné » sans l'avoir demandé, et
 *  la LIGNE. Vues rouges : `jour` remplacé par aujourd'hui, `entrainement`
 *  retiré, `exercice` retiré. */

const appels = vi.hoisted(() => ({
  noter: vi.fn(async () => ({ ok: true })),
  declarer: vi.fn(async () => ({ id: 'dlr-neuve' })),
}));
vi.mock('@/api/hooks/use-douleurs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/hooks/use-douleurs')>();
  return {
    ...mod,
    useDouleurs: () => ({ data: douleurs }),
    useNoterDouleur: () => ({ mutateAsync: appels.noter, isPending: false }),
    useDeclarerEtNoter: () => ({ mutateAsync: appels.declarer, isPending: false }),
  };
});

const douleurs: Douleur[] = [
  { id: 'dlr-1', nom: 'Mon épaule', zones: ['deltoid-anterior:droite'], debut: null, fin: null,
    logs: 4, recurrente: true,
    derniere: { date: '2026-10-24', intensite: 6, commentaire: null, exercices: [
      { exerciseId: 'ex-1', name: 'MUSCLE UP', variant: [], tempo: null, format: null,
        sets: '5', reps: '3', weight: '6', ligneVivante: true }] } },
];

const ligne: ExerciseEditing = {
  id: 'ex-1', name: 'MUSCLE UP', variant: ['Strict'], sets: '5', reps: '3', weight: '6',
  weightDone: '7', tier: 1,
} as ExerciseEditing;

function rendre(props: Partial<Parameters<typeof SignalerSurLaLigne>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SignalerSurLaLigne athleteId="a1" ligne={ligne} jour="2026-10-25" peutEcrire {...props} />
    </MemoryRouter>,
  );
}

const zone = (nom: RegExp) => screen.getAllByRole('button', { name: nom })[0];

beforeAll(async () => {
  await i18n.changeLanguage('fr');
  // jsdom n'a pas de défilement : la figure s'y amène quand elle se compacte.
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); appels.noter.mockClear(); appels.declarer.mockClear(); });

describe('ce que la ligne montre', () => {
  it('le staff voit la gêne déjà notée sur cette ligne, jamais le bouton', () => {
    const { container } = rendre({ peutEcrire: false });
    expect(container.querySelector('[data-gene-notee]')!.textContent).toContain('Mon épaule');
    expect(container.querySelector('[data-gene-notee]')!.textContent).toContain('6/10');
    expect(container.querySelector('[data-signaler-gene]')).toBeNull();
  });

  it('une ligne pas encore enregistrée (sans identifiant) ne propose rien', () => {
    const { container } = rendre({ ligne: { ...ligne, id: undefined } });
    expect(container.querySelector('[data-signaler-gene]')).toBeNull();
    expect(container.querySelector('[data-gene-notee]')).toBeNull();
  });
});

describe('ce que la note emporte', () => {
  it('toucher la zone DÉJÀ suivie note cette douleur : le jour de la séance, entraîné, la ligne', async () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-signaler-gene]')!);
    // Le volet dit sur quelle ligne — avec le réalisé (7 kg), pas le prescrit.
    expect(screen.getByRole('dialog').textContent).toContain('MUSCLE UP Strict · 5×3 @ 7 kg');
    fireEvent.click(zone(/Deltoïde antérieur droite/));
    // La même liste que dans l'onglet : « Mon épaule » proposée d'abord.
    expect(screen.getByRole('heading', { name: 'À quelle douleur rattacher ?' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Mon épaule/ }).getAttribute('aria-checked')).toBe('true');
    // La question « entraîné ? » n'est pas posée : aucun bouton Repos.
    expect(screen.queryByRole('button', { name: /^Repos$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer la note/ }));
    await waitFor(() => expect(appels.noter).toHaveBeenCalledTimes(1));
    expect(appels.noter).toHaveBeenCalledWith({
      // ⚠️ LA DERNIÈRE NOTE EST REPRISE (6, la veille) : le cas courant est
      // la même épaule qui gêne encore.
      id: 'dlr-1', jour: '2026-10-25', intensite: 6, commentaire: null, entrainement: true,
      exercice: { exerciseId: 'ex-1' },
    });
    expect(appels.declarer).not.toHaveBeenCalled();
  });

  it('toucher une zone LIBRE déclare puis note, avec la ligne et le jour de la séance', async () => {
    const { container } = rendre();
    fireEvent.click(container.querySelector('[data-signaler-gene]')!);
    fireEvent.click(zone(/^Pectoraux droite/));
    expect(screen.getByRole('heading', { name: 'Nouvelle douleur' })).toBeTruthy();
    const suivre = screen.getByRole('button', { name: /Suivre cette douleur/ });
    expect((suivre as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/appeler cette douleur/), { target: { value: 'Petit pec' } });
    fireEvent.click(suivre);
    await waitFor(() => expect(appels.declarer).toHaveBeenCalledTimes(1));
    expect(appels.declarer).toHaveBeenCalledWith({
      nom: 'Petit pec', zones: ['chest:droite'], jour: '2026-10-25', intensite: 3, commentaire: null,
      entrainement: true, exercice: { exerciseId: 'ex-1' },
    });
    expect(appels.noter).not.toHaveBeenCalled();
  });
});
