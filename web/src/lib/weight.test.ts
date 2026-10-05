import { describe, expect, it } from 'vitest';

import { chargeEtAssistance } from './weight';

/** Ce qui s'affiche dans la colonne « charge » — la règle partagée par l'Aperçu et
 *  le Détail depuis le 20/08.
 *
 *  Ces cas existent tous en production : 208 lignes portent une assistance, dont 7
 *  avec une charge réelle. Le cas qui a motivé la reprise est le troisième. */

// ⚠️ `weightDone` VAUT `''` PAR DÉFAUT, il n'est pas absent : le serveur envoie
// toujours la clé, vide quand rien n'a été réalisé. La signature d'avant la
// rendait facultative et faisait donc tester une forme qui n'arrive jamais.
const ex = (weight: string, assistance = '', weightDone = '') =>
  ({ weight, assistance, weightDone });

describe('charge et assistance', () => {
  it('rend la charge seule quand il n’y a pas d’assistance', () => {
    expect(chargeEtAssistance(ex('60'))).toEqual(['60 kg']);
  });

  it('rend l’assistance seule quand la charge est vide', () => {
    expect(chargeEtAssistance(ex('', 'RB35'))).toEqual(['RB35']);
  });

  it('LE DÉFAUT : une charge à ZÉRO ne mange plus l’assistance', () => {
    // `'0'` est une chaîne non vide — donc truthy — mais ne s'affiche pas. Le
    // Détail prenait la branche « charge » d'un ternaire et n'affichait RIEN,
    // pendant que l'Aperçu montrait la bande. Constaté sur un athlète réel.
    expect(chargeEtAssistance(ex('0', 'RB15'))).toEqual(['RB15']);
  });

  it('rend LES DEUX quand les deux existent', () => {
    // 7 lignes de production : un lesté avec bande est une vraie prescription.
    expect(chargeEtAssistance(ex('20', 'RB15'))).toEqual(['20 kg', 'RB15']);
  });

  it('rend le réalisé quand il diffère du prescrit, assistance comprise', () => {
    expect(chargeEtAssistance(ex('60', 'RB15', '65'))).toEqual(['60 kg → 65 kg', 'RB15']);
  });

  it('ne rend RIEN quand il n’y a ni charge ni assistance', () => {
    // La vue affiche alors son propre tiret — elle ne reçoit pas une chaîne vide
    // qu'elle devrait distinguer de l'absence.
    expect(chargeEtAssistance(ex('0', '   '))).toEqual([]);
  });
});
