import { describe, expect, it } from 'vitest';

import { debutEtFin, fenetresSansMesure, graduations, reperes, suitesMesurees } from './progression-tracker';

describe('les graduations sont rondes, pas des min/max de données', () => {
  it('une barre part de zéro : 0 / 1 500 / 3 000 pour un tonnage qui monte à 2 723', () => {
    expect(graduations([716, 2723, 1859], true)).toEqual([0, 1500, 3000]);
  });
  it('0 / 6 / 12 pour douze séries lourdes au plus', () => {
    expect(graduations([0, 3, 12, 4], true)).toEqual([0, 6, 12]);
  });
  it('une courbe se cadre sur ses valeurs : 75 / 85 / 95 pour une intensité de 79 à 91', () => {
    expect(graduations([79, 85, 91, null, 80], false)).toEqual([75, 85, 95]);
  });
  it('6 / 8 / 10 pour un RPE entre 6 et 9,8 ; 12,5 / 17,5 / 22,5 pour un 1RM entre 12,6 et 21,3', () => {
    expect(graduations([6, 9.8, 7.2], false)).toEqual([6, 8, 10]);
    expect(graduations([12.6, 21.3, 17], false)).toEqual([12.5, 17.5, 22.5]);
    // Pas 2,5 : le demi-pas ferait 13,75 — on monte au pas de 5.
    expect(graduations([14, 18.4, 16], false)).toEqual([10, 15, 20]);
  });
  it('encadre toujours : le haut n’est jamais sous le maximum', () => {
    for (const serie of [[12.6, 21.3], [6, 9.8], [0.4, 0.9], [1, 1], [100, 2995]]) {
      const [lo, , hi] = graduations(serie, false);
      expect(lo).toBeLessThanOrEqual(Math.min(...serie));
      expect(hi).toBeGreaterThanOrEqual(Math.max(...serie));
    }
  });
  it('sans aucune valeur, une échelle quand même', () => {
    expect(graduations([null, null], true)).toEqual([0, 1, 2]);
  });
});

describe('une courbe se coupe sur un trou', () => {
  const e1 = [17, 12.6, null, 18.2, null, null, 16.7, 21.3, null, null, null];
  it('les suites mesurées ne traversent jamais un null', () => {
    expect(suitesMesurees(e1)).toEqual([[0, 1], [3], [6, 7]]);
  });
  it('les fenêtres sans mesure — intérieures et finale', () => {
    expect(fenetresSansMesure(e1)).toEqual([{ from: 2, to: 2 }, { from: 4, to: 5 }, { from: 8, to: 10 }]);
  });
  it('deux repères : le meilleur et le dernier mesuré, pas un point par semaine', () => {
    expect(reperes(e1)).toEqual({ meilleur: 7, dernier: 7 });
    expect(reperes([17, 21.3, 18, null])).toEqual({ meilleur: 1, dernier: 2 });
    expect(reperes([7, 8, 6.5], 'aucun')).toEqual({ meilleur: null, dernier: 2 });
    expect(reperes([null])).toEqual({ meilleur: null, dernier: null });
  });
});

describe('au début contre sur les dernières semaines', () => {
  it('huit et huit quand il y a de quoi', () => {
    const v = Array.from({ length: 36 }, (_, i) => i + 1);
    expect(debutEtFin(v)).toEqual({ debut: 4.5, fin: 32.5, n: 8 });
  });
  it('jamais plus de la moitié des mesures, et les trous ne comptent pas', () => {
    expect(debutEtFin([1, null, 3, 5, null, 7])).toEqual({ debut: 2, fin: 6, n: 2 });
    expect(debutEtFin([4])).toBeNull();
  });
});
