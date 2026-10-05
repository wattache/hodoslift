import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  Categorie,
  Groupe,
  LireBibliothequeResponseSchema,
} from '@/gen/hodos/bibliotheque/v1/bibliotheque_pb';
import { gestesDuPatch, versCreation, versGroupe, versLibrary } from '@/api/bibliotheque';

describe('versLibrary', () => {
  it('omet competition hors exercices et supports quand il n’y en a pas, comme brokkr', () => {
    const res = create(LireBibliothequeResponseSchema, {
      exercices: [{ id: 'a', name: 'MUSCLE UP', competition: true, supports: [] }],
      assistances: [{ id: 'b', name: 'ROWING', competition: false, supports: [Groupe.PU, Groupe.MU] }],
      tempos: [{ id: 'c', name: '3-0-1', competition: false, supports: [] }],
    });
    const lib = versLibrary(res);
    expect(lib.exercices).toEqual([{ id: 'a', name: 'MUSCLE UP', competition: true }]);
    expect(lib.assistances).toEqual([{ id: 'b', name: 'ROWING', supports: ['PU', 'MU'] }]);
    expect(lib.tempos).toEqual([{ id: 'c', name: '3-0-1' }]);
    expect(lib.variantes).toEqual([]);
    expect(lib.formats).toEqual([]);
  });
});

describe('versCreation', () => {
  it('traduit la catégorie et les groupes, et pose la structure', () => {
    const req = versCreation({ category: 'assistances', name: 'ROWING', supports: ['pu', ' MU '] }, 'scappulift');
    expect(req.categorie).toBe(Categorie.ASSISTANCES);
    expect(req.supports).toEqual([Groupe.PU, Groupe.MU]);
    expect(req.structure).toBe('scappulift');
    expect(req.competition).toBe(false);
  });
  it('un groupe inconnu part en UNSPECIFIED, que le serveur refuse — il n’est pas écarté', () => {
    expect(versGroupe('EPAULE')).toBe(Groupe.UNSPECIFIED);
    expect(versCreation({ category: 'assistances', name: 'X', supports: ['MU', 'EPAULE'] }, null).supports)
      .toEqual([Groupe.MU, Groupe.UNSPECIFIED]);
  });
});

describe('gestesDuPatch', () => {
  it('la présence de la clé tranche : supports vide est un geste, name absent n’en est pas', () => {
    expect(gestesDuPatch({ supports: [] })).toEqual([{ geste: 'soutiens', supports: [] }]);
    expect(gestesDuPatch({ name: 'X' })).toEqual([{ geste: 'renommer', name: 'X' }]);
    expect(gestesDuPatch({ competition: false })).toEqual([{ geste: 'marquer', competition: false }]);
    expect(gestesDuPatch({})).toEqual([]);
  });
});
