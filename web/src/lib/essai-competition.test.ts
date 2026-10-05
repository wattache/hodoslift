import { describe, expect, it } from 'vitest';

import { appliquerVerdict, verdictBascule } from '@/lib/essai-competition';

/** ⚠️ CE QUE CES SPECS GARDENT, C'EST UN JOUR DE COMPÉTITION. Un motif resté sur
 *  un essai qui n'est plus « norep » fait refuser le PUT ENTIER de la
 *  compétition (422 `motif_exige_un_echec`, et le même `CHECK` en base). La
 *  feuille de match cesse d'être enregistrée, et l'écran ne montre plus le motif
 *  fautif — le `<select>` s'est simplement caché.
 */

describe('le verdict d’un essai', () => {
  it('efface le motif quand l’essai n’est plus refusé', () => {
    const apres = verdictBascule({ result: 'norep', norepReason: 'depth' }, 'norep');
    expect(apres.result).toBe('');
    expect(apres.norepReason).toBeUndefined();
  });

  /** ⚠️ LA PORTE QUE LE TICKET N'AVAIT PAS VUE. Passer de `norep` à `rep` gardait
   *  le motif tout autant, et déclenche le même refus. C'est le geste le plus
   *  probable après une VAR : le juge s'était trompé, l'essai est validé. */
  it('l’efface AUSSI quand l’essai devient validé', () => {
    const apres = verdictBascule({ result: 'norep', norepReason: 'depth' }, 'rep');
    expect(apres.result).toBe('rep');
    expect(apres.norepReason).toBeUndefined();
  });

  it('le garde tant que l’essai reste refusé', () => {
    const apres = appliquerVerdict({ result: 'norep', norepReason: 'depth' }, 'norep');
    expect(apres.norepReason).toBe('depth');
  });

  /** ⚠️ `undefined`, JAMAIS `''`. La colonne est `norep_reason text REFERENCES
   *  norep_reasons(id)` : une chaîne vide n'est pas un id de motif, elle partirait
   *  en violation de clé étrangère au lieu de dire « aucun ». */
  it('efface en ABSENCE, pas en chaîne vide', () => {
    const apres = verdictBascule({ result: 'norep', norepReason: 'depth' }, 'norep');
    expect(apres).not.toHaveProperty('norepReason', '');
    expect(Object.prototype.hasOwnProperty.call(apres, 'norepReason')).toBe(true);
    expect(apres.norepReason).toBeUndefined();
  });
});

describe('la VAR ne suit pas la même règle', () => {
  /** ⚠️ ET C'EST VÉRIFIÉ CÔTÉ SERVEUR : `norep_reason` porte un `CHECK`,
   *  `var_used` n'en a AUCUN. La case reste d'ailleurs affichée sur un essai
   *  validé — « la VAR a été consultée, et elle a validé » est un fait vrai, et
   *  le plus intéressant des deux. L'effacer serait une perte. */
  it('survit au passage de refusé à validé', () => {
    const apres = verdictBascule({ result: 'norep', norepReason: 'depth', varUsed: true }, 'rep');
    expect(apres.varUsed).toBe(true);
  });

  it('tombe quand l’essai redevient NON JUGÉ', () => {
    // Plus rien ne s'affiche à ce moment-là : la garder ferait un état invisible.
    const apres = verdictBascule({ result: 'rep', varUsed: true }, 'rep');
    expect(apres.result).toBe('');
    expect(apres.varUsed).toBeUndefined();
  });
});

describe('la bascule', () => {
  it('pose le verdict quand l’essai n’en avait pas', () => {
    expect(verdictBascule({ result: '' }, 'rep').result).toBe('rep');
    expect(verdictBascule({ result: '' }, 'norep').result).toBe('norep');
  });

  it('bascule d’un verdict à l’autre sans passer par le vide', () => {
    expect(verdictBascule({ result: 'rep' }, 'norep').result).toBe('norep');
  });

  /** Les champs qui ne regardent pas le verdict ne bougent pas. */
  it('ne touche à rien d’autre', () => {
    const apres = verdictBascule({ result: '', weight: 120, attemptIndex: 2 } as never, 'rep');
    expect(apres).toMatchObject({ weight: 120, attemptIndex: 2 });
  });
});
