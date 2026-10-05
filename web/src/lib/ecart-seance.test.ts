import { describe, expect, it } from 'vitest';

import { couleurDeLEcart, ecartDeLaSeance } from '@/lib/rpe';
import type { ExerciseEditing, SessionEditing } from '@/api/types';

/** L'ÉCART D'UNE SÉANCE (refonte des écrans, 09/2026).
 *
 *  ⚠️ CE QUE CES SPECS GARDENT, ET QUE `rpeDotColor` NE PEUT PAS DIRE. Le barème
 *  de couleur ne lit que la valeur absolue : sous 7,5 tout est vert. Un athlète
 *  qui tourne à 5,8 voyait donc une semaine uniformément verte — sans
 *  information. Ici on compare au VISÉ, et c'est l'écart qui parle.
 */

const exo = (aimedRPE: string, feltRPE: string): ExerciseEditing =>
  ({ aimedRPE, feltRPE } as unknown as ExerciseEditing);

const seance = (...exercises: ExerciseEditing[]): SessionEditing =>
  ({ exercises } as unknown as SessionEditing);

describe('ecartDeLaSeance', () => {
  it('tenu : le ressenti ne dépasse aucune cible', () => {
    expect(ecartDeLaSeance(seance(exo('8', '8'), exo('7', '6.5')))).toBe('tenu');
  });

  it('⚠️ un 6 sur un 5 prescrit DÉPASSE, alors que la couleur absolue le dit vert', () => {
    // Le cas exact du diagnostic : l'athlète qui tourne bas. `rpeDotColor('6')`
    // rend `--success` ; l'écart, lui, dit que la séance a coûté plus que prévu.
    expect(ecartDeLaSeance(seance(exo('5', '6')))).toBe('depasse');
  });

  it('⚠️ un 9 ressenti sur un 9 prescrit est TENU, alors que la couleur absolue le dit rouge', () => {
    expect(ecartDeLaSeance(seance(exo('9', '9')))).toBe('tenu');
  });

  it('⚠️ un ÉCHEC prime sur le reste, et ne se confond pas avec un dépassement', () => {
    // `rpeToNumber('FAIL')` vaut 10 : sans la branche dédiée, une barre ratée
    // deviendrait « un peu trop lourd ».
    expect(ecartDeLaSeance(seance(exo('8', '8'), exo('9', 'FAIL')))).toBe('echec');
    expect(couleurDeLEcart('echec')).toBe('var(--destructive)');
    expect(couleurDeLEcart('depasse')).toBe('var(--warning)');
  });

  it('⚠️ « aucune cible » n’est PAS « tenu » — et n’a pas de couleur', () => {
    // Affirmer « tenu » dirait ce que la donnée tait. Quatre états, pas trois.
    expect(ecartDeLaSeance(seance(exo('', '8'), exo('', '7')))).toBe('sans-cible');
    expect(couleurDeLEcart('sans-cible')).toBeUndefined();
  });

  it('une séance vide ne dit rien non plus', () => {
    expect(ecartDeLaSeance(seance())).toBe('sans-cible');
  });

  it('un exercice sans ressenti ne dépasse pas : il n’a pas eu lieu', () => {
    expect(ecartDeLaSeance(seance(exo('7', ''), exo('7', '7')))).toBe('tenu');
  });
});
