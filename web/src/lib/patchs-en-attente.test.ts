// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** LA FILE D'ATTENTE DES ÉCRITURES — testée SEULE (FRE-45).
 *
 *  ⚠️ POURQUOI CE FICHIER EXISTE ALORS QUE `training-editor.test.ts` COUVRE DÉJÀ
 *  LE DEBOUNCE. Il le couvre à travers l'éditeur entier : un QueryClient, un
 *  `localStorage` fourni à la main, un arbre de programme complet. C'était la
 *  seule voie tant que cette mécanique vivait au fond d'un hook de mille lignes.
 *
 *  L'extraire n'avait de sens que si on encaissait ça — sinon on a déplacé du
 *  code sans rien gagner. Ici il n'y a ni arbre, ni sélection, ni écran : un
 *  `programId` et des patchs. Les cas coûteux à atteindre autrement deviennent
 *  ordinaires — l'abandon après trois réessais, le patch périmé qu'un réessai ne
 *  doit pas ressusciter, les quatre sources de `hasPendingWrites`.
 *
 *  ⚠️ ET LE MOCK EST DÉSACTIVÉ EXPRÈS. `isMock` est une constante de module,
 *  évaluée à l'import : sans `isFirebaseConfigured: true`, chaque écriture sort
 *  en silence et la suite entière passerait au vert sans rien éprouver.
 */

vi.mock('@/firebase', () => ({ isFirebaseConfigured: true }));

type Appel = (url: string, corps?: unknown) => Promise<unknown>;
const api = {
  get: vi.fn<Appel>(async () => ({})),
  post: vi.fn<Appel>(async () => ({})),
  patch: vi.fn<Appel>(async () => ({})),
  put: vi.fn<Appel>(async () => ({})),
  delete: vi.fn<Appel>(async () => ({})),
};
/** ⚠️ `ApiError` EST LA VRAIE CLASSE, pas un bouchon. Depuis FRE-118, c'est le
 *  TYPE de l'erreur qui décide du sort de la frappe : une `ApiError` est une
 *  REPONSE du serveur — il a reçu et refusé, on abandonne après trois réessais ;
 *  tout le reste n'a jamais quitté le téléphone, et on garde. Bouchonner la
 *  classe ferait passer les deux cas pour le même. */
const { ApiError } = await vi.importActual<typeof import('@/api/client')>('@/api/client');
vi.mock('@/api/client', async () => ({
  api, ApiError: (await vi.importActual<typeof import('@/api/client')>('@/api/client')).ApiError,
}));

/** Un REFUS du serveur — il a répondu. À ne pas confondre avec `new Error()`,
 *  qui décrit une requête jamais partie : les deux se traitent à l'opposé. */
const refus = () => new ApiError(500, 'boom');

const toastSaveError = vi.fn();
// ⚠️ `jamaisParvenueAuServeur` N'EST PAS BOUCHONNÉE, et c'est délibéré : c'est
// ELLE qui décide si une frappe est gardée ou abandonnée. La remplacer ici
// reviendrait à tester la décision contre elle-même.
const { jamaisParvenueAuServeur } = await vi.importActual<typeof import('@/lib/save-error')>('@/lib/save-error');
vi.mock('@/lib/save-error', () => ({ toastSaveError, jamaisParvenueAuServeur }));

/** Le disque, en mémoire. jsdom n'a pas d'IndexedDB — et le bouchonner ici vaut
 *  mieux qu'un polyfill : on peut alors AFFIRMER ce qui y est écrit, qui est
 *  précisément la promesse du hors-ligne. */
const disque = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => disque.get(k),
  set: async (k: string, v: unknown) => { disque.set(k, v); },
  del: async (k: string) => { disque.delete(k); },
}));

const { usePatchsEnAttente, estEnCreation, nouvelleIdentite } = await import('@/lib/patchs-en-attente');

const DEBOUNCE = 400;
const SONDE = 150;
/** Le calme après lequel la file marque périmées les lectures dérivées (FRE-144). */
const DELAI_DERIVEES = 2000;
/** Les trois délais de réessai, cumulés — au-delà, la file abandonne. */
const TOUS_LES_REESSAIS = 1000 + 3000 + 8000;

/** ⚠️ UN FOURNISSEUR TANSTACK EST DÉSORMAIS NÉCESSAIRE (FRE-144) : la file
 *  invalide les lectures DÉRIVÉES après un acquittement, donc elle lit le cache.
 *  Un client NEUF par montage — sans requête, donc l'invalidation ne déclenche
 *  aucun rechargement et ne change rien à ce que ces specs mesurent : elles
 *  comptent les appels à `api.patch`, pas les lectures.
 *
 *  Le fichier est en `.ts`, d'où `createElement` plutôt que du JSX. */
const monter = () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => usePatchsEnAttente('prog-1'), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: cache }, children),
  });
};

/** Le corps du PATCH parti sur une cible donnée. */
const corpsPatch = (n = 0) => api.patch.mock.calls[n]?.[1] as Record<string, unknown> | undefined;

beforeEach(() => {
  disque.clear();
  vi.useFakeTimers();
  for (const espion of Object.values(api)) espion.mockClear();
  toastSaveError.mockClear();
});

afterEach(() => {
  // ⚠️ DÉMONTER, ET PAS SEULEMENT REMETTRE LES HORLOGES. Depuis que la file
  // écoute `online` (FRE-118), un hook laissé monté par la spec précédente
  // réagit AUSSI à l'événement qu'on déclenche — et rejoue sa propre file. Vu :
  // deux appels attendus, quatre observés, aucun défaut dans le code.
  cleanup();
  vi.useRealTimers();
});

describe('le debounce et la fusion', () => {
  it('rien ne part avant l’échéance', async () => {
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE - 50); });
    expect(api.patch).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  /** Taper la charge puis les reps ne doit pas faire deux allers-retours : c'est
   *  la rafale ordinaire d'un coach qui remplit une ligne. */
  it('deux frappes sur la même cible font UN appel portant les deux', async () => {
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { reps: '5' }); });

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(corpsPatch()).toEqual({ weight: '80', reps: '5' });
  });

  it('deux cibles différentes ne fusionnent PAS', async () => {
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    act(() => { result.current.schedulePatch('exercises', 'ex-2', { weight: '90' }); });

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });
    expect(api.patch).toHaveBeenCalledTimes(2);
  });

  it('sans identité serveur, rien n’est programmé du tout', async () => {
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', undefined, { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe('l’identité choisie à la création (FRE-86, 25/09)', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const creation = (id: string) => ({
    genre: 'creation' as const, programId: 'prog-1', cible: 'exercises' as const, id, parent: 's1',
    corps: { id, name: '' },
  });
  /** Un `POST` qui ne répond que quand la spec le décide.
   *
   *  ⚠️ IL ATTEND D'AVOIR ÉTÉ APPELÉ : `ecrire` laisse d'abord passer une
   *  éventuelle création en vol sur le parent, et le `POST` ne part qu'au
   *  micro-tour suivant. Répondre avant, c'est répondre à personne. */
  const postEnVol = () => {
    let repondre: ((v: unknown) => void) | null = null;
    api.post.mockImplementationOnce(() => new Promise(resolve => { repondre = resolve; }));
    return async () => {
      for (let i = 0; i < 20 && !repondre; i++) await Promise.resolve();
      if (!repondre) throw new Error('le POST n’est jamais parti');
      repondre({ ok: true });
    };
  };

  it('une identité neuve est un uuid, unique, et se reconnaît EN CRÉATION tant que le POST vole', async () => {
    const a = nouvelleIdentite();
    expect(a).toMatch(UUID);
    expect(nouvelleIdentite()).not.toBe(a);
    expect(estEnCreation(a)).toBe(false);

    const repondre = postEnVol();
    const { result } = monter();
    let envoi: Promise<boolean> | undefined;
    act(() => { envoi = result.current.ecrire(creation(a)); });
    expect(estEnCreation(a)).toBe(true);
    await act(async () => { await repondre(); await envoi; });
    expect(estEnCreation(a)).toBe(false);
    expect(api.post).toHaveBeenCalledWith('/programs/prog-1/sessions/s1/exercises', { id: a, name: '' });
  });

  /** ⚠️ LE DÉFAUT D'ORIGINE : la frappe partait sur une identité que le serveur
   *  ne connaît pas encore — 404. Elle doit ATTENDRE, pas être jetée ni envoyée. */
  it('une frappe sur une ligne dont la création vole ATTEND au lieu de partir — et n’est pas perdue', async () => {
    const id = nouvelleIdentite();
    const repondre = postEnVol();
    const { result } = monter();
    let envoi: Promise<boolean> | undefined;
    act(() => { envoi = result.current.ecrire(creation(id)); });

    act(() => { result.current.schedulePatch('exercises', id, { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE * 5); });

    expect(api.patch).not.toHaveBeenCalled();
    // Mais elle est bien EN ATTENTE — sinon un resync l'écraserait.
    expect(result.current.hasPendingWrites()).toBe(true);

    // ⚠️ ET ELLE PART QUAND LA CRÉATION EST RÉGLÉE. Sans cette moitié, une
    // frappe JETÉE au bout du debounce passerait ici : `hasPendingWrites`
    // restait vrai par la seule création en vol — mesuré par mutation.
    await act(async () => { await repondre(); await envoi; });
    expect(corpsPatch()).toEqual({ weight: '80' });
  });

  /** ⚠️ ON REPOSTE, ON NE RE-PROGRAMME PAS : ces frappes attendent déjà depuis
   *  l'aller-retour du POST. Leur réappliquer 400 ms n'a rien à regrouper et
   *  allonge la fenêtre pendant laquelle un onglet fermé les emporte. */
  it('l’acquittement de la création envoie la frappe IMMÉDIATEMENT', async () => {
    const id = nouvelleIdentite();
    const repondre = postEnVol();
    const { result } = monter();
    let envoi: Promise<boolean> | undefined;
    act(() => { envoi = result.current.ecrire(creation(id)); });
    act(() => { result.current.schedulePatch('exercises', id, { weight: '80' }); });

    await act(async () => { await repondre(); await envoi; });

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch.mock.calls[0][0]).toBe(`/programs/prog-1/exercises/${id}`);
    expect(corpsPatch()).toEqual({ weight: '80' });
  });

  it('⚠️ sans réseau, la création se garde, et la frappe la suit sur le disque — dans cet ordre', async () => {
    const id = nouvelleIdentite();
    api.post.mockRejectedValueOnce(new Error('Failed to fetch'));
    api.patch.mockRejectedValueOnce(new Error('Failed to fetch'));
    const { result } = monter();
    let envoi: Promise<boolean> | undefined;
    act(() => { envoi = result.current.ecrire(creation(id)); });
    act(() => { result.current.schedulePatch('exercises', id, { weight: '80' }); });
    await act(async () => { await envoi; await vi.advanceTimersByTimeAsync(SONDE); });

    expect(disque.get('eitri-file-ecritures')).toEqual([
      expect.objectContaining({ genre: 'creation', id }),
      expect.objectContaining({ genre: 'patch', id, patch: { weight: '80' } }),
    ]);
    expect(result.current.etatEnregistrement).toBe('en-attente');
  });

  it('refusée, la création emporte la frappe qui l’attendait : l’objet n’existe pas', async () => {
    const id = nouvelleIdentite();
    api.post.mockRejectedValueOnce(refus());
    const { result } = monter();
    let envoi: Promise<boolean> | undefined;
    act(() => { envoi = result.current.ecrire(creation(id)); });
    act(() => { result.current.schedulePatch('exercises', id, { weight: '80' }); });
    let accepte: boolean | undefined;
    await act(async () => { accepte = await envoi; await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    expect(accepte).toBe(false);
    expect(api.patch).not.toHaveBeenCalled();
    expect(result.current.hasPendingWrites()).toBe(false);
  });

  it('⚠️ un geste sur l’objet ATTEND que sa création soit réglée : le supprimer, créer dessous', async () => {
    const id = nouvelleIdentite();
    const repondre = postEnVol();
    const { result } = monter();
    act(() => { void result.current.ecrire(creation(id)); });
    let suppression: Promise<boolean> | undefined;
    act(() => {
      suppression = result.current.ecrire({ genre: 'suppression', programId: 'prog-1', cible: 'exercises', id });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(SONDE); });
    expect(api.delete).not.toHaveBeenCalled();

    await act(async () => { await repondre(); await suppression; });
    expect(api.delete).toHaveBeenCalledWith(`/programs/prog-1/exercises/${id}`);
  });
});

/** Dupliquer une ligne se fait côté serveur, depuis la BASE (Passe 3, constat 05) :
 *  une frappe encore dans le debounce partirait sans être copiée. */
describe('envoyer maintenant, avant un geste qui lit la base', () => {
  it('la frappe en file part SANS attendre le debounce, et la main ne revient qu’à l’acquittement', async () => {
    let acquitter: (v: unknown) => void = () => {};
    api.patch.mockImplementationOnce(() => new Promise(r => { acquitter = r; }));
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });

    let rendue = false;
    let envoi: Promise<void> = Promise.resolve();
    act(() => { envoi = result.current.envoyerMaintenant('exercises', 'ex-1').then(() => { rendue = true; }); });
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(corpsPatch()).toEqual({ weight: '80' });

    await act(async () => { await vi.advanceTimersByTimeAsync(SONDE * 3); });
    expect(rendue).toBe(false);

    await act(async () => { acquitter({}); await vi.advanceTimersByTimeAsync(SONDE); await envoi; });
    expect(rendue).toBe(true);
    // Et le debounce d'origine ne la renvoie pas une seconde fois.
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('sans rien en file, elle rend la main tout de suite', async () => {
    const { result } = monter();
    await act(async () => { await result.current.envoyerMaintenant('exercises', 'ex-1'); });
    expect(api.patch).not.toHaveBeenCalled();
  });
});

/** FRE-163 : le serveur refuse une liste d'objectifs écrite sur une version
 *  périmée. Le premier à pouvoir se la faire refuser, c'est le client lui-même. */
describe('les objectifs de bloc et leur version', () => {
  it('deux saisies rapprochées : la seconde part avec la version rendue par la première', async () => {
    /** MUTATIONS QUI ROUGISSENT : lire la version à la programmation plutôt qu'au
     *  départ ; ne pas attendre l'envoi précédent du même bloc. */
    let version = 'v0';
    let acquitter: (v: unknown) => void = () => {};
    api.put.mockImplementationOnce(() => new Promise(r => { acquitter = r; }));
    const { result } = monter();
    const planifier = () => result.current.planifierObjectifs(
      'bloc-1', 'm/b', [], () => version, v => { version = v; });

    act(() => { planifier(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });
    expect(api.put).toHaveBeenCalledTimes(1);

    // La seconde saisie tombe PENDANT que la première est en vol.
    act(() => { planifier(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });
    expect(api.put).toHaveBeenCalledTimes(1);

    await act(async () => { acquitter({ ok: true, count: 0, objectives: [], version: 'v1' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(api.put).toHaveBeenCalledTimes(2);
    expect((api.put.mock.calls[1][1] as { version: string }).version).toBe('v1');
  });
});

describe('oublier les patchs d’objets détruits (FRE-86)', () => {
  it('un patch destiné à un objet supprimé ne part pas', async () => {
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    act(() => { result.current.oublierPatchs(['ex-1']); });

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    // Sans ça : un 404, puis un toast qui parle d'un « problème d'enregistrement »
    // alors qu'il n'y a plus rien à enregistrer. Le message envoie chercher au
    // mauvais endroit.
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('oublier une cible n’emporte pas les autres', async () => {
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    act(() => { result.current.schedulePatch('exercises', 'ex-2', { weight: '90' }); });
    act(() => { result.current.oublierPatchs(['ex-1']); });

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch.mock.calls[0][0]).toContain('/exercises/ex-2');
  });
});

/* ------------------------------------------------------------------------- */
/* LES RÉESSAIS — les cas que l'éditeur rendait pénibles à atteindre           */
/* ------------------------------------------------------------------------- */

describe('quand le SERVEUR refuse', () => {
  it('une écriture refusée est réessayée', async () => {
    api.patch.mockRejectedValueOnce(refus());
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });
    expect(api.patch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(toastSaveError).not.toHaveBeenCalled();   // on n'inquiète pas trop tôt
  });

  /** ⚠️ L'ABANDON DOIT LIBÉRER LA CIBLE. Sinon `hasPendingWrites()` reste vrai
   *  POUR TOUJOURS, et plus aucune resynchronisation ne repasse : l'écran se fige
   *  sur son état local jusqu'au rechargement de la page. */
  it('après trois réessais elle abandonne, prévient, et LIBÈRE la file', async () => {
    api.patch.mockRejectedValue(refus());
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE + TOUS_LES_REESSAIS); });

    expect(api.patch).toHaveBeenCalledTimes(4);       // l'appel + trois réessais
    expect(toastSaveError).toHaveBeenCalled();
    expect(result.current.hasPendingWrites()).toBe(false);
    api.patch.mockResolvedValue({});
  });

  /** ⚠️ UN VIEUX PATCH NE DOIT PAS RESSUSCITER. Le debounce est de 400 ms et le
   *  premier réessai à 1 s : une frappe plus récente part donc couramment entre
   *  les deux. Sans ce test, le réessai écraserait la valeur fraîche déjà passée
   *  — le coach verrait sa correction se défaire toute seule. */
  it('un réessai périmé par une frappe plus récente n’écrase rien', async () => {
    api.patch.mockRejectedValueOnce(refus());
    const { result } = monter();

    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    // La correction du coach, pendant que le premier appel est retombé en échec.
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '100' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    await act(async () => { await vi.advanceTimersByTimeAsync(TOUS_LES_REESSAIS); });

    // Le DERNIER appel porte la valeur fraîche, jamais l'ancienne.
    const dernier = api.patch.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(dernier).toEqual({ weight: '100' });
  });
});

/* ------------------------------------------------------------------------- */
/* LES QUATRE SOURCES — la question à laquelle ce module répond                */
/* ------------------------------------------------------------------------- */

describe('hasPendingWrites voit ses cinq sources', () => {
  it('au repos, il dit non', () => {
    expect(monter().result.current.hasPendingWrites()).toBe(false);
  });

  it('1. un patch en file', () => {
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    expect(result.current.hasPendingWrites()).toBe(true);
  });

  it('2. un appel parti mais pas acquitté', async () => {
    let acquitter: (v: unknown) => void = () => {};
    api.patch.mockImplementationOnce(() => new Promise(r => { acquitter = r; }));
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    // La file s'est vidée AVANT l'appel : sans cette seconde source, une
    // resynchronisation tombant pendant le vol trouverait le front « au repos »
    // et repeindrait l'écran avec l'état d'avant la frappe.
    expect(result.current.hasPendingWrites()).toBe(true);
    await act(async () => { acquitter({}); });
    expect(result.current.hasPendingWrites()).toBe(false);
  });

  it('3. des objectifs débouncés', async () => {
    const { result } = monter();
    act(() => { result.current.planifierObjectifs('bloc-1', 'm/b', [], () => 'v0', () => {}); });
    expect(result.current.hasPendingWrites()).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(result.current.hasPendingWrites()).toBe(false);
  });

  /** ⚠️ LA SOURCE QUI MANQUAIT (FRE-66). `updateBlockBase` fait un `await api.put`
   *  direct : il ne passe ni par la file ni par les appels en vol. Sans ce
   *  comptage, `hasPendingWrites()` rendait FAUX pendant toute une écriture de
   *  trame — le garde-fou du resync était décoratif pour exactement les écritures
   *  qu'il doit protéger. */
  it('4. une écriture DIRECTE en cours (trame de BASE, création, suppression)', async () => {
    const { result } = monter();
    let relacher: (v: unknown) => void = () => {};
    const encours = act(async () => {
      await result.current.suivreEcritureDirecte(() => new Promise(r => { relacher = r; }));
    });
    await Promise.resolve();

    expect(result.current.hasPendingWrites()).toBe(true);
    relacher({});
    await encours;
    expect(result.current.hasPendingWrites()).toBe(false);
  });

  it('elle est relâchée même si l’écriture ÉCHOUE', async () => {
    const { result } = monter();
    await act(async () => {
      await result.current.suivreEcritureDirecte(async () => { throw new Error('boum'); })
        .catch(() => {});
    });
    // `finally` et non `then` : une trame refusée ne doit pas figer le resync.
    expect(result.current.hasPendingWrites()).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* CE QUE L'ÉCRAN EN VOIT — la vignette (FRE-32)                              */
/* ------------------------------------------------------------------------- */

/** ⚠️ POURQUOI CE BLOC NE DOUBLONNE PAS CELUI D'AU-DESSUS. `hasPendingWrites` ne
 *  lit que des `ref` : elle est juste, et elle ne provoque AUCUN rendu. Une
 *  vignette branchée dessus resterait figée pour toujours. Ces specs éprouvent la
 *  seconde publication — celle qui, elle, redessine — et surtout qu'elle dit la
 *  même chose que la première.
 *
 *  Chacune des quatre sources a la sienne, délibérément : c'est le seul moyen
 *  qu'un départ non publié fasse rougir quelque chose. Le mécanisme de retombée
 *  est commun (une sonde qui relit `hasPendingWrites`), donc lui n'a pas besoin
 *  d'être éprouvé quatre fois. */
describe('l’état publié pour la vignette', () => {
  /** La sonde tourne toutes les 150 ms ; on lui laisse une période franche. */
  const SONDE = 200;

  it('au chargement il n’affirme RIEN — « repos » n’est pas « enregistré »', () => {
    // Annoncer « Enregistré » avant toute écriture affirmerait quelque chose
    // d'une écriture qui n'a jamais eu lieu.
    expect(monter().result.current.etatEnregistrement).toBe('repos');
  });

  it('1. une frappe en file le passe à « en-cours » AVANT l’échéance', () => {
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    // Sans attendre le debounce : c'est pendant ces 400 ms que la valeur est
    // affichée sans être partie — exactement la fenêtre que la vignette couvre.
    expect(result.current.etatEnregistrement).toBe('en-cours');
  });

  it('2. un appel en vol le maintient à « en-cours », et l’acquittement le fait retomber', async () => {
    let acquitter: (v: unknown) => void = () => {};
    api.patch.mockImplementationOnce(() => new Promise(r => { acquitter = r; }));
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE + SONDE); });

    // La file est vide, l'appel ne l'est pas : la vignette ne doit pas mentir.
    expect(result.current.etatEnregistrement).toBe('en-cours');

    await act(async () => { acquitter({}); await vi.advanceTimersByTimeAsync(SONDE); });
    expect(result.current.etatEnregistrement).toBe('enregistre');
  });

  it('3. des objectifs débouncés le passent à « en-cours »', () => {
    const { result } = monter();
    act(() => { result.current.planifierObjectifs('bloc-1', 'm/b', [], () => 'v0', () => {}); });
    expect(result.current.etatEnregistrement).toBe('en-cours');
  });

  /** ⚠️ LE DÉMARRAGE EST ENCADRÉ PAR `act`, contrairement à son homologue plus
   *  haut qui éprouve `hasPendingWrites`. Celui-là lit une `ref` : la valeur est
   *  juste sans qu'aucun rendu ait lieu. Ici on lit un ÉTAT — sans le rendu, on
   *  observerait le « repos » d'avant et la spec accuserait le produit d'un
   *  défaut qui est dans le test. */
  it('4. une écriture de BASE le passe à « en-cours »', async () => {
    const { result } = monter();
    let relacher: (v: unknown) => void = () => {};
    let encours: Promise<unknown> = Promise.resolve();
    await act(async () => {
      encours = result.current.suivreEcritureDirecte(() => new Promise(r => { relacher = r; }));
      await Promise.resolve();
    });

    expect(result.current.etatEnregistrement).toBe('en-cours');

    await act(async () => {
      relacher({});
      await encours;
      await vi.advanceTimersByTimeAsync(SONDE);
    });
    expect(result.current.etatEnregistrement).toBe('enregistre');
  });

  /** ⚠️ LE CAS QUI DÉCIDE SI LA VIGNETTE EST HONNÊTE. Les quatre sources se
   *  vident en une douzaine d'endroits — fin d'appel, abandon après trois
   *  réessais, patch oublié parce que sa ligne est supprimée, `finally` d'une
   *  écriture de BASE. Publier à chacun donnerait douze occasions d'en oublier
   *  un, et l'oubli laisserait « Enregistrement… » à l'écran POUR TOUJOURS.
   *
   *  D'où la sonde : elle relit la seule source de vérité. Ici, l'abandon après
   *  trois réessais ne publie rien du tout — et la vignette retombe quand même. */
  /** ⚠️ ET ELLE RETOMBE SUR « ÉCHEC », PAS SUR « ENREGISTRÉ ». La sonde ne
   *  compte que ce qui est en vol : un refus la laissait annoncer l'inverse de
   *  ce qui s'était passé, et le toast — qui passe — était le seul à le dire.
   *  Aubin l'a lu, a fermé, et a tout retapé (25/09). */
  it('elle retombe même sur un chemin qui ne publie RIEN — l’abandon après trois réessais, et dit l’ÉCHEC', async () => {
    api.patch.mockRejectedValue(refus());
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE + TOUS_LES_REESSAIS + SONDE); });

    expect(toastSaveError).toHaveBeenCalled();
    expect(result.current.hasPendingWrites()).toBe(false);
    expect(result.current.etatEnregistrement).toBe('echec');
    api.patch.mockReset();
    api.patch.mockImplementation(async () => ({}));

    // La frappe suivante repart de zéro : l'échec ne colle pas à la vignette.
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '82' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE + SONDE); });
    expect(result.current.etatEnregistrement).toBe('enregistre');
  });

  /** ⚠️ « Enregistré » PERSISTE, il ne s'efface pas après un délai. Un indicateur
   *  qui disparaît ne se distingue pas d'un indicateur jamais apparu — or c'est
   *  lui, et pas le sablier, qui dit qu'on peut fermer l'onglet. */
  it('« enregistré » tient jusqu’à la frappe suivante', async () => {
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE + SONDE); });
    expect(result.current.etatEnregistrement).toBe('enregistre');

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.etatEnregistrement).toBe('enregistre');

    act(() => { result.current.schedulePatch('exercises', 'ex-1', { reps: '5' }); });
    expect(result.current.etatEnregistrement).toBe('en-cours');
  });

  /** ⚠️ LA SONDE NE DOIT PAS TOURNER POUR RIEN. Elle s'arme au départ d'une
   *  écriture et s'arrête d'elle-même ; si elle survivait, chaque vue
   *  Entraînement laisserait un intervalle derrière elle. Éprouvé par la
   *  conséquence observable : après retombée, plus aucun minuteur en attente. */
  it('la sonde s’arrête d’elle-même une fois la file vide', async () => {
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE + SONDE); });

    expect(result.current.etatEnregistrement).toBe('enregistre');

    // ⚠️ IL RESTE UNE ÉCHÉANCE, ET ELLE EST BORNÉE (FRE-144) : l'acquittement
    // arme le marquage des lectures dérivées, deux secondes plus tard. Ce
    // n'est pas la sonde — elle, tournerait indéfiniment. On la laisse donc
    // retomber avant d'affirmer que plus RIEN ne tourne, sinon cette spec
    // cesserait de garantir ce qu'elle promet : pas d'intervalle survivant.
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(DELAI_DERIVEES); });
    expect(vi.getTimerCount()).toBe(0);
  });
});

/* ------------------------------------------------------------------------- */
/* HORS LIGNE — la frappe est GARDÉE, pas perdue (FRE-118)                    */
/* ------------------------------------------------------------------------- */

/** ⚠️ CE QUE CES SPECS PROTÈGENT : LA SÉANCE D'UN ATHLÈTE EN SOUS-SOL.
 *
 *  Les trois réessais couvrent douze secondes — un réseau qui vacille. Une salle
 *  sans signal, ce sont des heures. La file abandonnait donc, affichait un toast
 *  au milieu d'une série, et l'écran continuait de montrer la valeur tapée comme
 *  si elle était en base. Le pire des deux mondes : perdue ET crue enregistrée.
 *
 *  ⚠️ ET LA DISTINCTION EST FINE : « refusée » et « jamais partie » se traitent à
 *  l'opposé. Un refus qu'on garderait indéfiniment ferait enfler une file que
 *  rien ne viderait ; une écriture jamais partie qu'on abandonne, c'est la
 *  séance perdue. C'est `jamaisParvenueAuServeur` qui tranche, et elle est
 *  volontairement NON bouchonnée ici. */
describe('quand la requête ne PART PAS', () => {
  const jamaisPartie = () => new Error('Failed to fetch');

  it('elle n’est ni réessayée ni abandonnée : elle attend', async () => {
    api.patch.mockRejectedValue(jamaisPartie());
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE + TOUS_LES_REESSAIS); });

    // UN seul appel — pas trois réessais qui partiraient dans le vide.
    expect(api.patch).toHaveBeenCalledTimes(1);
    // Aucun toast : on n'interrompt pas une série pour dire ce que l'athlète
    // sait déjà (il n'a pas de réseau).
    expect(toastSaveError).not.toHaveBeenCalled();
    // ⚠️ ET LA FRAPPE EST TOUJOURS LÀ. C'est ce qui interdit à une
    // resynchronisation de repeindre l'écran par-dessus.
    expect(result.current.hasPendingWrites()).toBe(true);
    api.patch.mockResolvedValue({});
  });

  it('⚠️ elle survit à la fermeture de l’app — elle est sur le DISQUE', async () => {
    api.patch.mockRejectedValue(jamaisPartie());
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    expect(disque.get('eitri-file-ecritures')).toEqual([
      { genre: 'patch', cle: expect.any(String), programId: 'prog-1', cible: 'exercises', id: 'ex-1', patch: { weight: '80' } },
    ]);
    api.patch.mockResolvedValue({});
  });

  it('le retour du réseau la fait partir, et le disque se vide', async () => {
    api.patch.mockRejectedValue(jamaisPartie());
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });
    expect(api.patch).toHaveBeenCalledTimes(1);

    api.patch.mockResolvedValue({});
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(api.patch.mock.calls.at(-1)?.[1]).toEqual({ weight: '80' });
    expect(result.current.hasPendingWrites()).toBe(false);
    expect(disque.has('eitri-file-ecritures')).toBe(false);
  });

  /** ⚠️ UNE FRAPPE PLUS RÉCENTE GAGNE, MÊME SUR CELLE QUI ATTEND. Le coach
   *  corrige, le réseau revient : c'est la correction qui doit partir, pas la
   *  valeur d'avant. La fusion se fait DESSOUS, jamais dessus. */
  it('une correction faite hors ligne écrase la valeur en attente', async () => {
    api.patch.mockRejectedValue(jamaisPartie());
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '100' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    api.patch.mockResolvedValue({});
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.patch.mock.calls.at(-1)?.[1]).toEqual({ weight: '100' });
  });

  /** ⚠️ UNE FRAPPE SUR UNE CRÉATION QUI VOLE NE VA PAS SUR LE DISQUE, tant que
   *  le `POST` n'a pas rendu son verdict : rejouée avant lui, elle produirait un
   *  `PATCH` sur un objet que le serveur ne connaît pas — un 404 et un toast. */
  it('une frappe sur une ligne dont la création vole ne se persiste pas encore', async () => {
    const id = nouvelleIdentite();
    api.post.mockImplementationOnce(() => new Promise(() => {}));
    const { result } = monter();
    act(() => { void result.current.ecrire({
      genre: 'creation', programId: 'prog-1', cible: 'exercises', id, parent: 's1', corps: { id, name: '' },
    }); });
    act(() => { result.current.schedulePatch('exercises', id, { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE + TOUS_LES_REESSAIS); });

    expect(api.patch).not.toHaveBeenCalled();
    expect(disque.has('eitri-file-ecritures')).toBe(false);
    // Elle attend bien, en revanche — simplement en mémoire.
    expect(result.current.hasPendingWrites()).toBe(true);
  });

  it('la vignette dit « en attente », et surtout PAS « enregistré »', async () => {
    api.patch.mockRejectedValue(jamaisPartie());
    const { result } = monter();
    act(() => { result.current.schedulePatch('exercises', 'ex-1', { weight: '80' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE + SONDE * 3); });

    expect(result.current.etatEnregistrement).toBe('en-attente');
    api.patch.mockResolvedValue({});
  });
});

/* ------------------------------------------------------------------------- */
/* LES GESTES DU COACH PASSENT PAR LA MÊME FILE (25/09)                       */
/* ------------------------------------------------------------------------- */

/** ⚠️ CE QUE CES SPECS PROTÈGENT : LA TRAME D'AUBIN. Écrite sur un Wi-Fi sans
 *  internet, elle partait en direct : « pas de connexion », puis « Enregistré »
 *  — et au retour du réseau, le serveur repeignait la version d'avant. La file
 *  ne connaissait que les frappes de l'athlète. */
describe('un geste qui ne passe pas par les patchs', () => {
  const jamaisPartie = () => new Error('Failed to fetch');
  const trame = { genre: 'base' as const, programId: 'prog-1', id: 'b1', corps: { base: { principles: [] } as never } };

  it('part tout de suite quand le réseau est là', async () => {
    const { result } = monter();
    let accepte: boolean | undefined;
    await act(async () => { accepte = await result.current.ecrire(trame); });
    expect(accepte).toBe(true);
    expect(api.put).toHaveBeenCalledWith('/programs/prog-1/blocks/b1/base', trame.corps);
    expect(disque.has('eitri-file-ecritures')).toBe(false);
  });

  it('⚠️ sans réseau, il est GARDÉ sur le disque, et la vignette dit « en attente »', async () => {
    api.put.mockRejectedValue(jamaisPartie());
    const { result } = monter();
    let accepte: boolean | undefined;
    await act(async () => { accepte = await result.current.ecrire(trame); });
    // Gardé n'est pas refusé : l'écran n'a rien à rattraper.
    expect(accepte).toBe(true);
    expect(toastSaveError).not.toHaveBeenCalled();
    expect(disque.get('eitri-file-ecritures')).toEqual([{ ...trame, cle: expect.any(String) }]);

    await act(async () => { await vi.advanceTimersByTimeAsync(SONDE * 2); });
    expect(result.current.etatEnregistrement).toBe('en-attente');
    api.put.mockResolvedValue({});
  });

  it('le retour du réseau le fait partir depuis le disque, et la vignette retombe sur « enregistré »', async () => {
    api.put.mockRejectedValue(jamaisPartie());
    const { result } = monter();
    await act(async () => { await result.current.ecrire(trame); });
    expect(api.put).toHaveBeenCalledTimes(1);

    api.put.mockResolvedValue({});
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(SONDE * 2);
    });

    expect(api.put).toHaveBeenCalledTimes(2);
    expect(disque.has('eitri-file-ecritures')).toBe(false);
    expect(result.current.etatEnregistrement).toBe('enregistre');
  });

  it('⚠️ un REFUS rend faux, prévient, et la vignette dit l’échec', async () => {
    api.put.mockRejectedValue(refus());
    const { result } = monter();
    let accepte: boolean | undefined;
    await act(async () => { accepte = await result.current.ecrire(trame); });
    expect(accepte).toBe(false);
    expect(toastSaveError).toHaveBeenCalled();
    expect(disque.has('eitri-file-ecritures')).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(SONDE * 2); });
    expect(result.current.etatEnregistrement).toBe('echec');
    api.put.mockResolvedValue({});
  });
});
