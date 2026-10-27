// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

/** ⚠️ LA DÉCONNEXION RECHARGE LA PAGE (FRE-259) : le cache des requêtes vit en
 *  mémoire, et sans rechargement le compte suivant, dans le même onglet, voyait
 *  le profil et les écrans du précédent.
 *  MUTATION QUI ROUGIT : retirer `window.location.replace('/')` de `logout`. */
vi.mock('@/firebase', () => ({ auth: null, googleProvider: null, isFirebaseConfigured: false }));

const { AuthProvider, useAuth } = await import('@/auth/auth-context');

it('la déconnexion recharge l’app, et jette ce que la mémoire gardait du compte', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  const { result } = renderHook(() => useAuth(), {
    wrapper: ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>,
  });
  await act(() => result.current.logout());
  expect(replace).toHaveBeenCalledWith('/');
  vi.unstubAllGlobals();
});
