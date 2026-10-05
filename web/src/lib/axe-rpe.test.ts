import { describe, expect, it } from 'vitest';

import { axeRpeDuBloc } from '@/lib/bloc-tableau';
import type { BlocLisible, LigneLisible } from '@/lib/bloc-tableau';

/** L'AXE DU COULOIR RPE DU TABLEAU DU BLOC — FRE-114, piste « ligne ancrée ».
 *
 *  ⚠️ CE FICHIER EXISTE À PART DE `bloc-tableau.test.ts` À DESSEIN : celui-là
 *  doit passer SANS MODIFICATION, c'est ce qui prouve que la refonte n'a touché
 *  que la vue.
 *
 *  ⚠️ ET CE N'EST PAS UN RÉGLAGE ESTHÉTIQUE. Un écart visé/ressenti vaut un
 *  demi-point à un point ; étalé sur le 5 → 10 de l'échelle, il mesure 2 à 7 px
 *  dans un couloir de 74 px, et le remplissage qui porte la comparaison devient
 *  invisible. L'axe resserré est la correction qui rend la piste lisible. */

const ligne = (p: Partial<LigneLisible> = {}): LigneLisible =>
  ({ name: 'SQUAT', variant: [], sets: '', reps: '', weight: '', aimedRPE: '', ...p });

const bloc = (lignes: LigneLisible[]): BlocLisible =>
  ({ weeks: [{ weekNumber: 1, sessions: [{ name: 'Lundi', exercises: lignes }] }] });

describe('l’axe RPE du bloc', () => {
  it('se resserre sur la plage utilisée, avec une marge d’un demi-point', () => {
    expect(axeRpeDuBloc(bloc([
      ligne({ aimedRPE: '7', feltRPE: '7.5' }),
      ligne({ aimedRPE: '8', feltRPE: '8' }),
    ]))).toEqual({ lo: 6.5, hi: 8.5 });
  });

  // ⚠️ Le visé ET le ressenti : une cible hors champ couperait le pointillé au
  // bord du couloir.
  it('contient les deux tracés, pas seulement le ressenti', () => {
    const a = axeRpeDuBloc(bloc([ligne({ aimedRPE: '6', feltRPE: '9' })]));
    expect(a.lo).toBeLessThanOrEqual(6);
    expect(a.hi).toBeGreaterThanOrEqual(9);
  });

  it('garde une amplitude d’au moins 2 points quand tout le bloc est à la même valeur', () => {
    const a = axeRpeDuBloc(bloc([ligne({ aimedRPE: '8', feltRPE: '8' })]));
    expect(a.hi - a.lo).toBeGreaterThanOrEqual(2);
  });

  /** ⚠️ LE CAS QUI A FAILLI PASSER. Un bloc entièrement à 10 donne lo 9,5 et
   *  hi 11 ; le clamp ramène hi à 10, et sans élargissement vers le bas
   *  l'amplitude tombe à 0,5 — où un demi-point d'écart sort du couloir. */
  it('⚠️ ÉLARGIT VERS LE BAS quand le haut bute sur 10', () => {
    const a = axeRpeDuBloc(bloc([ligne({ aimedRPE: '10', feltRPE: '10' })]));
    expect(a.hi).toBe(10);
    expect(a.hi - a.lo).toBeGreaterThanOrEqual(2);
  });

  it('ne descend jamais sous 0 ni ne dépasse 10', () => {
    const a = axeRpeDuBloc(bloc([ligne({ feltRPE: 'Sub5' })]));
    expect(a.lo).toBeGreaterThanOrEqual(0);
    expect(a.hi).toBeLessThanOrEqual(10);
  });

  // Un FAIL vaut 10 (cf. `rpeToNumber`) : il tire l'axe vers le haut comme tel.
  it('compte un FAIL comme un 10', () => {
    expect(axeRpeDuBloc(bloc([ligne({ aimedRPE: '8', feltRPE: 'FAIL' })])).hi).toBe(10);
  });

  // Sans aucun RPE le couloir ne s'affiche pas, mais l'axe doit rester bien
  // formé : un `hi` égal à `lo` ferait diviser par zéro dans la projection.
  it('reste bien formé quand le bloc ne porte aucun RPE', () => {
    const a = axeRpeDuBloc(bloc([ligne({ weight: '100' })]));
    expect(a.hi).toBeGreaterThan(a.lo);
  });
});
