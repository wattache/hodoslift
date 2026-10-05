import { describe, expect, it } from 'vitest';

import {
  blocAMontrer, indexDeLaSemaineAffichee, indexDuBlocAffiche, type SemaineSituee,
} from './program-selection';

/** LA SEMAINE AFFICHÉE IGNORE LES MASQUÉES DANS L'APERÇU ATHLÈTE (FRE-158).
 *
 *  ⚠️ VUES ROUGES : `ignorerLesMasquees` ignoré (la masquée reste choisie), et
 *  l'index rendu depuis la liste FILTRÉE au lieu de l'originale — ce second cas
 *  est le pire, il fait écrire dans la mauvaise semaine.
 */

const s = (id: string, hidden = false): SemaineSituee => ({ id, hidden });

describe('indexDeLaSemaineAffichee', () => {
  it('choisit la semaine stockée quand elle est visible', () => {
    expect(indexDeLaSemaineAffichee([s('a'), s('b')], 'a', true)).toBe(0);
  });

  it('⚠️ NE CHOISIT PAS une semaine masquée, même stockée', () => {
    expect(indexDeLaSemaineAffichee([s('a', true), s('b')], 'a', true)).toBe(1);
  });

  it('la choisit quand même en mode coach — c’est lui qui la démasque', () => {
    expect(indexDeLaSemaineAffichee([s('a', true), s('b')], 'a', false)).toBe(0);
  });

  it('⚠️ REND L’INDEX DE LA LISTE D’ORIGINE, pas celui de la liste filtrée', () => {
    // Sans repli sur l'origine, « c » vaudrait 1 (son rang parmi les visibles)
    // et l'éditeur patcherait « b », qui est masquée.
    expect(indexDeLaSemaineAffichee([s('a'), s('b', true), s('c')], 'c', true)).toBe(2);
  });

  it('sans semaine stockée, retombe sur la dernière VISIBLE', () => {
    expect(indexDeLaSemaineAffichee([s('a'), s('b'), s('c', true)], undefined, true)).toBe(1);
  });

  it('⚠️ RIEN À AFFICHER quand tout est masqué — et c’est le cas du coach qui a masqué son bloc', () => {
    expect(indexDeLaSemaineAffichee([s('a', true)], 'a', true)).toBe(-1);
  });

  it('un bloc sans semaine ne désigne rien', () => {
    expect(indexDeLaSemaineAffichee([], undefined, true)).toBe(-1);
    expect(indexDeLaSemaineAffichee([], undefined, false)).toBe(-1);
  });
});

/** LE BLOC SANS SEMAINE VISIBLE NE S'AFFICHE PAS (FRE-158).
 *
 *  « Masquer une semaine unique de bloc ne doit pas montrer le bloc vide. Juste
 *  ne pas montrer le bloc » — William, 09/09. */

const bloc = (id: string, semaines: SemaineSituee[]) => ({ id, weeks: semaines });

describe('blocAMontrer', () => {
  it('un bloc dont une semaine reste visible s’affiche', () => {
    expect(blocAMontrer(bloc('b', [s('a', true), s('b')]), true)).toBe(true);
  });

  it('⚠️ un bloc dont TOUTES les semaines sont masquées ne s’affiche pas', () => {
    expect(blocAMontrer(bloc('b', [s('a', true)]), true)).toBe(false);
  });

  it('⚠️ un bloc SANS aucune semaine non plus — le bloc neuf que le coach compose', () => {
    expect(blocAMontrer(bloc('b', []), true)).toBe(false);
  });

  it('le coach garde les deux : c’est chez lui qu’ils vivent', () => {
    expect(blocAMontrer(bloc('b', [s('a', true)]), false)).toBe(true);
    expect(blocAMontrer(bloc('b', []), false)).toBe(true);
  });
});

describe('indexDuBlocAffiche', () => {
  it('⚠️ REND L’INDEX D’ORIGINE, pas le rang parmi les visibles', () => {
    const blocks = [bloc('vide', []), bloc('plein', [s('w')])];
    expect(indexDuBlocAffiche(blocks, 'plein', true)).toBe(1);
  });

  it('ne choisit pas un bloc entièrement masqué, même stocké', () => {
    const blocks = [bloc('masque', [s('w', true)]), bloc('plein', [s('x')])];
    expect(indexDuBlocAffiche(blocks, 'masque', true)).toBe(1);
  });

  it('le choisit en mode coach', () => {
    const blocks = [bloc('masque', [s('w', true)]), bloc('plein', [s('x')])];
    expect(indexDuBlocAffiche(blocks, 'masque', false)).toBe(0);
  });

  it('⚠️ RIEN À MONTRER quand tous les blocs sont masqués', () => {
    expect(indexDuBlocAffiche([bloc('a', [s('w', true)])], 'a', true)).toBe(-1);
  });
});
