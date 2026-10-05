// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _reinitialiserPourTest, estEnLigne, signalerPanneReseau, signalerReseauRevenu, useEnLigne } from './reseau';

/** LE RÉSEAU TEL QUE L'APP LE CONSTATE. `navigator.onLine` disait « oui » sur
 *  le Wi-Fi sans internet d'Aubin (25/09) : c'est la dernière requête qui sait. */
beforeEach(() => _reinitialiserPourTest());
afterEach(() => _reinitialiserPourTest());

describe('estEnLigne', () => {
  it('croit le navigateur tant que rien ne le contredit', () => {
    expect(estEnLigne()).toBe(true);
  });

  it('⚠️ une requête qui ne part pas vaut plus que `navigator.onLine`', () => {
    signalerPanneReseau();
    expect(navigator.onLine).toBe(true);
    expect(estEnLigne()).toBe(false);
  });

  it('une réponse reçue lève la panne', () => {
    signalerPanneReseau();
    signalerReseauRevenu();
    expect(estEnLigne()).toBe(true);
  });
});

describe('useEnLigne', () => {
  it('suit la panne constatée, et sa levée', () => {
    const { result } = renderHook(() => useEnLigne());
    expect(result.current).toBe(true);
    act(() => signalerPanneReseau());
    expect(result.current).toBe(false);
    act(() => signalerReseauRevenu());
    expect(result.current).toBe(true);
  });

  it('`online` du navigateur lève la panne : la requête suivante tranchera', () => {
    const { result } = renderHook(() => useEnLigne());
    act(() => signalerPanneReseau());
    expect(result.current).toBe(false);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(result.current).toBe(true);
  });
});
