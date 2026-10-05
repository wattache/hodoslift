import { describe, expect, it } from 'vitest';

import { ecartDeLObjectif, lePlusProche } from '@/lib/ecart-objectif';
import type { Goal, RecordDeForce } from '@/api/types';

/** L'ÉCART D'UN OBJECTIF (FRE-172).
 *
 *  ⚠️ CE N'EST PAS DE L'APPARENCE, C'EST UNE RÈGLE. « Dips 8 @ 70 » se compare au
 *  record À HUIT REPS, pas au 1RM — et sans record à ce schéma, on dit « pas de
 *  record » plutôt qu'un écart contre zéro. Les deux fautes donnent un nombre qui
 *  se lit comme une mesure et n'en est pas une ; aucune ne se voit à l'œil.
 */

const objectif = (exercise: string, reps: string, weight: string): Goal => ({
  id: 'g1', exercise, sets: '1', reps, weight, motivation: '',
  createdAt: '2026-06-02', achievedAt: null,
} as Goal);

const record = (movement: string, reps: number, weight: number): RecordDeForce => ({
  movement, reps, weight, sets: '', variant: '', format: '', clusterMode: '',
  rpe: '', date: '2026-08-01', location: '',
});

describe('ecartDeLObjectif', () => {
  it('compare au record AU MÊME NOMBRE DE REPS', () => {
    /** ⚠️ LA FAUTE QUE CETTE SPEC GARDE. Avec un 1RM de 90 et un record à 8 reps
     *  de 65, comparer au 1RM annoncerait l'objectif DÉPASSÉ alors qu'il reste
     *  5 kg. Les deux records sont donc présents, et seul celui à 8 doit servir. */
    const e = ecartDeLObjectif(objectif('DIPS', '8', '70'),
                               [record('DIPS', 1, 90), record('DIPS', 8, 65)]);
    expect(e).toMatchObject({ etat: 'mesure', actuel: 65, restant: 5 });
  });

  it('dit « pas de record » plutôt qu’un écart contre zéro', () => {
    // ⚠️ « +70 kg » laisserait croire qu'on part de rien. On ne SAIT pas : cet
    // athlète n'a jamais été mesuré sur ce schéma. Même règle que le 1RM
    // manquant de la Table RM, qui rend un tiret et non un zéro.
    const e = ecartDeLObjectif(objectif('DIPS', '8', '70'), [record('DIPS', 1, 90)]);
    expect(e).toEqual({ etat: 'sans-record', cible: 70 });
  });

  it('compte les records de COMPÉTITION, pas seulement l’entraînement', () => {
    /** ⚠️ LA FAUTE QUE WILLIAM A TROUVÉE À L'ŒIL, et c'était le cas MAJORITAIRE :
     *  33 des 44 objectifs ouverts en production visent un single, et
     *  `computeCompetitionPRs` ne rend justement que des singles. Un athlète qui
     *  a fait 180 au squat en compétition mais jamais à l'entraînement se voyait
     *  annoncer « pas de record » — alors que la grille juste au-dessus affichait
     *  son 180. Deux endroits de l'écran se contredisaient sur le même athlète.
     *
     *  MUTATION QUI ROUGIT : retirer `competitionPRs` de `recordAuxReps`. */
    const e = ecartDeLObjectif(objectif('SQUAT', '1', '200'), [], undefined,
                               { SQUAT: { weight: 180 } });
    expect(e).toMatchObject({ etat: 'mesure', actuel: 180, restant: 20 });
  });

  it('la compétition ne compte QUE sur un single', () => {
    // Le contre-exemple, et il porte la moitié de la règle : `CompetitionPR` a
    // toujours `reps: 1`. L'appliquer à « 5 reps @ 150 » annoncerait un écart
    // contre une performance qui n'a rien à voir avec ce schéma.
    const e = ecartDeLObjectif(objectif('SQUAT', '5', '150'), [], undefined,
                               { SQUAT: { weight: 180 } });
    expect(e).toEqual({ etat: 'sans-record', cible: 150 });
  });

  it('retient le PLUS GRAND des trois sources', () => {
    const e = ecartDeLObjectif(objectif('SQUAT', '1', '200'), [record('SQUAT', 1, 160)],
                               { SQUAT: { 1: 170 } }, { SQUAT: { weight: 185 } });
    expect(e).toMatchObject({ actuel: 185, restant: 15 });
  });

  it('rend l’écart NÉGATIF quand l’objectif est dépassé', () => {
    const e = ecartDeLObjectif(objectif('SQUAT', '1', '100'), [record('SQUAT', 1, 120)]);
    expect(e).toMatchObject({ etat: 'mesure', restant: -20, progression: 1 });
  });

  it('retient le meilleur des deux sources, serveur ou manuel', () => {
    // La grille des records fusionne déjà les deux ; l'écart doit dire le même
    // chiffre qu'elle, sinon deux endroits de l'écran se contredisent.
    const e = ecartDeLObjectif(objectif('SQUAT', '3', '150'),
                               [record('SQUAT', 3, 130)], { SQUAT: { 3: 140 } });
    expect(e).toMatchObject({ actuel: 140, restant: 10 });
  });

  it('rapproche les mouvements malgré la casse', () => {
    const e = ecartDeLObjectif(objectif('muscle up', '1', '20'), [record('MUSCLE UP', 1, 15)]);
    expect(e).toMatchObject({ etat: 'mesure', restant: 5 });
  });

  it('un objectif sans cible chiffrée n’a rien à comparer', () => {
    expect(ecartDeLObjectif(objectif('DIPS', '1', ''), [])).toEqual({ etat: 'sans-cible' });
    expect(ecartDeLObjectif(objectif('DIPS', '1', '0'), [])).toEqual({ etat: 'sans-cible' });
  });
});

describe('lePlusProche', () => {
  const records = [record('DIPS', 8, 65), record('MUSCLE UP', 1, 15), record('SQUAT', 1, 120)];
  const ecartDe = (g: Goal) => ecartDeLObjectif(g, records);

  it('désigne celui auquel il reste le moins', () => {
    const liste = [objectif('DIPS', '8', '70'), objectif('MUSCLE UP', '1', '17')];
    expect(lePlusProche(liste, ecartDe)?.item.exercise).toBe('MUSCLE UP'); // +2 contre +5
  });

  it('ignore ceux SANS RECORD — on ne peut pas dire qu’ils sont proches', () => {
    // ⚠️ SANS CE FILTRE, un objectif jamais mesuré remonterait en tête d'un écran
    // dont toute la promesse est de dire « travaille ça maintenant ».
    const liste = [objectif('CHIN UP', '1', '30'), objectif('DIPS', '8', '70')];
    expect(lePlusProche(liste, ecartDe)?.item.exercise).toBe('DIPS');
  });

  it('ignore ceux DÉJÀ DÉPASSÉS', () => {
    const liste = [objectif('SQUAT', '1', '100'), objectif('DIPS', '8', '70')];
    expect(lePlusProche(liste, ecartDe)?.item.exercise).toBe('DIPS');
  });

  it('rend null quand rien n’est comparable', () => {
    expect(lePlusProche([objectif('CHIN UP', '1', '30')], ecartDe)).toBeNull();
  });
});
