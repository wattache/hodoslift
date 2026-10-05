// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { estUnModulePerime, peutRecharger } from './module-perime';

describe('estUnModulePerime', () => {
  it.each([
    ['Chrome', 'Failed to fetch dynamically imported module: https://trainer.french-forge.com/assets/competitions-Ab12.js'],
    ['Safari', 'Importing a module script failed.'],
    ['Firefox', 'error loading dynamically imported module: https://trainer.french-forge.com/assets/competitions-Ab12.js'],
    ['Safari, HTML servi', "'text/html' is not a valid JavaScript MIME type."],
  ])('reconnaît l\'import échoué de %s', (_, message) => {
    expect(estUnModulePerime(new TypeError(message))).toBe(true);
  });

  it('laisse passer une erreur de l\'app', () => {
    expect(estUnModulePerime(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false);
  });
});

describe('peutRecharger', () => {
  beforeEach(() => sessionStorage.clear());

  it('une fois par fenêtre de dix secondes', () => {
    expect(peutRecharger(1_000_000)).toBe(true);
    sessionStorage.setItem('eitri:rechargement-module-perime', '1000000');
    expect(peutRecharger(1_009_000)).toBe(false);
    expect(peutRecharger(1_011_000)).toBe(true);
  });
});
