import { describe, expect, it } from 'vitest';

import { domaineDAuthentification } from './firebase';

describe('le domaine d’authentification suit l’adresse de la page', () => {
  /** Depuis app.hodoslift.com, une connexion par trainer.french-forge.com écrit
   *  son état sur une autre origine : « missing initial state » sur Safari et en
   *  PWA. MUTATION QUI ROUGIT : rendre toujours la configuration. */
  it('chaque adresse de l’app s’authentifie chez elle', () => {
    expect(domaineDAuthentification('app.hodoslift.com', 'trainer.french-forge.com')).toBe('app.hodoslift.com');
    expect(domaineDAuthentification('trainer.french-forge.com', 'trainer.french-forge.com')).toBe('trainer.french-forge.com');
  });

  it('ailleurs (local, harnais), la configuration décide', () => {
    expect(domaineDAuthentification('localhost', 'trainer.french-forge.com')).toBe('trainer.french-forge.com');
    expect(domaineDAuthentification('french-forge-600.web.app', 'trainer.french-forge.com')).toBe('trainer.french-forge.com');
  });
});
