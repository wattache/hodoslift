import { describe, expect, it } from 'vitest';

import type { CompAttempt } from '@/api/types';
import { chargeAnnoncee, classementAuRis, classementDuGroupe, ordreDuTour, plancherDAnnonce, premierTourOuvert, sequenceDesTours } from '@/lib/comp-helpers';

/** L'ORDRE DE BARRE (FRE-204) : dans un tour, de la charge annoncée la plus
 *  légère à la plus lourde, l'essai précédent départage, les essais jugés en tête. */

const essai = (o: Partial<CompAttempt> = {}): CompAttempt => ({ weight: 0, result: '', ...o });
const plan = (p: number, r: number, o: number) => ({ weights: { pessimistic: p, realistic: r, optimistic: o } });
const participant = (flight: string | null, attempts: CompAttempt[], mouvement = 'SQUAT') =>
  ({ flight, movements: [{ name: mouvement, attempts }] });

describe('chargeAnnoncee', () => {
  it('le tier choisi fait la charge', () => {
    expect(chargeAnnoncee([essai({ ...plan(100, 105, 110), selectedTier: 'optimistic', weight: 110 })], 0)).toBe(110);
  });
  it('rien d’annoncé : le R du plan', () => {
    expect(chargeAnnoncee([essai(plan(100, 105, 110))], 0)).toBe(105);
  });
  it('sans plan : le R hérité de l’essai précédent', () => {
    expect(chargeAnnoncee([essai(plan(100, 105, 110)), essai()], 1)).toBe(105);
  });
  it('une charge saisie sans plan vaut telle quelle', () => {
    expect(chargeAnnoncee([essai({ weight: 60 })], 0)).toBe(60);
  });
});

describe('ordreDuTour', () => {
  it('file vide : rien', () => {
    expect(ordreDuTour([], 'A', 'SQUAT', 0)).toEqual([]);
  });

  it('un seul athlète', () => {
    expect(ordreDuTour([participant('A', [essai({ weight: 100 })])], 'A', 'SQUAT', 0))
      .toEqual([{ index: 0, charge: 100, juge: false }]);
  });

  it('de la plus légère à la plus lourde, et seulement le groupe demandé', () => {
    const ps = [participant('A', [essai({ weight: 120 })]), participant('B', [essai({ weight: 80 })]),
                participant('A', [essai({ weight: 100 })])];
    expect(ordreDuTour(ps, 'A', 'SQUAT', 0).map(e => e.index)).toEqual([2, 0]);
  });

  it('à charge égale, l’essai précédent le plus léger passe d’abord', () => {
    /** MUTATION QUI ROUGIT : retirer le départage par l'essai précédent —
     *  l'ordre retombe sur l'ordre d'inscription. */
    const ps = [participant('A', [essai({ weight: 95 }), essai({ weight: 100 })]),
                participant('A', [essai({ weight: 90 }), essai({ weight: 100 })])];
    expect(ordreDuTour(ps, 'A', 'SQUAT', 1).map(e => e.index)).toEqual([1, 0]);
  });

  it('au premier essai, à charge égale : l’ordre d’inscription', () => {
    const ps = [participant('A', [essai({ weight: 100 })]), participant('A', [essai({ weight: 100 })])];
    expect(ordreDuTour(ps, 'A', 'SQUAT', 0).map(e => e.index)).toEqual([0, 1]);
  });

  it('les essais jugés sortent de la file et restent en tête', () => {
    /** MUTATION QUI ROUGIT : trier sans regarder le verdict — l'athlète déjà
     *  jugé à 120 repasse derrière ceux qui attendent. */
    const ps = [participant('A', [essai({ weight: 90 })]), participant('A', [essai({ weight: 120, result: 'rep' })]),
                participant('A', [essai({ weight: 100 })])];
    expect(ordreDuTour(ps, 'A', 'SQUAT', 0)).toEqual([
      { index: 1, charge: 120, juge: true }, { index: 0, charge: 90, juge: false }, { index: 2, charge: 100, juge: false }]);
  });

  it('changer une annonce réordonne la file', () => {
    const avant = [participant('A', [essai({ ...plan(90, 95, 100) })]), participant('A', [essai({ weight: 97.5 })])];
    expect(ordreDuTour(avant, 'A', 'SQUAT', 0).map(e => e.index)).toEqual([0, 1]);
    const apres = [participant('A', [essai({ ...plan(90, 95, 100), selectedTier: 'optimistic', weight: 100 })]), avant[1]];
    expect(ordreDuTour(apres, 'A', 'SQUAT', 0).map(e => e.index)).toEqual([1, 0]);
  });

  it('un athlète sans ce mouvement ne passe pas ce tour', () => {
    const ps = [participant('A', [essai({ weight: 100 })], 'DIPS'), participant('A', [essai({ weight: 100 })])];
    expect(ordreDuTour(ps, 'A', 'SQUAT', 0).map(e => e.index)).toEqual([1]);
  });
});

describe('sequenceDesTours', () => {
  it('un flight fait tous ses tours, puis le suivant ; les hors-flight en dernier', () => {
    const ps = [participant('B', []), participant('A', []), participant(null, [])];
    const tours = sequenceDesTours(ps, ['A', 'B'], ['MUSCLE UP', 'SQUAT'], 3);
    expect(tours).toHaveLength(18);
    expect(tours.slice(0, 6).every(t => t.flight === 'A')).toBe(true);
    expect(tours[0]).toEqual({ flight: 'A', mouvement: 'MUSCLE UP', essai: 0 });
    expect(tours[3]).toEqual({ flight: 'A', mouvement: 'SQUAT', essai: 0 });
    expect(tours[6].flight).toBe('B');
    expect(tours[17]).toEqual({ flight: null, mouvement: 'SQUAT', essai: 2 });
  });

  /** MUTATION QUI ROUGIT : trier les flights par nom — « Flight 10 » passerait
   *  avant « Flight 9 », et B avant A ici. */
  it('dans l’ordre de la compétition, pas dans celui de l’alphabet', () => {
    const ps = [participant('Flight 9', []), participant('Flight 10', [])];
    expect(sequenceDesTours(ps, ['Flight 9', 'Flight 10'], ['SQUAT'], 1).map(t => t.flight))
      .toEqual(['Flight 9', 'Flight 10']);
  });

  it('un flight où personne ne concourt n’a pas de tour', () => {
    expect(sequenceDesTours([participant('B', [])], ['A', 'B'], ['SQUAT'], 1).map(t => t.flight)).toEqual(['B']);
  });
});

describe('premierTourOuvert', () => {
  /** MUTATION QUI ROUGIT : ignorer le flight — le second essai de A est jugé,
   *  mais B attend encore au premier. */
  it('le premier tour du flight où quelqu’un attend son verdict', () => {
    const ps = [participant('A', [essai({ weight: 100, result: 'rep' }), essai({ weight: 105 })]),
                participant('B', [essai({ weight: 90 }), essai()])];
    expect(premierTourOuvert(ps, 'A', ['SQUAT'], 2)).toEqual({ mouvement: 0, essai: 1 });
    expect(premierTourOuvert(ps, 'B', ['SQUAT'], 2)).toEqual({ mouvement: 0, essai: 0 });
  });

  it('un flight qui a tout fini reprend au premier tour', () => {
    const ps = [participant('A', [essai({ weight: 100, result: 'rep' })])];
    expect(premierTourOuvert(ps, 'A', ['SQUAT'], 1)).toEqual({ mouvement: 0, essai: 0 });
  });
});

describe('plancherDAnnonce', () => {
  it('la plus lourde annonce des essais précédents — on ne baisse pas', () => {
    /** MUTATION QUI ROUGIT : prendre l'essai IMMÉDIATEMENT précédent au lieu du
     *  plus lourd — un 3e essai après 102,5 puis rien d'annoncé tomberait à 0. */
    const essais = [essai({ weight: 100 }), essai({ weight: 102.5 }), essai(), essai()];
    expect(plancherDAnnonce(essais, 0)).toBe(0);
    expect(plancherDAnnonce(essais, 2)).toBe(102.5);
    expect(plancherDAnnonce(essais, 3)).toBe(102.5);
  });
});

describe('classementDuGroupe', () => {
  /** MUTATION QUI ROUGIT : ne pas filtrer le groupe — l'athlète de B, le plus
   *  lourd, prendrait la tête du classement de A. */
  it('au total, et seulement le groupe demandé', () => {
    const ps = [{ score: 250, flight: 'A' }, { score: 400, flight: 'B' }, { score: 300, flight: 'A' }];
    expect(classementDuGroupe(ps, 'A').map(e => e.i)).toEqual([2, 0]);
  });
  it('au total, même quand tous ont un RIS', () => {
    const ps = [{ score: 300, ris: 80, flight: 'A' }, { score: 250, ris: 95, flight: 'A' }];
    expect(classementDuGroupe(ps, 'A').map(e => e.i)).toEqual([0, 1]);
  });
  it('ceux qui ne sont dans aucun groupe se classent entre eux', () => {
    const ps = [{ score: 250 }, { score: 400, flight: 'B' }];
    expect(classementDuGroupe(ps, null).map(e => e.i)).toEqual([0]);
  });
});

describe('classementAuRis', () => {
  /** MUTATION QUI ROUGIT : classer au total — 300 kg passerait devant 250 kg,
   *  alors que 250 kg vaut plus de RIS. */
  it('au RIS, tous groupes confondus', () => {
    const ps = [{ score: 300, ris: 80, flight: 'A' }, { score: 250, ris: 95, flight: 'B' }];
    expect(classementAuRis(ps).map(e => e.i)).toEqual([1, 0]);
  });
  it('sans RIS, après les classés : pas classable n’est pas dernier', () => {
    const ps = [{ score: 300, ris: null }, { score: 250, ris: 60 }, { score: 200, ris: null }];
    expect(classementAuRis(ps).map(e => e.i)).toEqual([1, 0, 2]);
  });
});
