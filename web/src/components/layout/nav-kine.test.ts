import { describe, expect, it } from 'vitest';

import type { Me } from '@/api/types';
import { sectionAdmin, sectionKine } from './nav-kine';

/** ⚠️ CE QUE CES TESTS GARDENT, ET QU'AUCUN AUTRE HARNAIS NE PEUT VOIR.
 *
 *  Le dev-mock n'a qu'UN utilisateur, coach ET kiné à la fois : le cas « coach
 *  sans être kiné » — c'est-à-dire tous les coachs du club sauf un — n'y est
 *  jouable par aucune spec e2e. Or c'est précisément le cas qui casse si l'on
 *  réunit deux entrées sous un titre commun sans regarder leurs conditions.
 */

const compte = (r: Partial<Me>): Me => ({
  uid: 'u', email: 'u@x.fr', displayName: 'U',
  isCoach: false, isKine: false, isAdmin: false, athleteId: null, structures: [], ...r,
});

const vers = (entrees: ReturnType<typeof sectionKine>) => entrees.map(e => e.to);

describe('sectionKine', () => {
  it('donne au COACH les signalements, et pas les modèles', () => {
    // ⚠️ L'ASSERTION QUI PORTE LE REGROUPEMENT. Réunir les deux entrées sous le
    // titre « Kiné » ne doit pas les aligner sur la garde la plus stricte : un
    // `me?.isKine` posé sur toute la section retirerait aux coachs le tableau
    // « qui va mal en ce moment », qui est fait pour le staff entier.
    expect(vers(sectionKine(compte({ isCoach: true })))).toEqual(['/signalements']);
  });

  it('donne à la KINÉ les deux', () => {
    expect(vers(sectionKine(compte({ isKine: true }))))
      .toEqual(['/signalements', '/bilan-modeles']);
  });

  it('donne au coach-kiné les deux, sans doublon', () => {
    // Le cas réel du premier jour : quelqu'un porte les deux rôles. Une
    // composition écrite avec deux `if` indépendants dupliquerait l'entrée
    // commune — l'écran afficherait deux fois « Signalements ».
    expect(vers(sectionKine(compte({ isCoach: true, isKine: true }))))
      .toEqual(['/signalements', '/bilan-modeles']);
  });

  it('ne donne RIEN à un athlète, ni à un profil absent', () => {
    // ⚠️ TABLEAU VIDE ET NON `null` : c'est lui qui permet à l'appelant de
    // n'afficher AUCUN titre. Une section « Kiné » vide serait pire que pas de
    // section — elle promettrait un contenu inatteignable.
    expect(sectionKine(compte({ athleteId: 'a1' }))).toEqual([]);
    expect(sectionKine(undefined)).toEqual([]);
  });

  it('l’ADMIN seul n’y a pas accès — le titre ne vaut pas le rôle', () => {
    // `isAdmin` n'ouvre ni les signalements ni les modèles : côté serveur c'est
    // `require_membre` et `require_kine` qui tranchent, jamais le titre d'admin.
    // La même confusion avait déjà caché « Ajouter un athlète » aux coachs.
    expect(sectionKine(compte({ isAdmin: true }))).toEqual([]);
  });
});

describe('sectionAdmin', () => {
  it('rien pour qui n’est pas admin', () => {
    expect(vers(sectionAdmin(compte({ isCoach: true })))).toEqual([]);
  });
  it('l’admin qui coache là a déjà la Bibliothèque sous Coach', () => {
    expect(vers(sectionAdmin(compte({ isAdmin: true, isCoach: true })))).toEqual(['/admin']);
  });
  it('l’admin qui ne coache pas là reçoit la Bibliothèque ici', () => {
    expect(vers(sectionAdmin(compte({ isAdmin: true })))).toEqual(['/admin', '/library']);
  });
});
