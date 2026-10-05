// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Athlete } from '@/api/types';

/** QUI EST SÉLECTIONNÉ QUAND IL N'Y A PLUS DE RÉSEAU — FRE-118.
 *
 *  ⚠️ CE FICHIER NAÎT D'UN DÉFAUT SIGNALÉ, PAS D'UN INVENTAIRE. William a coupé
 *  son Wi-Fi, ouvert « Entraînement », et lu « Aucun athlète sélectionné » — sans
 *  aucun à sélectionner. Sa semaine était pourtant sur le disque : rien ne
 *  pouvait la relier à quelqu'un.
 *
 *  ⚠️ ET LE HARNAIS RÉEL NE POUVAIT PAS LE VOIR. Son compte athlète n'a qu'UNE
 *  fiche, donc l'ancienne règle — « on persiste l'annuaire s'il ne porte qu'un
 *  nom » — le laissait passer. Le premier utilisateur du produit, lui, est coach
 *  ET athlète : soixante fiches, donc rien de persisté, donc rien à sélectionner.
 *  C'est le décor du test qui manquait, pas la logique.
 */
const me = { uid: 'u-1', athleteId: 'a-moi', isCoach: true };
let miens: Athlete[] = [];
let suivis: Athlete[] = [];
let monAthlete: Athlete | null = null;

const fiche = (id: string, prenom: string) =>
  ({ id, firstName: prenom, coachId: 'u-1' } as unknown as Athlete);

vi.mock('@/api/hooks/use-me', () => ({ useMe: () => ({ data: me }) }));
vi.mock('@/api/hooks/use-athletes', () => ({
  useMyAthletes: () => ({ data: miens, isLoading: false }),
  useAthletesSuivis: () => ({ data: suivis }),
  useMonAthlete: () => ({ data: monAthlete }),
}));

const { AthleteSelectionProvider, useAthleteSelection } =
  await import('@/lib/athlete-selection');

const monter = () => renderHook(() => useAthleteSelection(), {
  wrapper: ({ children }: { children: ReactNode }) =>
    createElement(AthleteSelectionProvider, null, children),
});

/** ⚠️ UN `localStorage` FOURNI À LA MAIN. Node expose un global expérimental du
 *  même nom qui MASQUE celui de jsdom et vaut `undefined` — même piège que dans
 *  `training-editor.test.ts`, et la sélection courante s'y persiste. */
function memoire(): Storage {
  const donnees = new Map<string, string>();
  return {
    get length() { return donnees.size; },
    key: (i: number) => [...donnees.keys()][i] ?? null,
    getItem: (k: string) => donnees.get(k) ?? null,
    setItem: (k: string, v: string) => { donnees.set(k, String(v)); },
    removeItem: (k: string) => { donnees.delete(k); },
    clear: () => { donnees.clear(); },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoire());
  miens = []; suivis = []; monAthlete = null;
});

describe('hors ligne, il reste MA fiche', () => {
  it('⚠️ sans réseau, on retombe sur soi au lieu de n’avoir personne', () => {
    // Les deux listes viennent du réseau : vides. Seule la fiche relue du
    // disque subsiste — et c'est bien celle dont on veut le programme.
    monAthlete = fiche('a-moi', 'Willi');

    const { result } = monter();
    expect(result.current.selected?.id).toBe('a-moi');
    expect(result.current.athletes).toHaveLength(1);
    expect(result.current.isSelf).toBe(true);
    // ⚠️ ET IL PEUT ÉDITER : sans ça il verrait sa séance sans pouvoir y saisir
    // son réalisé, ce qui est exactement ce que le hors-ligne promet.
    expect(result.current.canEdit).toBe(true);
  });

  it('sans réseau ET sans fiche gardée, on ne prétend rien', () => {
    const { result } = monter();
    expect(result.current.selected).toBeNull();
    expect(result.current.athletes).toEqual([]);
  });
});

describe('en ligne, elle ne change rien', () => {
  it('⚠️ elle ne se DOUBLE pas : elle est déjà dans la liste', () => {
    // Le défaut symétrique, et le plus probable à l'usage : la même personne
    // apparaissant deux fois dans le sélecteur du coach.
    miens = [fiche('a-moi', 'Willi'), fiche('a-2', 'Cyssi')];
    monAthlete = fiche('a-moi', 'Willi');

    const { result } = monter();
    expect(result.current.athletes.map(a => a.id)).toEqual(['a-moi', 'a-2']);
  });

  it('la sélection reste celle du coach, pas soi d’office', () => {
    miens = [fiche('a-moi', 'Willi'), fiche('a-2', 'Cyssi')];
    monAthlete = fiche('a-moi', 'Willi');
    localStorage.setItem('eitri-selected-athlete:u-1', 'a-2');

    const { result } = monter();
    expect(result.current.selected?.id).toBe('a-2');
  });

  it('un athlète SUIVI par la kiné n’est pas évincé par ma fiche', () => {
    suivis = [fiche('a-suivi', 'Thomas')];
    monAthlete = fiche('a-moi', 'Willi');

    const { result } = monter();
    expect(result.current.athletes.map(a => a.id)).toEqual(['a-suivi', 'a-moi']);
  });
});
