// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMesure } from '@/api/connect';
import { _reinitialiserPourTest, estEnLigne } from '@/lib/reseau';

vi.mock('@/firebase', () => ({ auth: null, isFirebaseConfigured: true }));

/** Les appels Connect (sindri) disent au mode hors ligne si le réseau répond,
 *  comme les appels REST (brokkr) : une seule mesure, quel que soit le serveur. */
describe('le transport Connect mesure le réseau', () => {
  beforeEach(() => _reinitialiserPourTest());
  afterEach(() => vi.unstubAllGlobals());

  it('une requête qui ne part pas met l’app hors ligne', async () => {
    /** MUTATION QUI ROUGIT : retirer `signalerPanneReseau()` — la bibliothèque
     *  échouerait sans que l'app se sache hors ligne. */
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchMesure('http://sindri.test/x')).rejects.toThrow('Failed to fetch');
    expect(estEnLigne()).toBe(false);
  });

  it('une réponse, même un refus, ramène l’app en ligne', async () => {
    /** MUTATION QUI ROUGIT : retirer `signalerReseauRevenu()` — l'app resterait
     *  hors ligne après le retour du réseau. */
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchMesure('http://sindri.test/x')).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('{}', { status: 403 })));
    await fetchMesure('http://sindri.test/x');
    expect(estEnLigne()).toBe(true);
  });
});
