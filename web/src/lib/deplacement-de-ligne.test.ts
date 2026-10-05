import { describe, expect, it } from 'vitest';

import type { ExerciseEditing } from '@/api/types';
import { deplacerEntreSeances, ligneGlissee, poserLaLigneGlissee, porteUneLigne } from '@/lib/deplacement-de-ligne';

/** DÉPLACER UNE LIGNE D'UNE SÉANCE À L'AUTRE — FRE-188.
 *
 *  Le bloc part, pas la ligne : c'est la règle de FRE-31 pour l'intérieur d'une
 *  séance, et elle vaut entre deux séances. Le serveur tient la même règle
 *  (`deplacer_vers`) : la spec d'ici garde le miroir local, celle de brokkr la
 *  base.
 *
 *  MUTATION QUI ROUGIT : extraire `[index, index]` au lieu du bloc — le
 *  partenaire du bi-set reste derrière. */

const ligne = (id: string, groupId: string | null = null) =>
  ({ id, name: id, groupId, groupKind: null, exercises: undefined } as unknown as ExerciseEditing);
const ids = (l: ExerciseEditing[]) => l.map(x => x.id);

describe('deplacerEntreSeances', () => {
  it('déplace la ligne seule à la position demandée, et rend cette position', () => {
    const a = [ligne('a1'), ligne('a2'), ligne('a3')];
    const b = [ligne('b1'), ligne('b2')];
    expect(deplacerEntreSeances(a, 1, b, 1)).toBe(1);
    expect(ids(a)).toEqual(['a1', 'a3']);
    expect(ids(b)).toEqual(['b1', 'a2', 'b2']);
  });

  it('emporte le GROUPE entier, consécutif, avec son identifiant', () => {
    const a = [ligne('a1'), ligne('c1', 'biset'), ligne('c2', 'biset'), ligne('a4')];
    const b = [ligne('b1')];
    expect(deplacerEntreSeances(a, 2, b, 0)).toBe(0);
    expect(ids(a)).toEqual(['a1', 'a4']);
    expect(ids(b)).toEqual(['c1', 'c2', 'b1']);
    expect(b[0].groupId).toBe('biset');
  });

  it('ne se pose jamais AU MILIEU d’un groupe de la cible : après lui', () => {
    const a = [ligne('a1')];
    const b = [ligne('g1', 'g'), ligne('g2', 'g'), ligne('b3')];
    expect(deplacerEntreSeances(a, 0, b, 1)).toBe(2);
    expect(ids(b)).toEqual(['g1', 'g2', 'a1', 'b3']);
  });

  it('une position au-delà de la fin place en dernier', () => {
    const a = [ligne('a1')];
    const b = [ligne('b1')];
    expect(deplacerEntreSeances(a, 0, b, 99)).toBe(1);
    expect(ids(b)).toEqual(['b1', 'a1']);
  });
});

describe('la ligne glissée', () => {
  const fauxDataTransfer = () => {
    const store = new Map<string, string>();
    const faux = {
      types: [] as string[],
      effectAllowed: 'none',
      setData(t: string, v: string) { store.set(t, v); faux.types = [...store.keys()]; },
      getData(t: string) { return store.get(t) ?? ''; },
    };
    return faux as unknown as DataTransfer;
  };

  it('traverse les tableaux par dataTransfer, et se relit telle quelle', () => {
    const dt = fauxDataTransfer();
    poserLaLigneGlissee(dt, { sessionId: 's1', index: 2 });
    expect(porteUneLigne(dt)).toBe(true);
    expect(ligneGlissee(dt)).toEqual({ sessionId: 's1', index: 2 });
  });

  it('un glissement d’autre chose n’est pas une ligne', () => {
    const dt = fauxDataTransfer();
    expect(porteUneLigne(dt)).toBe(false);
    expect(ligneGlissee(dt)).toBeNull();
    dt.setData('application/x-hodos-ligne', '{"pas":"une ligne"}');
    expect(ligneGlissee(dt)).toBeNull();
  });
});
