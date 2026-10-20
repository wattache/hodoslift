import { describe, expect, it } from 'vitest';

import { computeCompetitionPRs } from './selectors';
import type { Competition } from '@/api/types';

describe('les records de compétition suivent le tirage', () => {
  /** Théo tire en chin up : ses essais vivent sur l'emplacement « PULL UP », et
   *  comptaient au pull up. MUTATION QUI ROUGIT : lire `name` au lieu du
   *  mouvement réel servi. */
  it('un chin up sur l’emplacement PULL UP compte au CHIN UP', () => {
    const comp = { name: 'Euros', date: '2026-10-04', participants: [{
      name: 'Théo', uid: 'theo', tirage: 'CHIN UP',
      movements: [{ name: 'PULL UP', mouvementReel: 'CHIN UP', attempts: [{ weight: 97.5, result: 'rep' }] }],
    }] } as unknown as Competition;
    const prs = computeCompetitionPRs([comp], ['theo']);
    expect(prs['CHIN UP']?.weight).toBe(97.5);
    expect(prs['PULL UP']).toBeUndefined();
  });
});
