import { describe, expect, it } from 'vitest';

import type { Principle } from '@/api/types';
import { memeLien, objectifDepuisLaLigne } from './objectif-depuis-ligne';

describe('un objectif depuis une ligne de BASE', () => {
  it('reprend toute la prescription, format et options compris', () => {
    /** MUTATION QUI ROUGIT : oublier `clusterMode` — le défaut signalé (« FORMAT mais pas ses options »). */
    const ligne = { name: 'MUSCLE UP', variant: ['NO DIPS', 'CHEST'], format: 'CLUSTER', clusterMode: '1/1/1',
      clusterRest: '15s', tempo: 'DS', sets: '7', reps: '1', weight: '2,5', assistance: '', tier: 2 } as unknown as Principle;
    expect(objectifDepuisLaLigne(ligne, 'principe')).toMatchObject({
      exercise: 'MUSCLE UP', variant: 'NO DIPS + CHEST', format: 'CLUSTER', clusterMode: '1/1/1', clusterRest: '15s',
      tempo: 'DS', sets: '7', reps: '1', weightMin: '2,5', weightMax: '', atteintLe: null,
      source: 'principe', tier: 2,
    });
  });

  it('un renfo n’a pas de tier', () => {
    const ligne = { name: 'HIP THRUST', variant: [], tier: 1 } as unknown as Principle;
    expect(objectifDepuisLaLigne(ligne, 'renfo')).toMatchObject({ source: 'renfo', tier: null });
  });
});

describe('le lien à une ligne de BASE', () => {
  const pu = { exercise: 'PULL UP', variant: '', format: 'EMOM', tempo: '', source: 'principe', tier: 1 } as never;
  it('reconnaît l’objectif déjà posé sur la même ligne, pas celui d’un autre tier', () => {
    /** MUTATION QUI ROUGIT : ignorer le tier — le tier 2 rouvrirait l’objectif du tier 1. */
    expect(memeLien(pu, { ...(pu as object), weightMin: '7,5' } as never)).toBe(true);
    expect(memeLien(pu, { ...(pu as object), tier: 2 } as never)).toBe(false);
    expect(memeLien({ ...(pu as object), source: null } as never, pu)).toBe(false);
  });
});
