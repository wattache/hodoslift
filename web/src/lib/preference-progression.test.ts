// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Me } from '@/api/types';
import { RENDU_PAR_DEFAUT, renduRetenu } from './preference-progression';

/** LA PRÉFÉRENCE D'AFFICHAGE : D'OÙ VIENT LE RENDU (brief progression, 27/09).
 *
 *  ⚠️ L'ORDRE EST LA RÈGLE : brokkr d'abord, le disque en repli, le défaut
 *  sinon. Le disque ne l'emporte JAMAIS sur le serveur — sinon un choix fait
 *  sur un autre appareil serait écrasé par un vieux choix local, et « la
 *  préférence suit la personne » serait faux sans que rien ne le dise. */

const me = (progression: unknown): Me =>
  ({ uid: 'w', email: 'w@x', displayName: '', isCoach: true, isKine: false, isAdmin: false, athleteId: null,
     structures: [], preferences: { progression } } as unknown as Me);

/** ⚠️ Node ≥ 22 pose son propre `globalThis.localStorage` (vide sans
 *  `--localstorage-file`), et jsdom ne le remplace pas : le module lirait
 *  `undefined`. Un magasin en mémoire, le temps du fichier. */
const memoire = new Map<string, string>();
beforeAll(() => vi.stubGlobal('localStorage', {
  getItem: (k: string) => memoire.get(k) ?? null,
  setItem: (k: string, v: string) => { memoire.set(k, v); },
  removeItem: (k: string) => { memoire.delete(k); },
  clear: () => memoire.clear(),
}));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => memoire.clear());

describe('le rendu retenu', () => {
  it('est celui de brokkr, même si le disque en dit un autre', () => {
    /** MUTATION QUI ROUGIT : lire le disque avant le serveur. */
    localStorage.setItem('eitri-progression', 'chiffres');
    expect(renduRetenu(me('courbe'))).toBe('courbe');
  });

  it('se replie sur le disque quand brokkr ne dit rien, puis sur le défaut', () => {
    localStorage.setItem('eitri-progression', 'chiffres');
    expect(renduRetenu(me(null))).toBe('chiffres');
    expect(renduRetenu(undefined)).toBe('chiffres');
    memoire.clear();
    expect(renduRetenu(me(null))).toBe(RENDU_PAR_DEFAUT);
  });

  it('ignore un rendu que le vocabulaire ne connaît plus — en base comme sur le disque', () => {
    /** La préférence a d'abord été posée PAR MODE, puis d'autres rendus ont été
     *  retirés : une ancienne valeur se lit comme « aucune préférence ». */
    localStorage.setItem('eitri-progression', 'marches');
    expect(renduRetenu(me({ athlete: 'chiffres', coach: 'courbe' }))).toBe(RENDU_PAR_DEFAUT);
    expect(renduRetenu(me('phrase'))).toBe(RENDU_PAR_DEFAUT);
  });
});
