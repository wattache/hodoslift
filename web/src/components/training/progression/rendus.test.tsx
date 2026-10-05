// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import { RENDUS } from '@/lib/preference-progression';
import type { ProgressionPoint } from '../exercise-progression-data';
import { ProgressionBloc } from './index';
import { ecartsDeCharge, trajectoireEnMots } from './socle';

/** DEUX RENDUS, LES MÊMES QUATRE VALEURS (brief progression, 27/09 ; réduit à
 *  deux le 28/09).
 *
 *  ⚠️ C'EST LA RÈGLE QUI SE PERD EN PREMIER AU FIL DES RETOUCHES : un dessin
 *  qui ne montrerait que la charge oblige à ouvrir autre chose pour comprendre.
 *  Chaque rendu est donc éprouvé sur le même bloc — celui du brief : PULL UP
 *  lesté, 60 → 62,5 → 65 prévus / 62,5 faits → 67,5 à venir, une rep de moins
 *  et RPE 9 au lieu de 8 en S3. */

const point = (label: string, p: Partial<ProgressionPoint> = {}): ProgressionPoint => ({
  label, sets: '3', reps: '2', repsDone: '', repsUnit: 'count',
  kg: null, kgDone: null, kgEffective: null, assistance: '',
  rest: '', restActual: '', variante: '', tempo: '', rpe: null, rpeRaw: '', aimedRpeRaw: '8', feedback: '', ...p,
});

/** Le bloc du brief. S3 est la semaine de l'écart, S4 celle à venir. */
const BLOC: ProgressionPoint[] = [
  point('S1', { kg: 60, kgEffective: 60, rpe: 8, rpeRaw: '8' }),
  point('S2', { kg: 62.5, kgEffective: 62.5, rpe: 8, rpeRaw: '8' }),
  point('S3', { kg: 65, kgDone: 62.5, kgEffective: 62.5, repsDone: '1', rpe: 9, rpeRaw: '9' }),
  point('S4', { kg: 67.5, kgEffective: 67.5 }),
];

/** Le cas de la capture : élastiques, aucune charge. */
const ASSISTE: ProgressionPoint[] = [
  point('S1', { assistance: 'RB30', rpe: 8, rpeRaw: '8' }),
  point('S2', { assistance: 'RB20', rpe: 8, rpeRaw: '8' }),
  point('S3', { assistance: 'RB15', rpe: 9, rpeRaw: '9' }),
  point('S4', {}),
];

beforeAll(async () => { await i18n.changeLanguage('fr'); });
afterEach(cleanup);

const texte = (c: HTMLElement, sel: string) => [...c.querySelectorAll(sel)].map(e => e.textContent ?? '');

describe.each([...RENDUS])('le rendu « %s »', (rendu) => {
  it('porte les quatre valeurs de chaque semaine — séries × reps, charge, RPE — et l’écart de S3', () => {
    const { container } = render(<ProgressionBloc points={BLOC} rendu={rendu} courante={3} />);
    expect(container.querySelector('[data-rendu]')?.getAttribute('data-rendu')).toBe(rendu);
    if (rendu === 'courbe') {
      // La courbe écrit le prescrit quitté À CÔTÉ du point, dans sa propre étiquette.
      expect(texte(container, '[data-valeur-charge]')).toEqual(['60', '62,5', '62,5', '67,5']);
      expect(texte(container, '[data-prescrit-charge]')).toEqual(['65']);
      // Et garde son écriture : « 3×2 → 1 », « 8 → 9 », la cible seule en gris.
      expect(texte(container, '[data-valeur-volume]')).toEqual(['3×2', '3×2', '3×2 → 1', '3×2']);
      expect(texte(container, '[data-valeur-rpe]')).toEqual(['8', '8', '8 → 9', '8']);
    } else {
      expect(texte(container, '[data-valeur-charge]')).toEqual(['60', '62,5', '65→62,5', '67,5']);
      expect(texte(container, '[data-valeur-volume]')).toEqual(['3×2', '3×2', '3×2 → 3×1', '3×2']);
      expect(texte(container, '[data-valeur-rpe]')).toEqual(['8', '8', '8→9', '8 visé']);
    }
  });

  it('dit la trajectoire en toutes lettres', () => {
    const { container } = render(<ProgressionBloc points={BLOC} rendu={rendu} courante={3} />);
    expect(container.querySelector('[data-rendu]')?.getAttribute('aria-label'))
      .toBe('60 kg en S1, 62,5 kg en S2, 65→62,5 kg en S3, 67,5 kg prévu en S4');
  });

  it('sans charge, c’est l’assistance qui s’écrit à sa place', () => {
    const { container } = render(<ProgressionBloc points={ASSISTE} rendu={rendu} />);
    expect(texte(container, '[data-valeur-charge]')).toEqual(['RB30', 'RB20', 'RB15']);
  });
});

describe('les chiffres', () => {
  it('écrivent l’écart ENTRE les semaines : —, +2,5, 0, +5', () => {
    /** MUTATION QUI ROUGIT : comparer au PRESCRIT de la semaine précédente —
     *  S4 donnerait +2,5 (67,5 − 65) au lieu de +5 (67,5 − 62,5 faits). */
    expect(ecartsDeCharge(BLOC)).toEqual([null, 2.5, 0, 5]);
    const { container } = render(<ProgressionBloc points={BLOC} rendu="chiffres" />);
    expect(texte(container, '[data-ecart]')).toEqual(['—', '+2,5', '0', '+5']);
  });

  it('une semaine trouée ne coupe pas l’écart : on compare à la dernière charge connue', () => {
    const troue = [BLOC[0], point('S2'), BLOC[2]];
    expect(ecartsDeCharge(troue)).toEqual([null, null, 2.5]);
  });

  it('le changement de rendu ne recharge rien : mêmes points, autre dessin', () => {
    const vue = render(<ProgressionBloc points={BLOC} rendu="courbe" />);
    expect(vue.container.querySelector('[data-courbe]')).not.toBeNull();
    vue.rerender(<ProgressionBloc points={BLOC} rendu="chiffres" />);
    expect(vue.container.querySelector('[data-courbe]')).toBeNull();
    expect(texte(vue.container, '[data-ecart]')).toHaveLength(4);
  });
});

describe('les mots de la trajectoire', () => {
  it('nomment l’aide et le trou', () => {
    expect(trajectoireEnMots(ASSISTE, i18n.t)).toBe('RB30 en S1, RB20 en S2, RB15 en S3, rien en S4');
  });
});
