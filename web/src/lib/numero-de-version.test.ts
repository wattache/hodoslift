import { describe, expect, it } from 'vitest';

import { decider } from '../../scripts/numero-de-version.mjs';

/** LE NUMÉRO AFFICHÉ SE PROMEUT À CHAQUE LIVRAISON (William, 25/09) : on ne
 *  livre pas un autre contenu sous un numéro déjà publié. */
describe('le numéro de version à la livraison', () => {
  const publie = { eitri: 'aaa1111', brokkr: 'bbb2222' };

  it('un numéro jamais publié part', () => {
    expect(decider({ numero: '1.0.1', publie: null, eitri: 'ccc3333', brokkr: 'bbb2222' }))
      .toEqual({ ok: true, nouveau: true });
  });

  it('le même contenu se republie sous le même numéro', () => {
    expect(decider({ numero: '1.0.0', publie, eitri: 'aaa1111', brokkr: 'bbb2222' }))
      .toEqual({ ok: true, nouveau: false });
  });

  it('un front changé sous un numéro déjà publié est refusé', () => {
    /** MUTATION QUI ROUGIT : ne comparer que les serveurs — le front partirait sous v1.0.0. */
    const d = decider({ numero: '1.0.0', publie, eitri: 'ddd4444', brokkr: 'bbb2222' });
    expect(d.ok).toBe(false);
    expect(!d.ok && d.message).toMatch(/v1\.0\.0 est déjà publiée.*eitri/);
  });

  it('un serveur changé sous un numéro déjà publié est refusé', () => {
    /** MUTATION QUI ROUGIT : ne comparer que eitri — une livraison de brokkr
     *  seul partirait sous le même numéro. */
    const d = decider({ numero: '1.0.0', publie, eitri: 'aaa1111', brokkr: 'eee5555' });
    expect(d.ok).toBe(false);
    expect(!d.ok && d.message).toMatch(/brokkr/);
  });
});
