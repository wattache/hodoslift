// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Me } from '@/api/types';

/** LE PREMIER TEST DE RENDU DU PROJET — FRE-93.
 *
 *  ⚠️ POURQUOI ICI PLUTÔT QU'AILLEURS. Ce composant a MENTI à de vrais athlètes
 *  pendant des semaines : « ton coach ne t'a pas encore enregistré », servi à des
 *  gens parfaitement inscrits, simplement hors ligne. Vécu par Kévin puis par un
 *  second athlète, dont la phrase a donné la clé — « ça m'arrive quand je n'ai
 *  pas de connexion ». Côté serveur il n'y avait RIEN à voir : pas une erreur,
 *  pas même une requête.
 *
 *  ⚠️ ET `etat-du-gate.test.ts` NE POUVAIT PAS L'ATTRAPER, malgré ses 18 specs.
 *  La décision a été extraite du JSX en juillet, et elle est bien gardée — mais
 *  elle ne dit que QUEL état s'applique. Que chaque état rende bien SA carte
 *  n'était vérifié nulle part : un `if` inversé entre deux branches d'affichage
 *  laisserait la fonction pure verte et remettrait l'accusation à l'écran.
 *  C'est exactement le trou que ce fichier ferme.
 *
 *  ⚠️ LES ASSERTIONS PORTENT SUR LE TEXTE FRANÇAIS RÉEL, pas sur des clés de
 *  traduction. `@/i18n` est importé pour de bon : une clé absente du dictionnaire
 *  s'afficherait telle quelle (`auth.pasDeConnexion`) et ferait rougir la spec —
 *  ce qu'un `t` bouchonné rendant la clé masquerait précisément.
 */

import i18next from 'i18next';
import '@/i18n';

// ⚠️ LA LANGUE SE FIGE, ELLE NE SE SUBIT PAS. `LanguageDetector` suit
// `navigator.language` : sous jsdom il choisit l'anglais, et les assertions
// tomberaient sur « Try again ». Pire, la spec passerait ou non selon la machine
// qui la joue. Le français est la langue de RÉFÉRENCE du projet — c'est celle
// qu'on écrit dans le code — donc c'est elle qu'on éprouve.
await i18next.changeLanguage('fr');

const useAuth = vi.fn();
vi.mock('./auth-context', () => ({ useAuth: () => useAuth() }));

const useMe = vi.fn();
vi.mock('@/api/hooks/use-me', () => ({ useMe: () => useMe() }));

// Le rattachement automatique n'est pas le sujet ici : il ne doit ni partir, ni
// faire échouer le rendu. `isApiConfigured: false` suffit à le neutraliser.
vi.mock('@/api/client', () => ({
  api: { post: vi.fn(async () => ({ linked: false, athleteId: null, motif: null })) },
  isApiConfigured: false,
}));

vi.mock('./login-page', () => ({ LoginPage: () => <div>PAGE DE CONNEXION</div> }));

let enLigne = true;
vi.mock('@tanstack/react-query', () => ({
  onlineManager: { isOnline: () => enLigne },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const { AuthGate } = await import('./auth-gate');

/** L'état par défaut : connecté, profil reçu, tout ouvert. Chaque spec ne
 *  dérange QUE ce qu'elle éprouve — sinon on ne saurait pas ce qui a décidé. */
function poser(over: Partial<{
  user: unknown; authLoading: boolean; devMode: boolean;
  me: Me | undefined; meLoading: boolean; meError: unknown;
}> = {}) {
  useAuth.mockReturnValue({
    user: { email: 'kevin@exemple.fr' }, loading: false, devMode: false,
    ...(('user' in over) ? { user: over.user } : {}),
    ...(('authLoading' in over) ? { loading: over.authLoading } : {}),
    ...(('devMode' in over) ? { devMode: over.devMode } : {}),
  });
  useMe.mockReturnValue({
    data: over.me, isLoading: over.meLoading ?? false,
    error: over.meError ?? null, refetch: vi.fn(),
  });
}

const rendre = () => render(<AuthGate><div>LE PROGRAMME</div></AuthGate>);

const ACCUSATION = /Ton coach ne t'a pas encore enregistré/;

beforeEach(() => { enLigne = true; vi.clearAllMocks(); });
afterEach(cleanup);

describe('ce que le gate affiche selon la réponse du serveur', () => {
  it('sans utilisateur, la page de connexion', () => {
    poser({ user: null });
    rendre();
    expect(screen.getByText('PAGE DE CONNEXION')).toBeTruthy();
  });

  it('avec un profil ouvert, le contenu de l’application', () => {
    poser({ me: { uid: 'u1', isCoach: true } as Me });
    rendre();
    expect(screen.getByText('LE PROGRAMME')).toBeTruthy();
  });

  it('pendant le chargement, aucune affirmation sur le compte', () => {
    poser({ me: undefined, meLoading: true });
    rendre();
    expect(screen.queryByText(ACCUSATION)).toBeNull();
    expect(screen.queryByText('LE PROGRAMME')).toBeNull();
  });

  it('sur une ERREUR serveur, on dit que le serveur n’a pas répondu', () => {
    poser({ me: undefined, meError: new Error('Failed to fetch') });
    rendre();
    expect(screen.getByText('Serveur injoignable')).toBeTruthy();
    // Le détail technique est montré : c'est lui qui a permis de diagnostiquer
    // le CORS canary manquant.
    expect(screen.getByText('Failed to fetch')).toBeTruthy();
    expect(screen.queryByText(ACCUSATION)).toBeNull();
  });

  /* ── FRE-121 : le profil du disque bat l'erreur de rafraîchissement ────── */

  it('⚠️ avec un profil EN CACHE, une erreur de rafraîchissement ne barre pas la route', () => {
    /** LE DÉFAUT DU 02/09, VÉCU PAR WILLIAM. Hors ligne, sa semaine sur le
     *  téléphone, l'app affichait « Serveur injoignable » —
     *  `auth/network-request-failed`. Le jeton Firebase expire au bout d'une
     *  heure et son rafraîchissement demande le réseau ; sans réseau il échoue.
     *
     *  Cet échec suffisait à masquer un profil parfaitement bon, parce que le
     *  gate regardait l'ERREUR avant la DONNÉE. C'était sans conséquence tant
     *  qu'un échec voulait dire « pas de profil » — les deux allaient ensemble.
     *  Depuis que le profil est persisté (FRE-118), il survit à l'échec.
     *
     *  ⚠️ C'est le cœur de la promesse du hors-ligne : la donnée est là, sur le
     *  disque, et c'est précisément le moment où on la bloquait. */
    poser({
      me: { uid: 'u1', athleteId: 'a1' } as Me,
      meError: new Error('Firebase: Error (auth/network-request-failed).'),
    });
    rendre();
    expect(screen.getByText('LE PROGRAMME')).toBeTruthy();
    expect(screen.queryByText('Serveur injoignable')).toBeNull();
  });

  it('sans profil, l’erreur reprend ses droits', () => {
    // Le défaut symétrique : avaler l'erreur quand il n'y a RIEN à montrer
    // laisserait la personne sur un écran vide, sans rien à faire.
    poser({ me: undefined, meError: new Error('Failed to fetch') });
    rendre();
    expect(screen.getByText('Serveur injoignable')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------- */
/* L'INCIDENT DU 21/08 — la raison d'être de ce fichier                       */
/* ------------------------------------------------------------------------- */

describe('sans réponse du serveur, le gate n’accuse personne', () => {
  /** ⚠️ LA COMBINAISON QUI PIÉGEAIT, et elle ne ressemble pas à une erreur :
   *  hors ligne, `useQuery` en `networkMode: 'online'` NE LANCE PAS la requête et
   *  ne produit AUCUNE erreur — il met en pause. On a donc `me` indéfini,
   *  `meError` nul et `meLoading` faux, ce qui tombait droit dans la branche du
   *  compte inconnu. Trois valeurs banales, un message faux. */
  const SANS_REPONSE = { me: undefined, meLoading: false, meError: null };

  /** ⚠️ L'ABSENCE DE L'ACCUSATION PASSE EN PREMIER, DÉLIBÉRÉMENT. Éprouvé en
   *  retirant la branche de rendu `sans-reponse` : l'écran retombe alors sur la
   *  carte du compte inconnu, soit l'incident à l'identique. Si l'assertion de
   *  présence venait d'abord, le rouge dirait « Pas de connexion introuvable » —
   *  vrai, mais à côté. Ici il dit que le gate accuse à nouveau. */
  it('hors ligne : on parle du réseau, jamais du coach', () => {
    enLigne = false;
    poser(SANS_REPONSE);
    rendre();
    expect(screen.queryByText(ACCUSATION)).toBeNull();
    expect(screen.getByText('Pas de connexion')).toBeTruthy();
    expect(screen.getByText(/tu es hors ligne/)).toBeTruthy();
  });

  it('en ligne mais sans réponse : on dit qu’on ne sait pas', () => {
    poser(SANS_REPONSE);
    rendre();
    expect(screen.queryByText(ACCUSATION)).toBeNull();
    expect(screen.getByText('Profil indisponible')).toBeTruthy();
    expect(screen.getByText(/n'a pas encore pu être chargé/)).toBeTruthy();
  });

  it('les deux cartes proposent de réessayer — sinon la personne est coincée', () => {
    poser(SANS_REPONSE);
    rendre();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------- */
/* FRE-76 — deux refus opposés derrière le même écran                         */
/* ------------------------------------------------------------------------- */

describe('réponse reçue qui n’ouvre rien : reste à dire POURQUOI', () => {
  /** Une réponse REÇUE et vide : ni coach, ni admin, ni athlète lié. C'est le
   *  seul cas où l'on peut affirmer quelque chose sur le compte. */
  const REFUS = { me: { uid: 'u1' } as Me, meLoading: false, meError: null };

  it('sans fiche : là, et là seulement, on peut le dire', () => {
    poser(REFUS);
    rendre();
    expect(screen.getByText('Accès non autorisé')).toBeTruthy();
    expect(screen.getByText(ACCUSATION)).toBeTruthy();
    // L'adresse est rappelée : c'est elle que le coach doit ajouter.
    expect(screen.getByText('kevin@exemple.fr')).toBeTruthy();
  });
});
