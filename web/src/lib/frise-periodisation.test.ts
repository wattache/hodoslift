import { describe, expect, it } from 'vitest';

import type { MacroDeStructure } from '@/api/types';
import {
  axeDeLaFrise, chevauchements, jalonsAVenir, lignesDeMacro, semaineDEntree, situation, typeDeBloc, zoomDeSemaines,
  type EvenementDeFrise,
} from '@/lib/frise-periodisation';

/** LA GÉOMÉTRIE DE LA FRISE — ce que le calendrier affirme sur le temps (16/09).
 *
 *  ⚠️ LE PIÈGE QUE CES SPECS GARDENT : dériver une semaine par tranches de 7
 *  jours. Les programmes réels portent des semaines de 5, 9, 10, 11 jours et des
 *  TROUS entre deux blocs ; le mock n'en portait aucune, et un `i += 7` y aurait
 *  passé au vert. D'où des fixtures irrégulières, écrites ici. */

type Semaine = [id: string, numero: number, debut: string, fin: string];
const bloc = (id: string, numero: number, name: string, semaines: Semaine[], objectives: MacroDeStructure['blocks'][number]['objectives'] = []) => ({
  id, blockNumber: numero, name, startDate: null, endDate: null, objectives, objectivesVersion: 'v', hasBase: false,
  weeks: semaines.map(([wid, n, debut, fin]) => ({
    id: wid, weekNumber: n, name: null, hidden: false, startDate: debut, endDate: fin, athlete: null, sessionCount: 0,
  })),
}) as unknown as MacroDeStructure['blocks'][number];
const macro = (id: string, numero: number, name: string, blocks: MacroDeStructure['blocks']): MacroDeStructure =>
  ({ id, macroNumber: numero, name, trainingFrequency: null, coachNotes: null, blocks }) as MacroDeStructure;

/** Le programme type : une semaine de 9 jours, une de 5, un trou de 2 jours
 *  entre les deux blocs, puis un bloc de PEAKING. Aujourd'hui = 2026-09-16. */
const AUJOURDHUI = '2026-09-16';
const PROGRAMME = [macro('m1', 1, 'Prépa FNSL', [
  bloc('b1', 1, 'Accumulation', [
    ['w1', 1, '2026-08-31', '2026-09-08'],   // 9 jours
    ['w2', 2, '2026-09-09', '2026-09-13'],   // 5 jours
  ], [{ id: 'o1', exercise: 'SQUAT', variant: null, format: null, sets: '5', reps: '5', weightMin: '100', weightMax: null, assistance: null, atteintLe: '2026-09-10' }]),
  // trou : 14 et 15 septembre
  bloc('b2', 2, 'Intensification', [
    ['w3', 1, '2026-09-16', '2026-09-22'],
    ['w4', 2, '2026-09-23', '2026-09-29'],
  ]),
  bloc('b3', 3, 'PEAKING', [['w5', 1, '2026-09-30', '2026-10-06']]),
])];

const evenement = (id: string, nature: EvenementDeFrise['nature'], debut: string, fin: string, extra: Partial<EvenementDeFrise> = {}): EvenementDeFrise =>
  ({ id, nature, type: nature === 'competition' ? 'competition' : 'vacation', nom: id, emoji: '🌴', debut, fin, peutSEntrainer: null, ...extra });

describe('les semaines RÉELLES', () => {
  it('une semaine mesure ce que ses dates disent : 9 jours, puis 5', () => {
    /** MUTATION QUI ROUGIT : `duree: 7`. */
    const [l] = lignesDeMacro(PROGRAMME, AUJOURDHUI);
    expect(l.blocs[0].semaines.map(s => s.duree)).toEqual([9, 5]);
  });

  it('un bloc s’étend sur ses semaines, et un macro sur ses blocs', () => {
    const [l] = lignesDeMacro(PROGRAMME, AUJOURDHUI);
    expect([l.blocs[0].debut, l.blocs[0].fin]).toEqual(['2026-08-31', '2026-09-13']);
    expect([l.debut, l.fin]).toEqual(['2026-08-31', '2026-10-06']);
  });

  it('un bloc sans aucune date n’est pas placé sur l’axe, il n’est pas inventé', () => {
    const sansDate = [macro('m', 1, '', [bloc('b', 1, 'X', [['w', 1, '', '']])])];
    expect(lignesDeMacro(sansDate, AUJOURDHUI)).toEqual([]);
  });

  it('un programme vide ne produit rien, et ne casse rien', () => {
    expect(lignesDeMacro([], AUJOURDHUI)).toEqual([]);
    expect(zoomDeSemaines([], [], AUJOURDHUI)).toEqual([]);
    expect(jalonsAVenir([], [], AUJOURDHUI)).toEqual([]);
    expect(situation([], [], AUJOURDHUI)).toEqual({ position: null, prochaineCompetition: null, prochainEvenement: null });
    expect(axeDeLaFrise([], [], AUJOURDHUI).debut).toBe('2026-09-01');
  });
});

describe('le zoom : une ligne = une semaine réelle', () => {
  it('le trou entre deux blocs devient une LIGNE, à la largeur du trou', () => {
    /** MUTATION QUI ROUGIT : ne plus pousser la ligne `trou`. */
    const lignes = zoomDeSemaines(lignesDeMacro(PROGRAMME, AUJOURDHUI), [], AUJOURDHUI);
    expect(lignes.map(l => l.nature === 'trou' ? `trou ${l.debut}→${l.fin} (${l.duree})` : l.semaine.id))
      .toEqual(['w1', 'w2', 'trou 2026-09-14→2026-09-15 (2)', 'w3', 'w4', 'w5']);
  });

  it('une case par jour RÉEL : 9 cases pour 9 jours, chacune à sa date et à sa lettre', () => {
    /** MUTATION QUI ROUGIT : `for (i = 0; i < 7; …)`. */
    const [w1] = zoomDeSemaines(lignesDeMacro(PROGRAMME, AUJOURDHUI), [], AUJOURDHUI);
    if (w1.nature !== 'semaine') throw new Error('attendu : une semaine');
    expect(w1.jours).toHaveLength(9);
    expect(w1.jours.map(j => j.iso)[8]).toBe('2026-09-08');
    // 31/08/2026 est un lundi ; la semaine réelle ne recommence pas au lundi suivant.
    expect(w1.jours.map(j => j.jourDeSemaine)).toEqual([0, 1, 2, 3, 4, 5, 6, 0, 1]);
    expect(w1.jours.filter(j => j.weekEnd).map(j => j.iso)).toEqual(['2026-09-05', '2026-09-06']);
  });

  it('un événement à cheval sur deux semaines apparaît dans LES DEUX', () => {
    /** MUTATION QUI ROUGIT : rattacher l'événement à la seule semaine de son début. */
    const vacances = evenement('vacances', 'evenement', '2026-09-07', '2026-09-10', { peutSEntrainer: false });
    const lignes = zoomDeSemaines(lignesDeMacro(PROGRAMME, AUJOURDHUI), [vacances], AUJOURDHUI);
    const [w1, w2] = lignes.filter(l => l.nature === 'semaine');
    expect([w1, w2].map(l => l.nature === 'semaine' && l.evenements.map(e => e.id))).toEqual([['vacances'], ['vacances']]);
    // Et seuls ses jours sont indisponibles.
    if (w2.nature !== 'semaine') throw new Error('attendu : une semaine');
    expect(w2.jours.filter(j => j.indisponible).map(j => j.iso)).toEqual(['2026-09-09', '2026-09-10']);
  });

  it('la fenêtre glisse autour d’aujourd’hui : 3 semaines avant, 5 à partir de la courante', () => {
    const longues = [macro('m', 1, '', [bloc('b', 1, 'X', Array.from({ length: 12 }, (_, i): Semaine => {
      const d = new Date(Date.UTC(2026, 7, 3 + i * 7));
      const f = new Date(Date.UTC(2026, 7, 9 + i * 7));
      return [`w${i + 1}`, i + 1, d.toISOString().slice(0, 10), f.toISOString().slice(0, 10)];
    }))])];
    const lignes = zoomDeSemaines(lignesDeMacro(longues, AUJOURDHUI), [], AUJOURDHUI);
    // Le 16/09 tombe dans la 7e semaine (14 → 20 septembre).
    expect(lignes.map(l => l.nature === 'semaine' && l.semaine.id)).toEqual(['w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10', 'w11']);
  });
});

describe('le bandeau de situation', () => {
  it('la position dit la semaine RÉELLE du bloc courant, et les jours qui restent', () => {
    const sit = situation(lignesDeMacro(PROGRAMME, AUJOURDHUI), [], AUJOURDHUI);
    expect(sit.position && {
      bloc: sit.position.bloc.nom, rang: sit.position.rangSemaine, sur: sit.position.nbSemaines,
      duree: sit.position.semaine?.duree, restants: sit.position.joursRestants,
    }).toEqual({ bloc: 'Intensification', rang: 1, sur: 2, duree: 7, restants: 13 });
  });

  it('les semaines de préparation se COMPTENT, elles ne se divisent pas par 7', () => {
    /** Compétition le 3 octobre, à 17 jours : w3, w4 et w5 commencent avant elle,
     *  soit TROIS semaines réelles — là où `17 / 7` en donnerait deux.
     *  MUTATION QUI ROUGIT : `Math.floor(dansJours / 7)`. */
    const lignes = lignesDeMacro(PROGRAMME, AUJOURDHUI);
    const compet = evenement('FNSL', 'competition', '2026-10-03', '2026-10-03');
    expect(situation(lignes, [compet], AUJOURDHUI).prochaineCompetition?.semainesDePrepa).toBe(3);
  });

  it('la prochaine compétition est la plus PROCHE, pas la première saisie', () => {
    const lignes = lignesDeMacro(PROGRAMME, AUJOURDHUI);
    const loin = evenement('Final Rep Euro', 'competition', '2027-01-10', '2027-01-11');
    const pres = evenement('FNSL Inter-Région', 'competition', '2026-10-25', '2026-10-26');
    const passee = evenement('FNSL Région', 'competition', '2026-07-18', '2026-07-18');
    expect(situation(lignes, [loin, passee, pres], AUJOURDHUI).prochaineCompetition?.evenement.nom).toBe('FNSL Inter-Région');
  });
});

describe('les jalons à venir', () => {
  it('un par événement STRUCTUREL, triés par date — pas un jour par ligne', () => {
    const lignes = lignesDeMacro(PROGRAMME, AUJOURDHUI);
    const jalons = jalonsAVenir(lignes, [evenement('FNSL', 'competition', '2026-10-03', '2026-10-03')], AUJOURDHUI);
    expect(jalons.map(j => `${j.date} ${j.nature}`)).toEqual([
      '2026-09-29 fin-bloc',      // Intensification, en cours : sa fin, pas son début
      '2026-09-30 debut-bloc',    // PEAKING
      '2026-10-03 competition',
      '2026-10-06 fin-bloc',
    ]);
  });

  it('une compétition dit pendant quel bloc elle tombe', () => {
    const lignes = lignesDeMacro(PROGRAMME, AUJOURDHUI);
    const [j] = jalonsAVenir(lignes, [evenement('FNSL', 'competition', '2026-10-03', '2026-10-03')], AUJOURDHUI)
      .filter(x => x.nature === 'competition');
    expect(j.nature === 'competition' && j.blocPendant?.nom).toBe('PEAKING');
  });
});

describe('ce qui mène ailleurs', () => {
  it('un bloc s’ouvre sur la semaine d’AUJOURD’HUI s’il est en cours, sur sa première sinon', () => {
    const [l] = lignesDeMacro(PROGRAMME, '2026-09-24');
    expect(semaineDEntree(l.blocs[1])?.id).toBe('w4');
    expect(semaineDEntree(l.blocs[2])?.id).toBe('w5');
  });

  it('les objectifs du bloc voyagent jusqu’à la frise, avec leur état atteint', () => {
    const [l] = lignesDeMacro(PROGRAMME, AUJOURDHUI);
    expect(l.blocs[0].objectifs).toEqual([
      { exercice: 'SQUAT', variante: '', format: '', series: '5', reps: '5', chargeMin: '100', chargeMax: '', atteint: true },
    ]);
  });
});

describe('le type de bloc, qui dit sa couleur', () => {
  it.each([
    ['Accumulation', 'accumulation'], ['Intensification', 'intensification'], ['Force', 'intensification'],
    ['PEAKING', 'realisation'], ['Affûtage', 'realisation'], ['Décharge', 'deload'],
  ])('« %s » → %s', (nom, type) => {
    expect(typeDeBloc(nom)).toBe(type);
  });

  it('⚠️ un nom qui ne dit rien sort GRIS, et c’est voulu : le gris n’affirme rien', () => {
    expect(typeDeBloc('Bloc 1')).toBe('deload');
  });
});

describe('les chevauchements — une erreur de saisie qui doit se voir', () => {
  /** William, 16/09 : « si ça se recouvre c'est ok, du moment que visuellement ça
   *  se voit ». 4 paires en production, dont 3 dans un même macro — où la seconde
   *  bande cachait la première. */
  it('deux blocs qui se recouvrent donnent la plage commune, jour pour jour', () => {
    /** MUTATION QUI ROUGIT : ne comparer que des blocs consécutifs du même macro
     *  (le cas entre macros disparaît). */
    const programme = [
      macro('m1', 1, 'A', [bloc('b1', 1, 'Accumulation', [['w1', 1, '2026-09-01', '2026-09-14']])]),
      macro('m2', 2, 'B', [bloc('b2', 1, 'Intensification', [['w2', 1, '2026-09-10', '2026-09-20']])]),
    ];
    const [c] = chevauchements(lignesDeMacro(programme, AUJOURDHUI));
    expect(c && { a: c.a.id, b: c.b.id, debut: c.debut, fin: c.fin, jours: c.jours })
      .toEqual({ a: 'b1', b: 'b2', debut: '2026-09-10', fin: '2026-09-14', jours: 5 });
  });

  it('des blocs qui se SUIVENT ne se chevauchent pas — le trou non plus', () => {
    /** MUTATION QUI ROUGIT : `b.debut >= a.fin` (un jour de contact compté comme recouvrement). */
    expect(chevauchements(lignesDeMacro(PROGRAMME, AUJOURDHUI))).toEqual([]);
  });
});
