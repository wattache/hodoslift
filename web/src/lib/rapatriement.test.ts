import { describe, expect, it } from 'vitest';

import { cibleDuRapatriement, decider, estUneAncienneAdresse } from './rapatriement';

/** LA REDIRECTION VERS L'ORIGINE UNIQUE (FRE-146), et ce qu'elle refuse de faire.
 *
 *  ⚠️ VUES ROUGES : `decider` rendant `'partir'` quelle que soit la file → la
 *  spec de la saisie en attente ; la liste blanche inversée (`!hostname.endsWith
 *  ('trainer.french-forge.com')`) → localhost et le harnais partent. */

describe('la liste blanche des adresses à rapatrier', () => {
  it.each([
    ['french-forge-600.web.app', true],
    ['french-forge-600.firebaseapp.com', true],
    ['french-forge-trainer-rewrite.web.app', true],
  ])('%s est une ancienne adresse', (h, attendu) => {
    expect(estUneAncienneAdresse(h)).toBe(attendu);
  });

  it.each([
    'trainer.french-forge.com',
    'localhost',
    '127.0.0.1',
    // Un hôte qui CONTIENT le suffixe sans se terminer par lui n'est pas visé.
    'web.app.attaque.test',
  ])('%s reste où il est', h => {
    expect(estUneAncienneAdresse(h)).toBe(false);
    expect(decider(h, 0)).toBe('rester');
  });
});

describe('la décision', () => {
  it('part depuis une ancienne adresse quand la file est vide', () => {
    expect(decider('french-forge-600.web.app', 0)).toBe('partir');
  });

  it('⚠️ ATTEND tant qu’une saisie n’est pas partie — la file vit par origine', () => {
    expect(decider('french-forge-600.web.app', 1)).toBe('attendre');
    expect(decider('french-forge-600.web.app', 7)).toBe('attendre');
  });
});

describe('la cible', () => {
  it('garde la page, ses paramètres et son ancre', () => {
    expect(cibleDuRapatriement({ pathname: '/training', search: '?a=1', hash: '#s2' }))
      .toBe('https://trainer.french-forge.com/training?a=1#s2');
  });

  it('la racine reste la racine', () => {
    expect(cibleDuRapatriement({ pathname: '/', search: '', hash: '' }))
      .toBe('https://trainer.french-forge.com/');
  });
});
