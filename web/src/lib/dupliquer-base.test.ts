import { describe, expect, it } from 'vitest';

import type { BaseAccessory, Principle } from '@/api/types';
import { dupliquerAccessoire, dupliquerPrincipe } from './dupliquer-base';

const principe = (name: string, tier: number, extra: Partial<Principle> = {}) =>
  ({ id: `id-${name}`, name, tier, kind: null, variant: ['ONESHOT'], sets: '3', reps: '8', weight: '25', increment: '3,75', incrementUnit: 'kg', ...extra } as unknown as Principle);
const acc = (name: string, groupId = '', extra: Partial<BaseAccessory> = {}) =>
  ({ id: `id-${name}`, name, day: 'J1', groupId, groupKind: groupId ? 'biset' : null, unbroken: false, sets: '3', reps: '10', ...extra } as unknown as BaseAccessory);

describe('dupliquer une ligne de BASE', () => {
  it('un principe : la copie porte la prescription, juste après, sans identité', () => {
    /** MUTATION QUI ROUGIT : placer la copie en fin de liste. */
    const r = dupliquerPrincipe([principe('PULL UP', 1), principe('DIPS', 2)], 0);
    expect(r.map(p => p.name)).toEqual(['PULL UP', 'PULL UP', 'DIPS']);
    expect(r[1]).toMatchObject({ id: '', tier: 1, variant: ['ONESHOT'], sets: '3', reps: '8', weight: '25', increment: '3,75' });
  });

  it('un accessoire en bi-set : la copie sort du groupe, et se place après le groupe', () => {
    /** MUTATION QUI ROUGIT : garder le `groupId` — le bi-set deviendrait un tri-set. */
    const liste = [acc('CURL', 'g1'), acc('TRICEPS', 'g1'), acc('SHRUG')];
    const r = dupliquerAccessoire(liste, 0);
    expect(r.map(a => a.name)).toEqual(['CURL', 'TRICEPS', 'CURL', 'SHRUG']);
    expect(r[2]).toMatchObject({ id: '', groupId: '', groupKind: null, unbroken: false, day: 'J1', sets: '3', reps: '10' });
    expect(r.filter(a => a.groupId === 'g1')).toHaveLength(2);
  });
});
