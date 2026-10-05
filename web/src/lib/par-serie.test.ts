import { describe, expect, it } from 'vitest';

import { moyenneDesSeries, seriesDeLaLigne, seriesRenseignees } from '@/lib/par-serie';

/** LA MOYENNE D'UN RÉALISÉ PAR SÉRIE — répétitions et charge (06/09).
 *
 *  ⚠️ CE QUE CES SPECS NE COUVRENT PAS, ET QUI COMPTE PLUS : le TONNAGE. Il se
 *  calcule côté serveur comme une somme de produits, et `test_etl_training_sets.py`
 *  le tient. Cette moyenne-ci ne sert QU'À L'AFFICHAGE — s'en servir pour
 *  calculer un volume est précisément l'erreur que la formule serveur évite.
 */

describe('la moyenne des séries notées', () => {
  it('rend la moyenne, sans décimale inutile', () => {
    expect(moyenneDesSeries(['10', '11', '12'])).toBe('11');
  });

  it('garde une décimale quand elle dit quelque chose', () => {
    expect(moyenneDesSeries(['10', '11'])).toBe('10.5');
    // 10,666… : entier, ça mentirait sur l'écart ; en flottant complet, ça
    // remplirait la cellule.
    expect(moyenneDesSeries(['10', '11', '11'])).toBe('10.7');
  });

  /** ⚠️ LA VIRGULE DÉCIMALE EST LA NORME DE SAISIE. La production porte « 20,4 »,
   *  « 17,5 », « 12,5 » — 209 lignes de charge réalisée sur 2 304. `parseFloat`
   *  brut rend 20 sur « 20,4 » : le demi-kilo se perd sans que rien ne le dise. */
  it('lit la virgule décimale comme un point', () => {
    expect(moyenneDesSeries(['17,5', '17,5'])).toBe('17.5');
    expect(moyenneDesSeries(['20,4'])).toBe('20.4');
  });

  /** ⚠️ UNE SÉRIE VIDE N'EST PAS UNE SÉRIE À ZÉRO. `['10','','12']` dit « la
   *  deuxième n'est pas notée » ; la compter pour 0 ferait tomber la moyenne à
   *  7,3 et le coach lirait un effondrement qui n'a pas eu lieu. */
  it('ignore les séries non notées, sans les compter pour zéro', () => {
    expect(moyenneDesSeries(['10', '', '12'])).toBe('11');
    expect(moyenneDesSeries(['10', '   ', '12'])).toBe('11');
  });

  /** ⚠️ RIEN DE NOTÉ REND `''`, JAMAIS `'0'` : « il n'a rien dit » n'est pas
   *  « il a fait zéro ». C'est le défaut le plus récurrent du projet, ici à la
   *  frontière de l'affichage. */
  it('rend le vide quand rien n’est noté', () => {
    expect(moyenneDesSeries([])).toBe('');
    expect(moyenneDesSeries(['', ''])).toBe('');
    expect(moyenneDesSeries(null)).toBe('');
    expect(moyenneDesSeries(undefined)).toBe('');
  });

  /** ⚠️ ET CE QUI N'EST PAS UN NOMBRE NE FABRIQUE PAS DE MOYENNE. « PDC » est
   *  une charge légitime dans ce projet — 1 lignes sur 8 la portent — mais elle
   *  ne s'additionne pas. Elle sort du calcul sans le casser. */
  it('écarte ce qui n’est pas un nombre', () => {
    expect(moyenneDesSeries(['PDC', 'PDC'])).toBe('');
    expect(moyenneDesSeries(['PDC', '20'])).toBe('20');
  });

  it('une seule série est sa propre moyenne', () => {
    expect(moyenneDesSeries(['8'])).toBe('8');
  });
});

describe('les séries d’une ligne', () => {
  it('rend le tableau tel quel quand il existe', () => {
    expect(seriesDeLaLigne(['10', '11'], '')).toEqual(['10', '11']);
  });

  /** ⚠️ LE SCALAIRE HÉRITÉ EST LA SÉRIE 1, comme pour le RPE. Sans ça, ouvrir
   *  « par série » sur une ligne déjà remplie effacerait à l'écran ce que
   *  l'athlète avait saisi — il le retaperait, ou croirait l'avoir perdu. */
  it('sème l’ancienne saisie unique en série 1', () => {
    expect(seriesDeLaLigne([], '12')).toEqual(['12']);
    expect(seriesDeLaLigne(null, '12')).toEqual(['12']);
  });

  it('rend une liste vide quand il n’y a rien des deux côtés', () => {
    expect(seriesDeLaLigne([], '')).toEqual([]);
    expect(seriesDeLaLigne(undefined, undefined)).toEqual([]);
  });

  /** Le tableau PRIME sur le scalaire : celui-ci n'est que sa moyenne, donc le
   *  relire par-dessus le détail écraserait le détail par son propre résumé. */
  it('ne laisse pas la moyenne écraser le détail', () => {
    expect(seriesDeLaLigne(['10', '12'], '11')).toEqual(['10', '12']);
  });
});

describe('seriesRenseignees — le compteur du mode par série (FRE-156)', () => {
  it('⚠️ NE COMPTE PAS un scalaire global comme un trou', () => {
    // 24 lignes de production : charges par série, répétitions notées UNE fois.
    // Le serveur les lit correctement ; le compteur ne doit pas les accuser.
    expect(seriesRenseignees([null, ['80', '90', '100']], 3))
      .toEqual({ notees: 3, attendues: 3 });
  });

  it('voit la série laissée vide au milieu d’un tableau ouvert', () => {
    expect(seriesRenseignees([['8', '', '8']], 3)).toEqual({ notees: 2, attendues: 3 });
  });

  it('voit le tableau plus COURT que le nombre de séries', () => {
    // Le cas réel : répétitions sur deux séries, charges sur trois.
    expect(seriesRenseignees([['12', '12'], ['80', '87.5', '87.5']], 3))
      .toEqual({ notees: 2, attendues: 3 });
  });

  it('exige que CHAQUE tableau ouvert porte sa valeur', () => {
    expect(seriesRenseignees([['8', '8'], ['100', '']], 2))
      .toEqual({ notees: 1, attendues: 2 });
  });

  it('ne dit rien tant qu’aucun tableau n’est ouvert', () => {
    expect(seriesRenseignees([null, undefined, []], 4)).toBeNull();
    expect(seriesRenseignees([['', '']], 2)).toBeNull();
  });

  it('ne dit rien sans nombre de séries exploitable', () => {
    expect(seriesRenseignees([['8']], Number.NaN)).toBeNull();
    expect(seriesRenseignees([['8']], 0)).toBeNull();
  });

  it('tout rempli : le compteur est plein', () => {
    expect(seriesRenseignees([['8', '8', '8'], ['100', '100', '100']], 3))
      .toEqual({ notees: 3, attendues: 3 });
  });
});
