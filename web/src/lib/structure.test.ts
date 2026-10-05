import { describe, expect, it } from 'vitest';
import type { Me } from '@/api/types';
import { structureCourante, vuDepuis, type StructureDeMoi } from './structure';

/** FRE-13 — la règle qui décide où l'on arrive, et ce qu'on y est. */
const FF: StructureDeMoi = { slug: 'french-forge', nom: 'French Forge', isCoach: false, isKine: false, athleteId: 'fiche-nico' };
const SC: StructureDeMoi = { slug: 'scappulift', nom: 'SCAPPULIFT', isCoach: true, isKine: false, athleteId: null };
const nico: Me = { uid: 'nico', email: 'n@x.fr', displayName: 'Nico', isCoach: true, isKine: false,
                   isAdmin: false, athleteId: 'fiche-nico', structures: [FF, SC] };

describe('structureCourante', () => {
  it('garde celle retenue sur l’appareil', () => {
    expect(structureCourante([FF, SC], 'french-forge')?.slug).toBe('french-forge');
  });
  it('au premier lancement, arrive là où il est STAFF — pas là où il s’entraîne', () => {
    expect(structureCourante([FF, SC], null)?.slug).toBe('scappulift');
  });
  it('ignore une structure retenue dont le compte ne fait plus partie', () => {
    expect(structureCourante([FF], 'scappulift')?.slug).toBe('french-forge');
  });
  it('rend null pour un compte sans structure', () => {
    expect(structureCourante([], 'french-forge')).toBeNull();
  });
});

describe('vuDepuis', () => {
  it('prend les rôles et la fiche de LÀ, garde l’admin', () => {
    expect(vuDepuis({ ...nico, isAdmin: true }, SC)).toMatchObject({ isCoach: true, athleteId: null, isAdmin: true });
    expect(vuDepuis(nico, FF)).toMatchObject({ isCoach: false, athleteId: 'fiche-nico' });
  });
});
