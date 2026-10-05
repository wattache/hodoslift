import { describe, expect, it } from 'vitest';

import type { Exercise } from '@/api/types';
import { ciblesDeRecopie } from '@/lib/recopie';

/** Les lignes qu'une recopie écrit (Passe 3, constat 05). La grille, elle, est
 *  éprouvée par `e2e/recopie.spec.ts` ; ici, les cas de bord qu'un glisser à la
 *  souris rendrait lents à atteindre. */

const ligne = (kind: Exercise['kind'] = null, groupId = '', groupKind: Exercise['groupKind'] = null) =>
  ({ kind, groupId, groupKind }) as Pick<Exercise, 'kind' | 'groupId' | 'groupKind'>;

describe('ciblesDeRecopie', () => {
  it('écrit les lignes traversées, pas la source', () => {
    expect(ciblesDeRecopie([ligne(), ligne(), ligne(), ligne()], 'weight', 0, 2)).toEqual([1, 2]);
  });

  it('ne remonte pas : tirer au-dessus de la source n’écrit rien', () => {
    expect(ciblesDeRecopie([ligne(), ligne(), ligne()], 'weight', 2, 0)).toEqual([]);
  });

  /** MUTATION QUI ROUGIT : `continue` au lieu de `break` sur la nature. */
  it('s’arrête AVANT la première ligne d’une autre nature, même si le pointeur va plus loin', () => {
    const lignes = [ligne('warmup'), ligne('warmup'), ligne(), ligne('warmup')];
    expect(ciblesDeRecopie(lignes, 'weight', 0, 3)).toEqual([1]);
  });

  it('« entraînement » absent et explicite sont la même nature', () => {
    expect(ciblesDeRecopie([ligne(null), ligne('training')], 'reps', 0, 1)).toEqual([1]);
  });

  it('saute la case « ↑ » d’un bi-set pour les séries, sans s’arrêter', () => {
    const lignes = [ligne(), ligne(null, 'g1', 'biset'), ligne(null, 'g1', 'biset'), ligne()];
    expect(ciblesDeRecopie(lignes, 'sets', 0, 3)).toEqual([1, 3]);
    // La charge, elle, se saisit ligne par ligne.
    expect(ciblesDeRecopie(lignes, 'weight', 0, 3)).toEqual([1, 2, 3]);
  });

  it('n’écrit aucun repos dans un dropset', () => {
    const lignes = [ligne(), ligne(null, 'd1', 'dropset'), ligne(null, 'd1', 'dropset'), ligne()];
    expect(ciblesDeRecopie(lignes, 'rest', 0, 3)).toEqual([3]);
  });
});
