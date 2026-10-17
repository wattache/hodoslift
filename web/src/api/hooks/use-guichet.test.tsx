// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/lib/save-error', () => ({ toastSaveError: toast }));
vi.mock('@/api/mock', async (original) => ({
  ...(await original<typeof import('@/api/mock')>()),
  // L'écriture échoue : c'est le cas que l'écran taisait.
  mockGuichetRelire: () => { throw new Error('refusé'); },
  mockGuichetVu: () => { throw new Error('refusé'); },
}));

import { useMarquerRelue, useMarquerSignalementVu } from './use-guichet';

const enveloppe = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('les écritures du guichet disent leur échec', () => {
  /** « Vu · suivant » ne faisait rien quand l'écriture échouait : aucun message.
   *  MUTATION QUI ROUGIT : retirer `onError: toastSaveError` d'un des hooks. */
  it('cocher une séance relue', async () => {
    toast.mockClear();
    const { result } = renderHook(() => useMarquerRelue(), { wrapper: enveloppe });
    act(() => { result.current.mutate({ programId: 'p', sessionId: 's' }); });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  });

  it('cocher une douleur vue', async () => {
    toast.mockClear();
    const { result } = renderHook(() => useMarquerSignalementVu(), { wrapper: enveloppe });
    act(() => { result.current.mutate({ athleteId: 'a', date: '2026-10-17' }); });
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  });
});
