import { describe, expect, it } from 'vitest';

import { aplatsDeDepassement, chargesDeRangee, rpeDeRangee } from '@/lib/pistes';

/** L'APLAT DE DÉPASSEMENT DU COULOIR RPE — FRE-114, piste « ligne ancrée ».
 *
 *  ⚠️ POURQUOI CE CALCUL A DES SPECS ET PAS LE RESTE DU DESSIN. Une erreur de
 *  géométrie se voit : une ligne dans la mauvaise bande, une pastille décalée.
 *  Celle-ci, non — un aplat qui déborde de quelques pixels sur la partie tenue
 *  ressemble trait pour trait à un aplat correct, et il affirme pourtant un
 *  dépassement qui n'a pas eu lieu.
 *
 *  ⚠️ ET C'EST LE REMPLISSAGE QUI PORTE LA COMPARAISON, pas la paire de lignes :
 *  deux traits à trois pixels l'un de l'autre se lisent comme une seule ligne
 *  texturée. Se tromper ici, c'est se tromper sur la seule chose que le couloir
 *  dit vraiment.
 *
 *  `y` est l'identité dans ces specs : on éprouve la DÉCOUPE, pas la projection.
 *  Les abscisses viennent de `cx`, qui place les points au centre des colonnes —
 *  à 4 colonnes : 12,5 · 37,5 · 62,5 · 87,5. */
const y = (v: number) => v;

/** Les abscisses d'un quadrilatère, dans l'ordre où il les écrit. */
const xs = (quad: string) => quad.split(' ').map(p => Number(p.split(',')[0]));

describe('les aplats de dépassement', () => {
  it('ne rend rien quand le ressenti reste sous la cible', () => {
    expect(aplatsDeDepassement([8, 8, 8], [7, 7.5, 7], y)).toEqual([]);
  });

  // ⚠️ ÉGAL N'EST PAS DÉPASSÉ : un aplat d'épaisseur nulle laisserait quand même
  // un trait dans le rendu, et le lecteur y verrait un écart.
  it('ne rend rien quand le ressenti ÉGALE la cible', () => {
    expect(aplatsDeDepassement([8, 8], [8, 8], y)).toEqual([]);
  });

  it('rend un quadrilatère par intervalle entièrement dépassé', () => {
    expect(aplatsDeDepassement([8, 8, 8], [9, 9, 9], y)).toHaveLength(2);
  });

  /** ⚠️ LE CAS QUI JUSTIFIE LE CALCUL. S1 sous la cible, S2 au-dessus :
   *  l'intervalle est à moitié tenu. Un quadrilatère qui partirait de S1
   *  peindrait un dépassement sur la moitié gauche, où il n'y en a pas. */
  it('⚠️ COUPE AU CROISEMENT quand le ressenti passe au-dessus en cours d’intervalle', () => {
    // Cibles plates à 8 ; ressenti 7 → 9 : l'écart s'annule au MILIEU.
    const [quad] = aplatsDeDepassement([8, 8], [7, 9], y);
    const [xDepart, , , ] = xs(quad);
    // Deux colonnes : centres à 25 et 75. Le croisement tombe donc à 50.
    expect(xDepart).toBeCloseTo(50, 6);
    expect(Math.max(...xs(quad))).toBeCloseTo(75, 6);
  });

  it('⚠️ COUPE AUSSI quand le ressenti REDESCEND sous la cible', () => {
    const [quad] = aplatsDeDepassement([8, 8], [9, 7], y);
    expect(Math.min(...xs(quad))).toBeCloseTo(25, 6);
    expect(Math.max(...xs(quad))).toBeCloseTo(50, 6);
  });

  // Le croisement ne tombe pas toujours au milieu : 9 → 7,5 sur une cible à 8
  // s'annule au deux tiers de l'intervalle.
  it('place le croisement au prorata de l’écart, pas au milieu par défaut', () => {
    const [quad] = aplatsDeDepassement([8, 8], [9, 7.5], y);
    // d0 = +1, d1 = −0,5 → t = 1 / 1,5 = 2/3 ; x = 25 + 50 × 2/3 ≈ 58,33
    expect(Math.max(...xs(quad))).toBeCloseTo(25 + 50 * (2 / 3), 6);
  });

  // ⚠️ Un trou d'un côté ou de l'autre n'ouvre pas d'aplat : sans les deux
  // valeurs aux deux bouts, l'écart de l'intervalle n'est pas défini.
  it('saute un intervalle dont une valeur manque', () => {
    expect(aplatsDeDepassement([8, null, 8], [9, 9, 9], y)).toEqual([]);
    expect(aplatsDeDepassement([8, 8, 8], [9, null, 9], y)).toEqual([]);
  });

  it('ne rend rien sur une seule semaine — il n’y a pas d’intervalle', () => {
    expect(aplatsDeDepassement([8], [10], y)).toEqual([]);
  });
});

describe('les charges d’une rangée', () => {
  const cellule = (p: Record<string, string> | null) => ({ ligne: p as never });
  const rangee = (lignes: (Record<string, string> | null)[]) =>
    ({ cle: 'SQUAT', nom: 'SQUAT', variantes: [], cellules: lignes.map(cellule) }) as never;

  /** ⚠️ LA SPEC QUI M'AURAIT ÉVITÉ LE DÉFAUT. J'avais écrit
   *  `parseWeight(w) || null`, qui replie `''` et `'0'` sur le même 0 : les 461
   *  lignes de production portant une charge à zéro disparaissaient de la piste.
   *  C'est `''` contre `NULL`, le défaut que ce dépôt nomme en premier, commis
   *  sur l'écran qui prétend rendre les absences visibles. */
  it('⚠️ UNE CHARGE À ZÉRO EST UNE VALEUR, pas une absence', () => {
    expect(chargesDeRangee(rangee([{ weight: '0' }, { weight: '5' }]))).toEqual([0, 5]);
  });

  it('une charge VIDE, elle, est une absence', () => {
    expect(chargesDeRangee(rangee([{ weight: '' }, { weight: '5' }]))).toEqual([null, 5]);
  });

  // Même règle que partout : la courbe décrit ce qui a été FAIT.
  it('prend le réel quand il existe, le prescrit sinon', () => {
    expect(chargesDeRangee(rangee([
      { weight: '100', weightDone: '95' },
      { weight: '100' },
    ]))).toEqual([95, 100]);
  });

  it('rend un trou là où le mouvement n’est pas prescrit', () => {
    expect(chargesDeRangee(rangee([{ weight: '100' }, null]))).toEqual([100, null]);
  });
});

describe('le RPE d’une rangée', () => {
  const rangee = (lignes: (Record<string, string> | null)[]) =>
    ({ cle: 'S', nom: 'S', variantes: [], cellules: lignes.map(l => ({ ligne: l as never })) }) as never;

  it('sépare la cible du ressenti, et rend `null` pour chaque absence', () => {
    expect(rpeDeRangee(rangee([{ aimedRPE: '8', feltRPE: '9' }, { aimedRPE: '8' }, null])))
      .toEqual([
        { cible: 8, ressenti: 9 },
        { cible: 8, ressenti: null },
        { cible: null, ressenti: null },
      ]);
  });

  // FAIL vaut 10 (cf. `rpeToNumber`), et c'est ce qui le rend comparable.
  it('traduit un FAIL en 10', () => {
    expect(rpeDeRangee(rangee([{ aimedRPE: '8', feltRPE: 'FAIL' }]))[0].ressenti).toBe(10);
  });
});
