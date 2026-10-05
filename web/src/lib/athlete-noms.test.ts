import { describe, expect, it } from 'vitest';

import { correspondALaRecherche, nomAffiche, routeApresChangementDAthlete, segmentsDeRecherche } from '@/lib/athlete';

/** LA CASSE ET LA RECHERCHE DES NOMS D'ATHLÈTES (sidebar, refonte des écrans, 09/2026).
 *
 *  ⚠️ DEUX RÈGLES QU'AUCUN ŒIL NE GARDE À L'ÉCRAN. On regarde la sidebar avec
 *  quatre noms du dev-mock, tous déjà bien capitalisés et sans accent : ni le
 *  nom composé, ni l'apostrophe, ni « É » ne s'y présentent. La production, elle,
 *  porte 71 athlètes saisis à la main sur trois ans.
 */

describe('nomAffiche', () => {
  it('défait les capitales de saisie', () => {
    expect(nomAffiche('WILLI LAGACHETTE')).toBe('Willi Lagachette');
  });

  it('ouvre un segment sur le TIRET, pas seulement sur l’espace', () => {
    // ⚠️ SANS CETTE BRANCHE : « Jean-pierre ». Le défaut est invisible sur le
    // dev-mock, qui n'a aucun prénom composé.
    expect(nomAffiche('JEAN-PIERRE')).toBe('Jean-Pierre');
    expect(nomAffiche('MARIE-ANGE DU BOIS-RENARD')).toBe('Marie-Ange Du Bois-Renard');
  });

  it('ouvre un segment sur l’APOSTROPHE, droite comme courbe', () => {
    // La courbe est celle que produit un clavier français ; la droite, celle des
    // imports. Les deux existent en base.
    expect(nomAffiche("O'BRIEN")).toBe("O'Brien");
    expect(nomAffiche('O’BRIEN')).toBe('O’Brien');
  });

  it('garde les accents en les capitalisant', () => {
    expect(nomAffiche('ÉLÉONORE')).toBe('Éléonore');
    expect(nomAffiche('éléonore')).toBe('Éléonore');
  });

  it('ne touche pas à un nom déjà correct', () => {
    expect(nomAffiche('Léa Martin')).toBe('Léa Martin');
  });
});

describe('correspondALaRecherche', () => {
  const willi = { firstName: 'WILLI', lastName: 'LAGACHETTE' };
  const eleonore = { firstName: 'Éléonore', lastName: 'Vasseur' };

  it('trouve sur le NOM alors qu’on a tapé en minuscules', () => {
    expect(correspondALaRecherche(willi, 'lag')).toBe(true);
  });

  it('trouve un prénom accentué tapé SANS accent', () => {
    // ⚠️ LA RAISON D'ÊTRE DU PLI. On tape « ele » au clavier, pas « Élé » : une
    // recherche qui compare les chaînes brutes ne trouve jamais un prénom
    // accentué, c'est-à-dire une bonne part de la liste.
    expect(correspondALaRecherche(eleonore, 'ele')).toBe(true);
    expect(correspondALaRecherche(eleonore, 'éléo')).toBe(true);
  });

  it('trouve sur le prénom ET le nom accolés', () => {
    expect(correspondALaRecherche(willi, 'willi lag')).toBe(true);
  });

  it('ne trouve pas ce qui n’y est pas', () => {
    expect(correspondALaRecherche(willi, 'zzz')).toBe(false);
  });

  it('une recherche vide ne filtre rien', () => {
    // Sinon le champ, monté vide, viderait la liste au premier rendu.
    expect(correspondALaRecherche(willi, '')).toBe(true);
    expect(correspondALaRecherche(willi, '   ')).toBe(true);
  });
});

describe('segmentsDeRecherche — ce que la frappe surligne dans le nom', () => {
  const marque = (texte: string, q: string) =>
    segmentsDeRecherche(texte, q).map(m => (m.trouve ? `[${m.texte}]` : m.texte)).join('');

  it('marque la frappe dans le nom, casse d’origine gardée', () => {
    expect(marque('Willi Lagachette', 'lag')).toBe('Willi [Lag]achette');
  });

  it('retrouve SANS ACCENT, mais surligne le texte accentué', () => {
    // ⚠️ LE CAS QUI DÉCALE LES INDICES : « É » décomposé fait deux caractères.
    // Un repli de la chaîne entière marquerait « Élé » un cran trop loin.
    expect(marque('Éléonore Dupré', 'ele')).toBe('[Élé]onore Dupré');
    expect(marque('Éléonore Dupré', 'dupre')).toBe('Éléonore [Dupré]');
  });

  it('prénom et nom accolés, comme on les tape', () => {
    expect(marque('Willi Lagachette', 'willi lag')).toBe('[Willi Lag]achette');
  });

  it('rien à marquer sans frappe ou sans correspondance', () => {
    expect(marque('Willi Lagachette', '')).toBe('Willi Lagachette');
    expect(marque('Willi Lagachette', 'zzz')).toBe('Willi Lagachette');
  });
});

describe('routeApresChangementDAthlete — on reste sur la vue qui décrit un athlète', () => {
  it('garde Programme, Suivi, Calendrier, tableau de bord et suivi kiné', () => {
    for (const vue of ['/training', '/tracker', '/calendar', '/dashboard', '/kine']) {
      expect(routeApresChangementDAthlete(vue)).toBe(vue);
    }
  });

  it('un bilan appartient à UN athlète : retour au suivi kiné', () => {
    expect(routeApresChangementDAthlete('/kine/bilans/b-42')).toBe('/kine');
  });

  it('ce qui ne décrit personne ouvre le tableau de bord', () => {
    for (const vue of ['/guichet', '/library', '/competitions', '/documentation']) {
      expect(routeApresChangementDAthlete(vue)).toBe('/dashboard');
    }
  });

  it('ne se laisse pas prendre par un préfixe', () => {
    // « /trainingx » n'est pas le Programme.
    expect(routeApresChangementDAthlete('/trainingx')).toBe('/dashboard');
  });
});
