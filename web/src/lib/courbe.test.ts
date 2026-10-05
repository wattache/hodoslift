import { describe, expect, it } from 'vitest';

import { cheminAdouci, cheminDroit, suitesEtPonts, type Point } from './courbe';

/** Échantillonne une Bézier cubique et rend les ordonnées visitées.
 *
 *  ⚠️ C'EST LE SEUL MOYEN DE PROUVER QU'UNE COURBE NE DÉPASSE PAS. Comparer le
 *  `d` à une chaîne attendue vérifierait que le code fait ce qu'il fait, pas que
 *  la courbe reste dans l'intervalle : un point de contrôle trop loin produit une
 *  chaîne parfaitement plausible et un tracé qui sort du cadre. */
function ordonneesVisitees(d: string): number[] {
  const nombres = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  // M x,y puis des C : 6 nombres chacun.
  const out: number[] = [nombres[1]];
  for (let i = 2; i + 5 < nombres.length; i += 6) {
    const p0 = { x: nombres[i - 2], y: nombres[i - 1] };
    const c1 = { x: nombres[i], y: nombres[i + 1] };
    const c2 = { x: nombres[i + 2], y: nombres[i + 3] };
    const p1 = { x: nombres[i + 4], y: nombres[i + 5] };
    for (let k = 1; k <= 40; k++) {
      const t = k / 40;
      const u = 1 - t;
      out.push(
        u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
      );
    }
  }
  return out;
}

const pts = (ys: number[]): Point[] => ys.map((y, x) => ({ x: x * 10, y }));

describe('cheminAdouci', () => {
  it('ne monte PAS au-dessus du poids le plus lourd jamais pesé', () => {
    // ⚠️ LA SPEC QUI DISTINGUE FRITSCH–CARLSON D'UNE CATMULL-ROM, et le motif est
    // choisi par la mesure, pas par l'intuition : une montée douce suivie d'une
    // baisse. Une Catmull-Rom culmine ici à 63,06 kg — un kilo que personne n'a
    // pesé, affiché sur l'écran où l'athlète lit sa santé.
    //
    // ⚠️ LE CAS QU'ON ÉCRIT D'INSTINCT NE ROUGIT PAS : sur un plateau
    // (`[60, 61, 61, 66]`), la branche `seg === 0` aplatit la tangente quelle que
    // soit l'interpolation, et la spec passe au vert avec une Catmull-Rom. Vu de
    // mes yeux en fabriquant la mutation.
    const ys = [62, 62.5, 63, 61];
    const visitees = ordonneesVisitees(cheminAdouci(pts(ys)));

    expect(Math.max(...visitees)).toBeLessThanOrEqual(63 + 1e-6);
    expect(Math.min(...visitees)).toBeGreaterThanOrEqual(61 - 1e-6);
  });

  it('ne descend PAS sous le minimum quand la pente s’emballe ensuite', () => {
    // L'autre sens du même défaut : une Catmull-Rom tombe ici à 8,91 alors que la
    // plus petite valeur observée est 10.
    const ys = [10, 11, 12, 50];
    const visitees = ordonneesVisitees(cheminAdouci(pts(ys)));

    expect(Math.min(...visitees)).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(Math.max(...visitees)).toBeLessThanOrEqual(50 + 1e-6);
  });

  it('ne dépasse pas non plus sur un sommet ni sur un creux', () => {
    for (const ys of [
      [70, 82, 70],
      [82, 70, 82],
      [60, 60, 75, 60, 60],
      [1000, 1, 1000, 1],
    ]) {
      const visitees = ordonneesVisitees(cheminAdouci(pts(ys)));
      expect(Math.min(...visitees), `min sur ${ys}`).toBeGreaterThanOrEqual(
        Math.min(...ys) - 1e-6,
      );
      expect(Math.max(...visitees), `max sur ${ys}`).toBeLessThanOrEqual(
        Math.max(...ys) + 1e-6,
      );
    }
  });

  it('passe EXACTEMENT par les points donnés — un adoucissement n’est pas un lissage', () => {
    // Un lissage (moyenne glissante) déplacerait les points ; ici le survol
    // affiche la valeur saisie, et la pastille doit tomber sur la courbe.
    const d = cheminAdouci(pts([62.5, 61.1, 63.8]));
    expect(d.startsWith('M0.0,62.5')).toBe(true);
    expect(d.includes('10.0,61.1')).toBe(true);
    expect(d.endsWith('20.0,63.8')).toBe(true);
  });

  it('rend un tracé utilisable sur 0, 1 et 2 points', () => {
    expect(cheminAdouci([])).toBe('');
    // Un `M` seul ne PEINT rien : l'appelant en fait une pastille. C'est le
    // défaut déjà vu à l'écran sur la forme du jour (3 sous-tracés d'un point,
    // rien d'affiché).
    expect(cheminAdouci(pts([64]))).toBe('M0.0,64.0');
    expect(cheminAdouci(pts([64, 65]))).toBe('M0.0,64.0 L10.0,65.0');
  });

  it('tient une valeur constante sans osciller', () => {
    const visitees = ordonneesVisitees(cheminAdouci(pts([70, 70, 70, 70])));
    for (const y of visitees) expect(y).toBeCloseTo(70, 6);
  });
});

describe('cheminDroit', () => {
  it('relie sans courbe — c’est ce qui rend un pont reconnaissable', () => {
    expect(cheminDroit(pts([60, 66]))).toBe('M0.0,60.0 L10.0,66.0');
    expect(cheminDroit([])).toBe('');
  });
});

describe('suitesEtPonts', () => {
  it('relie deux points NON CONSÉCUTIFS par un pont', () => {
    // La demande de refonte des écrans, 09/2026 : plus de courbe interrompue.
    const { suites, ponts } = suitesEtPonts([62, null, null, 64]);
    expect(suites).toEqual([[0], [3]]);
    expect(ponts).toEqual([[0, 3]]);
  });

  it('ne fabrique aucun pont quand la série est complète', () => {
    const { suites, ponts } = suitesEtPonts([62, 63, 64]);
    expect(suites).toEqual([[0, 1, 2]]);
    expect(ponts).toEqual([]);
  });

  it('enjambe autant de trous qu’il y en a, et garde les suites intactes', () => {
    const { suites, ponts } = suitesEtPonts([1, 2, null, 3, 4, null, null, 5]);
    expect(suites).toEqual([[0, 1], [3, 4], [7]]);
    expect(ponts).toEqual([
      [1, 3],
      [4, 7],
    ]);
  });

  it('traite `undefined` comme une absence, pas comme une valeur', () => {
    // Le contrat rend ces mesures nullables (FRE-137) et la table du graphe est
    // construite par étalement d'objets : une clé absente arrive en `undefined`.
    const { suites, ponts } = suitesEtPonts([62, undefined, 64]);
    expect(suites).toEqual([[0], [2]]);
    expect(ponts).toEqual([[0, 2]]);
  });

  it('ne rend ni suite ni pont sur une série entièrement vide', () => {
    expect(suitesEtPonts([null, null])).toEqual({ suites: [], ponts: [] });
    expect(suitesEtPonts([])).toEqual({ suites: [], ponts: [] });
  });

  it('un ZÉRO est une valeur observée, pas un trou', () => {
    // ⚠️ LE DÉFAUT LE PLUS RÉCURRENT DU DÉPÔT, ET IL SE REJOUERAIT ICI avec un
    // `if (!v)` au lieu d'un test de type : 0 kcal saisi est une mesure.
    const { suites, ponts } = suitesEtPonts([0, 0, null, 0]);
    expect(suites).toEqual([[0, 1], [3]]);
    expect(ponts).toEqual([[1, 3]]);
  });
});
