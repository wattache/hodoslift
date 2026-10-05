import { describe, expect, it } from 'vitest';

import {
  MAX_VARIANTES, afficherVariantes, basculerVariante, cleVariantes, lireVariantes,
} from '@/lib/variantes';

/** Ce que les e2e ne peuvent PAS atteindre (FRE-33).
 *
 *  Les deux formes de la donnée — chaîne héritée et liste — produisent le même
 *  écran quand tout va bien. Une régression sur la lecture ne se voit donc pas
 *  en parcourant l'interface : elle se voit sur une VIEILLE séance, celle d'un
 *  athlète dont plus personne ne regarde les blocs de mars. */

describe('lireVariantes', () => {
  it('lit la forme historique — une chaîne', () => {
    expect(lireVariantes('DS')).toEqual(['DS']);
  });

  it('lit la forme actuelle — une liste', () => {
    expect(lireVariantes(['DS', 'PAUSE'])).toEqual(['DS', 'PAUSE']);
  });

  it('l’absence de variante ne casse rien, quelle que soit sa façon de s’écrire', () => {
    for (const vide of [undefined, null, '', '   ', [], ['', '  ']]) {
      expect(lireVariantes(vide)).toEqual([]);
    }
  });

  it('ne devine rien d’un type inattendu', () => {
    expect(lireVariantes(3)).toEqual([]);
    expect(lireVariantes({ a: 1 })).toEqual([]);
    expect(lireVariantes([1, null, 'DS'])).toEqual(['DS']);
  });

  it('rogne les bords sans toucher à la casse — l’affichage n’est pas une clé', () => {
    expect(lireVariantes([' Pause '])).toEqual(['Pause']);
  });
});

describe('afficherVariantes', () => {
  it('joint au « + », qui dit le cumul', () => {
    // Le « · » est déjà pris : il sépare le nom de l'exercice de sa variante.
    expect(afficherVariantes(['DS', 'PAUSE'])).toBe('DS + PAUSE');
  });

  it('conserve l’ordre de saisie du coach', () => {
    expect(afficherVariantes(['PAUSE', 'DS'])).toBe('PAUSE + DS');
  });

  it('rend une chaîne vide quand il n’y a rien — jamais « undefined »', () => {
    expect(afficherVariantes(undefined)).toBe('');
  });
});

describe('cleVariantes', () => {
  it('L’INVERSE DE L’AFFICHAGE : triée, donc insensible à l’ordre', () => {
    // Deux lignes aux mêmes qualificatifs sont le MÊME exercice : elles doivent
    // partager historique, progression et records. Sans tri, ressaisir dans
    // l'autre ordre couperait la courbe en deux, silencieusement.
    expect(cleVariantes(['PAUSE', 'DS'])).toBe(cleVariantes(['DS', 'PAUSE']));
  });

  it('insensible à la casse', () => {
    expect(cleVariantes(['pause'])).toBe(cleVariantes(['PAUSE']));
  });

  it('la chaîne héritée et la liste équivalente ont la MÊME clé', () => {
    // Sans quoi la migration des données couperait toutes les progressions en deux.
    expect(cleVariantes('DS')).toBe(cleVariantes(['DS']));
  });

  it('aucune variante donne une clé vide', () => {
    expect(cleVariantes(undefined)).toBe('');
  });
});

describe('basculerVariante', () => {
  it('ajoute en fin de liste', () => {
    expect(basculerVariante(['DS'], 'PAUSE')).toEqual(['DS', 'PAUSE']);
  });

  it('retire une variante déjà présente', () => {
    expect(basculerVariante(['DS', 'PAUSE'], 'DS')).toEqual(['PAUSE']);
  });

  it('retire sans se soucier de la casse', () => {
    expect(basculerVariante(['Pause'], 'PAUSE')).toEqual([]);
  });

  it('refuse d’aller au-delà du maximum, sans rien casser', () => {
    const pleine = ['A', 'B', 'C'];
    expect(basculerVariante(pleine, 'D')).toEqual(pleine);
    // …mais retirer reste toujours possible, même à la limite.
    expect(basculerVariante(pleine, 'B')).toEqual(['A', 'C']);
    expect(pleine).toHaveLength(MAX_VARIANTES);
  });

  it('part d’une chaîne héritée sans la perdre', () => {
    expect(basculerVariante('DS', 'PAUSE')).toEqual(['DS', 'PAUSE']);
  });
});
