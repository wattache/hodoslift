// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEcranAllume } from './ecran-allume';

function faux() {
  const verrous: { released: boolean; release: () => Promise<void> }[] = [];
  const request = vi.fn(async () => {
    const v = { released: false, release: vi.fn(async () => { v.released = true; }) };
    verrous.push(v);
    return v;
  });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  return { request, verrous };
}
const visibilite = (etat: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: etat, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => visibilite('visible'));
afterEach(cleanup);

describe('l’écran reste allumé pendant le chrono', () => {
  it('le verrou se prend quand le chrono tourne, et se rend à la pause', async () => {
    /** MUTATION QUI ROUGIT : ne jamais rendre le verrou — l'écran resterait allumé en pause. */
    const { request, verrous } = faux();
    const { rerender } = renderHook(({ actif }) => useEcranAllume(actif), { initialProps: { actif: true } });
    await act(async () => {});
    expect(request).toHaveBeenCalledWith('screen');
    rerender({ actif: false });
    await act(async () => {});
    expect(verrous[0].released).toBe(true);
  });

  it('relâché par le système en arrière-plan, il se redemande au retour', async () => {
    /** MUTATION QUI ROUGIT : ne demander qu'au montage — après un passage dans une autre app, l'écran se remet en veille. */
    const { request, verrous } = faux();
    renderHook(() => useEcranAllume(true));
    await act(async () => {});
    verrous[0].released = true;
    visibilite('hidden');
    await act(async () => { visibilite('visible'); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('sans l’API, rien ne casse', () => {
    Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
    expect(() => renderHook(() => useEcranAllume(true))).not.toThrow();
  });
});
