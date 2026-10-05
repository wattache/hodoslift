import { describe, expect, it } from 'vitest';

import { doitTenterLeRattachement, etatDuGate, type EntreesDuGate } from '@/auth/etat-du-gate';
import type { Me } from '@/api/types';

/** Le gate n'accuse que sur une réponse REÇUE.
 *
 *  ⚠️ CE QUE CES SPECS FERMENT — l'incident du 21/08. Deux athlètes ont vu « ton
 *  coach ne t'a pas encore enregistré » alors que leur compte était parfaitement
 *  lié. Côté serveur : aucune erreur, aucune requête, rien à voir. Le second a
 *  donné la clé — « ça m'arrive quand je n'ai pas de connexion ».
 *
 *  Hors ligne, TanStack met la requête en PAUSE : pas d'erreur, pas de données.
 *  La condition du gate lisait cette absence comme un refus.
 */

const ME: Me = {
  uid: 'u1', email: 'a@x.fr', displayName: 'A',
  isCoach: false, isKine: false, isAdmin: false, athleteId: 'ath-1',
} as Me;

const entrees = (over: Partial<EntreesDuGate> = {}): EntreesDuGate => ({
  devMode: false, user: { uid: 'u1' }, authLoading: false,
  me: ME, meLoading: false, meError: null, linking: false, enLigne: true,
  ...over,
});

describe('etatDuGate', () => {
  it('HORS LIGNE, ne dit PAS que le coach n’a pas enregistré l’athlète', () => {
    // ⚠️ LE CŒUR DE L'INCIDENT. Les trois signaux d'une requête en pause :
    // pas de données, pas d'erreur, pas de chargement.
    const etat = etatDuGate(entrees({ me: undefined, enLigne: false }));
    expect(etat).toEqual({ quoi: 'sans-reponse', horsLigne: true });
  });

  it('EN LIGNE mais sans réponse, ne l’accuse pas non plus', () => {
    // Même absence d'information, autre cause — et le geste à proposer diffère :
    // réessayer, plutôt qu'attendre le réseau.
    expect(etatDuGate(entrees({ me: undefined }))).toEqual({ quoi: 'sans-reponse', horsLigne: false });
  });

  it('ACCUSE seulement sur une réponse REÇUE qui n’ouvre rien', () => {
    const rien = { ...ME, athleteId: null } as Me;
    expect(etatDuGate(entrees({ me: rien })).quoi).toBe('non-autorise');
  });

  /** ⚠️ MÊME ÉCRAN, DEUX RAISONS OPPOSÉES (FRE-76). Le refus ne suffit pas : il
   *  faut savoir ce qu'on a le droit d'en dire. « Ton coach ne t'a pas
   *  enregistré » est exact pour qui n'est pas athlète, et FAUX pour un athlète
   *  dont l'uid Firebase a changé — son coach a fait son travail, c'est
   *  l'identité qui a bougé, et lui est bloqué définitivement. */
  it.each([
    ['aucune fiche à cette adresse', 'aucune_fiche' as const],
    ['une fiche liée à un AUTRE compte', 'fiche_deja_liee' as const],
    ['le rattachement pas encore tenté', null],
  ])('le refus porte son motif — %s', (_cas, motif) => {
    const rien = { ...ME, athleteId: null } as Me;
    expect(etatDuGate(entrees({ me: rien, motifDuRattachement: motif })))
      .toEqual({ quoi: 'non-autorise', motif });
  });

  it.each([
    ['un athlète lié', { athleteId: 'ath-1' }],
    ['un coach', { athleteId: null, isCoach: true }],
    ['un kiné', { athleteId: null, isKine: true }],
    ['un admin', { athleteId: null, isAdmin: true }],
  ])('laisse entrer %s', (_libelle, over) => {
    expect(etatDuGate(entrees({ me: { ...ME, ...over } as Me })).quoi).toBe('ok');
  });

  it('une ERREUR reste une erreur, pas un compte inconnu', () => {
    // La règle existait déjà pour ce cas (CORS canary manquant, vécu) — ces specs
    // l'étendent à l'absence de réponse, qui est le même mensonge.
    expect(etatDuGate(entrees({ me: undefined, meError: new Error('500') })).quoi).toBe('erreur');
  });

  it('l’ordre compte : chargement AVANT toute conclusion', () => {
    // Sans ça, le gate accuserait pendant la première requête, le temps d'un
    // aller-retour — un clignotement qui a la même laideur que le bug.
    expect(etatDuGate(entrees({ me: undefined, meLoading: true })).quoi).toBe('chargement');
    expect(etatDuGate(entrees({ me: undefined, authLoading: true })).quoi).toBe('chargement');
  });

  it('pas d’utilisateur → page de connexion, et pas le gate', () => {
    expect(etatDuGate(entrees({ user: null, me: undefined })).quoi).toBe('login');
  });

  it('le mode maquette passe toujours', () => {
    expect(etatDuGate(entrees({ devMode: true, user: null, me: undefined })).quoi).toBe('ok');
  });
});

describe('doitTenterLeRattachement', () => {
  const base = {
    devMode: false, user: { uid: 'u1' }, apiConfiguree: true,
    linking: false, linkChecked: false, meLoading: false,
  };

  it('NON sans profil — on ne sait pas s’il y a quelque chose à rattacher', () => {
    // ⚠️ LE SECOND EFFET DE LA MÊME CAUSE : hors ligne, on partait tenter un POST
    // voué à échouer, en affichant « Bienvenue ! » à quelqu'un sans réseau.
    expect(doitTenterLeRattachement({ ...base, me: undefined })).toBe(false);
  });

  it('OUI quand le profil existe et n’a pas d’athlète', () => {
    expect(doitTenterLeRattachement({ ...base, me: { ...ME, athleteId: null } as Me })).toBe(true);
  });

  it('NON quand l’athlète est déjà lié', () => {
    expect(doitTenterLeRattachement({ ...base, me: ME })).toBe(false);
  });

  it('NON si on a déjà essayé', () => {
    const pasLie = { ...ME, athleteId: null } as Me;
    expect(doitTenterLeRattachement({ ...base, linkChecked: true, me: pasLie })).toBe(false);
  });
});
