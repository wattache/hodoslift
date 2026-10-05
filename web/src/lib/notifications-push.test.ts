// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { cleEnOctets, etatDepuis } from './notifications-push';

/** LES NOTIFICATIONS PUSH : ce qui se déduit sans toucher à l'appareil. */

describe('cleEnOctets', () => {
  it('lit la clé VAPID en base64url, sans « = » de bourrage, et rend ses octets', () => {
    /** « BB » + « -_ » : deux caractères propres à base64url. MUTATION QUI
     *  ROUGIT : un `atob` sans remplacer `-` et `_` — l'appel lève. */
    const octets = cleEnOctets('AAEC-_8');
    expect([...octets]).toEqual([0, 1, 2, 251, 255]);
  });

  it('accepte une clé déjà bourrée', () => {
    expect([...cleEnOctets('AAEC')]).toEqual([0, 1, 2]);
    expect([...cleEnOctets('AAE=')]).toEqual([0, 1]);
  });
});

describe('etatDepuis', () => {
  const base = { supporte: true, clePublique: 'k', permission: 'default' as NotificationPermission, abonne: false };

  it('attend tant qu’on ne sait pas ce que brokkr ou l’appareil portent', () => {
    expect(etatDepuis({ ...base, clePublique: undefined })).toBe('chargement');
    expect(etatDepuis({ ...base, abonne: undefined })).toBe('chargement');
  });

  it('sans clé côté serveur, il n’y a rien à proposer — avant même de regarder le navigateur', () => {
    expect(etatDepuis({ ...base, clePublique: null, supporte: false })).toBe('sans-serveur');
  });

  it('un navigateur qui ne sait pas (Safari dans l’onglet) le dit, même permission accordée', () => {
    expect(etatDepuis({ ...base, supporte: false, permission: 'granted' })).toBe('indisponible');
  });

  it('abonné sur cet appareil = actif ; sinon la permission bloquée prime sur « inactif »', () => {
    expect(etatDepuis({ ...base, abonne: true })).toBe('actif');
    expect(etatDepuis({ ...base, permission: 'denied' })).toBe('refuse');
    expect(etatDepuis({ ...base })).toBe('inactif');
  });
});
