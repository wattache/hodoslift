import { describe, expect, it } from 'vitest';

import { formatRis } from '@/lib/ris-score';

/** CE QU'IL RESTE À ÉPROUVER ICI, ET POURQUOI IL EN RESTE SI PEU.
 *
 *  ⚠️ CE FICHIER ÉTAIT LE MIROIR DE `brokkr/tests/test_ris.py` — dix valeurs de
 *  référence épinglant le barème, pour que la duplication Python/TypeScript ne
 *  puisse pas diverger en silence. Il n'a plus d'objet : le second exemplaire du
 *  barème a été retiré (FRE-141), et un miroir sans second reflet ne garde rien.
 *
 *  Le barème vit désormais à UN seul endroit, côté serveur, avec ses specs. Ce
 *  n'est pas une couverture perdue, c'est une duplication supprimée — la seule
 *  façon de rendre une divergence impossible plutôt que surveillée.
 *
 *  Ne reste que l'affichage, qui est bien une affaire de front. */
describe('l’affichage du RIS', () => {
  it('rend deux décimales', () => {
    expect(formatRis(67.7783037104)).toBe('67.78');
    expect(formatRis(0.5439201999)).toBe('0.54');
  });

  it('⚠️ NE REND JAMAIS ZÉRO POUR UN RIS ABSENT', () => {
    // Un athlète qu'on ne sait pas classer — poids ou genre manquant, aucun
    // essai valide — n'est pas DERNIER : il n'est pas classé. `0.00` le
    // placerait en queue, ce qui est une information fausse, et une information
    // fausse sur un classement se lit comme un résultat.
    expect(formatRis(null)).toBe('-');
    expect(formatRis(Number.NaN)).toBe('-');
    expect(formatRis(Number.POSITIVE_INFINITY)).toBe('-');
  });

  it('un vrai zéro, lui, s’affiche', () => {
    // La distinction que la ligne du dessus protège : `0` est une valeur, `null`
    // une absence. Les confondre ferait disparaître un athlète réellement à zéro.
    expect(formatRis(0)).toBe('0.00');
  });
});
