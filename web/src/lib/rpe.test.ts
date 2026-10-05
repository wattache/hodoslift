import { describe, expect, it } from 'vitest';

import { AIMED_RPE_OPTIONS, RPE_OPTIONS, rpeToNumber } from '@/lib/rpe';
import { feltRPEFromSets } from '@/lib/rpe-scale';

/** L'ÉCHELLE DE RPE — une seule définition, gardée par la donnée réelle (FRE-91).
 *
 *  ⚠️ POURQUOI CE FICHIER EXISTE. Le projet portait DEUX listes `RPE_OPTIONS`,
 *  dans `rpe.ts` et `rpe-scale.ts`, et elles avaient divergé : la seconde omettait
 *  la valeur `"5"`. Personne ne l'importait, donc rien ne le montrait — mais elle
 *  avait l'air de la plus propre des deux, et c'est elle qu'on aurait gardée en
 *  consolidant à vue.
 *
 *  ⚠️ LA PRODUCTION A TRANCHÉ, PAS LE GOÛT : **293 séries portent un RPE de
 *  `"5"`**. Choisir l'autre liste aurait retiré de l'écran une valeur que des
 *  athlètes utilisent — sans casser un seul test, et sans que personne ne relie
 *  la disparition d'une option à un ménage de doublons trois semaines plus tôt.
 *
 *  Ce fichier garde donc l'INVENTAIRE, pas la mise en forme : ce qui compte est
 *  qu'aucune valeur ne disparaisse en silence.
 */

/** Relevé en production le 2026-08-27, par fréquence décroissante. La liste des
 *  options doit contenir tout ce qui existe déjà en base — sinon un athlète ne
 *  peut plus ressaisir ce qu'il a déjà saisi. */
const VUES_EN_PRODUCTION = [
  '7', '7.5', '8', '6', '6.5', '8.5', 'Sub5', '9', '5.5', '5', '9.5', 'FAIL', '10',
];

describe('les options de RPE couvrent ce qui existe vraiment', () => {
  it.each(VUES_EN_PRODUCTION)('« %s » reste proposable', (valeur) => {
    expect(RPE_OPTIONS).toContain(valeur);
  });

  it('la valeur vide reste en tête — « pas encore renseigné » est un état', () => {
    expect(RPE_OPTIONS[0]).toBe('');
  });

  /** ⚠️ LE RPE VISÉ N'EST PAS LE RPE RESSENTI, et la différence est du produit :
   *  on ne PRESCRIT ni `Sub5` (trop facile à viser) ni `FAIL` (c'est un résultat,
   *  pas une cible). Les confondre remettrait ces deux-là dans le sélecteur du
   *  coach. */
  it('le RPE visé exclut Sub5 et FAIL', () => {
    expect(AIMED_RPE_OPTIONS).not.toContain('Sub5');
    expect(AIMED_RPE_OPTIONS).not.toContain('FAIL');
    expect(AIMED_RPE_OPTIONS).toContain('5');
  });

  it('une seule définition — `rpe-scale` réexporte, il ne recopie plus', async () => {
    const rpe = await import('@/lib/rpe');
    const scale = await import('@/lib/rpe-scale');
    expect(scale.rpeToNumber).toBe(rpe.rpeToNumber);
  });
});

describe('la lecture numérique des valeurs non numériques', () => {
  it('Sub5 vaut 4,5 et FAIL vaut 10 — les deux bouts de l’échelle', () => {
    expect(rpeToNumber('Sub5')).toBe(4.5);
    expect(rpeToNumber('FAIL')).toBe(10);
  });

  it('le vide n’est pas zéro — sinon il tirerait les moyennes vers le bas', () => {
    expect(rpeToNumber('')).toBeNull();
    expect(rpeToNumber('n’importe quoi')).toBeNull();
  });
});

describe('le RPE global déduit des séries', () => {
  it('un seul FAIL absorbe tout — le format est raté', () => {
    expect(feltRPEFromSets(['7', '8', 'FAIL'])).toBe('FAIL');
  });

  it('sinon c’est la moyenne, arrondie au demi-point SUPÉRIEUR', () => {
    // 7 + 8 = 7,5 pile ; 7 + 7,5 = 7,25 → 7,5
    expect(feltRPEFromSets(['7', '8'])).toBe('7.5');
    expect(feltRPEFromSets(['7', '7.5'])).toBe('7.5');
  });

  it('une moyenne sous 5 retombe sur Sub5, pas sur un nombre', () => {
    expect(feltRPEFromSets(['Sub5', 'Sub5'])).toBe('Sub5');
  });

  it('aucune saisie ne fabrique pas de valeur', () => {
    expect(feltRPEFromSets([])).toBe('');
    expect(feltRPEFromSets(['', '  '])).toBe('');
  });
});
