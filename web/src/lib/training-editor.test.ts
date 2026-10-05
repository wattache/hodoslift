// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MacrocycleEditing } from '@/api/types';

/** LE HARNAIS DE `training-editor.ts` — FRE-87, préalable à FRE-86.
 *
 *  ⚠️ POURQUOI CE FICHIER EXISTE. C'est le code le plus utilisé du produit — un
 *  coach y passe ses soirées — et il n'avait AUCUN test unitaire. Ce n'est pas
 *  un oubli d'inventaire : les défauts qu'il porte sont précisément ceux qu'un
 *  test d'écran ne peut pas voir. Playwright vérifie ce qu'on affiche ; ici, ce
 *  qui se perd est ce qu'on N'ENVOIE PAS, et l'écran, lui, montre la valeur.
 *
 *  ⚠️ CE QU'IL FAUT TENIR EN ÉCRIVANT DES TESTS ICI : ce ne sont pas les appels
 *  qu'on garde, c'est LA FRAPPE QUI SURVIT. Un test qui vérifie « `api.patch` a
 *  été appelé » passerait aussi avec un patch vide, ou portant l'ancienne
 *  valeur. On assertionne donc le CORPS, et le chemin.
 *
 *  ⚠️ ET LE MOCK EST DÉSACTIVÉ EXPRÈS. `isMock` est une constante de module,
 *  évaluée à l'import : sans `isFirebaseConfigured: true`, chaque écriture sort
 *  en silence et la suite entière passerait au vert sans rien éprouver.
 *
 *  Les deux derniers `describe` gardent les défauts de FRE-86 — écrits d'abord
 *  en `it.fails` (ils décrivaient le comportement voulu et échouaient), puis
 *  libérés par le correctif. C'est ce qui rend l'ordre vérifiable après coup :
 *  ils ont été vus rouges avant d'être verts.
 */

vi.mock('@/firebase', () => ({ isFirebaseConfigured: true }));

// ⚠️ LA SIGNATURE EST DONNÉE EN PARAMÈTRE DE TYPE, pas par des arguments nommés
// et inutilisés : sans elle, `vi.fn(async () => …)` déduit une fonction SANS
// paramètre, `mock.calls` devient un tuple vide, et lire l'URL ou le corps d'un
// appel ne compile plus — c'est pourtant tout ce qu'on veut inspecter.
type Appel = (url: string, corps?: unknown) => Promise<unknown>;
const api = {
  get: vi.fn<Appel>(async () => ({})),
  post: vi.fn<Appel>(async () => ({ id: 'srv-neuf' })),
  patch: vi.fn<Appel>(async () => ({})),
  put: vi.fn<Appel>(async () => ({})),
  delete: vi.fn<Appel>(async () => ({})),
};
/** ⚠️ `ApiError` EST LA VRAIE CLASSE : c'est son TYPE qui distingue un refus
 *  du serveur d'une requête jamais partie, et les deux se traitent à l'opposé
 *  — le refus resynchronise, l'absence de réseau garde le geste. */
const { ApiError } = await vi.importActual<typeof import('@/api/client')>('@/api/client');
vi.mock('@/api/client', async () => ({
  api, ApiError: (await vi.importActual<typeof import('@/api/client')>('@/api/client')).ApiError,
}));

const toastSaveError = vi.fn();
const { jamaisParvenueAuServeur } = await vi.importActual<typeof import('@/lib/save-error')>('@/lib/save-error');
vi.mock('@/lib/save-error', () => ({ toastSaveError, jamaisParvenueAuServeur }));

/** jsdom n'a pas d'IndexedDB, où la file d'écritures se persiste (FRE-118). */
const disque = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => disque.get(k),
  set: async (k: string, v: unknown) => { disque.set(k, v); },
  del: async (k: string) => { disque.delete(k); },
}));

let macrosServeur: ReturnType<typeof arbre>;

/* ⚠️ TROIS LECTURES BOUCHONNÉES, UNE SEULE FIXTURE (FRE-119). L'éditeur ne lit
 * plus l'arbre entier : il assemble la CHARPENTE et le CONTENU du bloc courant.
 * Les deux bouchons sont donc DÉRIVÉS de `macrosServeur`, comme les hooks le
 * font en dev-mock — écrire une seconde fixture ferait passer ces specs sur un
 * arbre que le serveur ne rendrait jamais, et c'est exactement ce qu'un test de
 * découpage ne doit pas faire.
 *
 * `useTraining` reste bouchonné parce que l'arbre entier survit pour l'éditeur
 * de BASE, seul lecteur transversal. */
vi.mock('@/api/hooks/use-training', () => ({
  useTraining: () => ({ data: macrosServeur, isLoading: false }),
}));

/* ⚠️ LES DEUX DÉRIVATIONS SONT MÉMOÏSÉES PAR RÉFÉRENCE, et ce n'est pas une
 * optimisation. Une vraie `useQuery` rend la MÊME donnée tant que rien n'a
 * changé ; un bouchon qui refabrique son tableau à chaque rendu ment sur ce
 * point précis, et le resync de l'éditeur — qui se déclenche sur l'identité de
 * la réponse — repart en boucle infinie. Vu : la suite ne rendait plus la main. */
function memo<T>(calcul: (source: ReturnType<typeof arbre>) => T) {
  let vu: ReturnType<typeof arbre> | undefined;
  let valeur: T;
  return () => {
    if (vu !== macrosServeur) { vu = macrosServeur; valeur = calcul(macrosServeur); }
    return valeur;
  };
}

const charpente = memo(source => source.map(m => ({
  ...m,
  blocks: m.blocks.map(b => ({
    // La charpente ne porte PAS la trame — seulement le fait qu'il y en ait une.
    ...b,
    base: undefined,
    hasBase: Boolean(b.base?.principles?.length || b.base?.daySplit?.length),
    weeks: b.weeks.map(({ sessions, ...w }) => ({
      ...w, sessionCount: (sessions ?? []).length,
    })),
  })),
})));

const contenus = memo(source => new Map(source.flatMap(m => m.blocks).map(b => [b.id, {
  base: b.base,
  weeks: b.weeks.map(w => ({ id: w.id, sessions: w.sessions ?? [] })),
}])));

/** Le programme dont la charpente est ARRIVÉE. Les autres sont « en cours de
 *  chargement » — l'état exact d'un changement d'athlète, où `useProgramStructure`
 *  change de clé et ne rend rien tant que la réponse n'est pas là. C'est dans
 *  cette fenêtre que le contenu partait sur le bloc de l'athlète PRÉCÉDENT. */
let programmeCharpente = 'prog-1';

/** Les couples (programme, bloc) pour lesquels un contenu a été DEMANDÉ.
 *  On regarde ce que l'éditeur réclame, pas ce que le réseau en fait : le 404
 *  est une conséquence, la demande incohérente est la cause. */
const contenusDemandes: { programId: string | null; blockId: string | null }[] = [];

vi.mock('@/api/hooks/use-structure', () => ({
  useProgramStructure: (programId: string | null | undefined) => (
    programId === programmeCharpente
      ? { data: charpente(), isLoading: false }
      : { data: undefined, isLoading: true }),
}));
vi.mock('@/api/hooks/use-block-content', () => ({
  // ⚠️ LA MÊME CLÉ QUE LA VRAIE, sinon la spec de suppression regarderait une
  // entrée de cache que le produit n'écrit jamais — verte pour rien.
  cleContenuDeBloc: (programId: string | null, blockId: string | null) =>
    ['block-content', programId, blockId] as const,
  contenuDeBloc: async (_programId: string | null, blockId: string | null) =>
    contenus().get(blockId ?? ''),
  useBlockContent: (programId: string | null, blockId: string | null) => {
    if (blockId) contenusDemandes.push({ programId, blockId });
    return { data: contenus().get(blockId ?? ''), isLoading: false };
  },
}));

const { useTrainingEditor } = await import('@/lib/training-editor');
const { createEmptyExercise, createEmptyBlockBase } = await import('@/lib/exercise');

const DEBOUNCE = 400;

/** Un arbre MINIMAL mais complet : une ligne, dans une séance, dans une semaine.
 *
 *  Sans dates : avec un seul bloc et une seule semaine, la sélection retombe sur
 *  0/0/0 par construction. Dater la semaine n'ajouterait qu'un cas de bord — la
 *  résolution par date a ses propres tests. */
function arbre(exercices = [{ ...createEmptyExercise(), id: 'ex-1', name: 'PULL UP' }]): MacrocycleEditing[] {
  return [{
    id: 'macro-1', macroNumber: 1, name: 'M1', trainingFrequency: null, coachNotes: null,
    blocks: [{
      id: 'bloc-1', blockNumber: 1, name: 'B1', startDate: '', endDate: '',
      objectives: [], objectivesVersion: 'v0', base: createEmptyBlockBase(),
      weeks: [{
        id: 'sem-1', weekNumber: 1, name: '', hidden: false, startDate: '', endDate: '',
        athlete: { firstName: 'Léa', lastName: 'M', height: 168, weight: 62 },
        sessions: [{
          id: 'se-1', name: 'Lundi', sessionDate: '', formOfTheDay: null, lignesSansRessenti: 0,
          exercises: exercices,
        }],
      }],
    }],
  }];
}

function monter() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  // Le programme est une PROP, pour que `rerender` puisse en changer — c'est
  // ce que fait l'écran quand le coach passe d'un athlète à l'autre.
  const rendu = renderHook(({ programId }: { programId: string }) =>
    useTrainingEditor(programId, {}), { wrapper, initialProps: { programId: 'prog-1' } });
  return { ...rendu, qc };
}

/** Le corps du PATCH envoyé sur une cible donnée — `undefined` si rien n'est parti. */
function corpsPatch(chemin: RegExp): Record<string, unknown> | undefined {
  const appel = api.patch.mock.calls.find(([url]) => chemin.test(url));
  return appel?.[1] as Record<string, unknown> | undefined;
}

/** Le strict nécessaire de l'API `Storage`, en mémoire. */
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
  vi.useFakeTimers();
  macrosServeur = arbre();
  programmeCharpente = 'prog-1';
  contenusDemandes.length = 0;
  // ⚠️ UN `localStorage` FOURNI À LA MAIN, et ce n'est pas une coquetterie :
  // Node expose un global expérimental du même nom qui MASQUE celui de jsdom et
  // vaut `undefined`. La sélection courante y est persistée par programme
  // (`useProgramSelection`) ; sa lecture est sous `try`, mais l'écriture ne
  // l'est pas — un test qui déclencherait un changement de sélection tomberait
  // sur un défaut du harnais, pas du produit.
  vi.stubGlobal('localStorage', memoire());
  for (const espion of Object.values(api)) espion.mockClear();
  toastSaveError.mockClear();
  // Le disque ne survit pas d'une spec à l'autre : ce qu'une suppression y
  // laisse ferait mentir la suivante.
  disque.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('la frappe arrive jusqu’au serveur', () => {
  it('une valeur saisie part en PATCH, avec la valeur', async () => {
    const { result } = monter();

    act(() => { result.current.updateExercise(0, 0, 'weight', '80'); });
    // Rien avant l'échéance : le debounce est ce qui fait qu'une rafale de
    // frappes ne produit pas dix appels.
    expect(api.patch).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    expect(corpsPatch(/exercises\/ex-1$/)).toEqual({ weight: '80' });
  });

  it('deux frappes sur la même ligne FUSIONNENT en un seul appel', async () => {
    const { result } = monter();

    act(() => { result.current.updateExercise(0, 0, 'weight', '80'); });
    act(() => { result.current.updateExercise(0, 0, 'reps', '5'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    // ⚠️ L'ASSERTION QUI PORTE EST LE CORPS, PAS LE NOMBRE D'APPELS. Un patch
    // qui n'emporterait que la dernière colonne ferait aussi « un seul appel »,
    // et perdrait la charge en route.
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(corpsPatch(/exercises\/ex-1$/)).toEqual({ weight: '80', reps: '5' });
  });

  it('la dernière frappe survit au démontage de l’écran', async () => {
    const { result, unmount } = monter();

    act(() => { result.current.updateExercise(0, 0, 'weight', '92.5'); });
    // On démonte AVANT l'échéance : c'est le cas réel de qui change d'athlète
    // ou d'onglet à la seconde où il finit de taper.
    await act(async () => { unmount(); });

    expect(corpsPatch(/exercises\/ex-1$/)).toEqual({ weight: '92.5' });
  });
});

describe('le garde-fou du resync', () => {
  it('une écriture en attente empêche le rafraîchissement d’écraser la frappe', () => {
    const { result } = monter();

    expect(result.current.hasPendingWrites()).toBe(false);
    act(() => { result.current.updateExercise(0, 0, 'weight', '80'); });

    // ⚠️ C'EST CE BOOLÉEN QUI PROTÈGE LA FRAPPE. Un refetch qui tomberait
    // pendant le debounce repeindrait l'écran avec l'état d'AVANT — la valeur
    // tapée disparaîtrait sous les yeux du coach, sans erreur nulle part.
    expect(result.current.hasPendingWrites()).toBe(true);
  });

  it('⚠️ une CRÉATION en vol le protège aussi (FRE-120)', async () => {
    /** LE TROU QUE PERSONNE NE REGARDAIT. Un `POST` de création est une écriture
     *  non acquittée comme une autre — mais il ne passe ni par la file ni par
     *  `enVol`, qui ne connaissent que les patchs. `hasPendingWrites()` rendait
     *  donc FAUX pendant tout le vol, et n'importe quel resync tombant là (un
     *  retour de focus suffit) remplaçait l'arbre local par celui du serveur,
     *  qui ne connaît pas encore la ligne. Elle disparaissait sous les doigts.
     *
     *  Trouvé de biais : le correctif d'affichage hors ligne ajoutait une
     *  occasion de resync de plus, et la spec de FRE-86 est tombée pile dessus.
     *  Le défaut, lui, était déjà atteignable — il fallait juste le regarder. */
    let repondrePost: (v: { id: string }) => void = () => {};
    api.post.mockImplementationOnce(
      () => new Promise(resolve => { repondrePost = resolve as (v: { id: string }) => void; }));
    const { result } = monter();

    await act(async () => { void result.current.addExercise(0); });
    expect(result.current.hasPendingWrites()).toBe(true);

    // …et il se relâche quand le serveur a répondu.
    await act(async () => { repondrePost({ id: 'ex-neuf' }); });
    expect(result.current.hasPendingWrites()).toBe(false);
  });
});

describe('FRE-86 — les pertes silencieuses', () => {

  it('une frappe pendant la création d’une ligne n’est PAS perdue', async () => {
    /** LE CAS RÉEL, ET IL FALLAIT LE JOUER TEL QUEL. Une première version de ce
     *  test semait une ligne SANS id venue du serveur — ce qui n'est pas la même
     *  chose : ce cas-là est celui de `materialiserLignesVides`, un autre chemin.
     *  Ici on ajoute une ligne pour de bon, on tape PENDANT que le `POST` est en
     *  vol, et on regarde si la frappe survit à l'arrivée de l'identité.
     *
     *  ⚠️ C'est LE moment où l'on tape : on ajoute une ligne POUR la remplir. */
    let repondrePost: (v: { id: string }) => void = () => {};
    api.post.mockImplementationOnce(
      () => new Promise(resolve => { repondrePost = resolve as (v: { id: string }) => void; }),
    );
    const { result } = monter();

    await act(async () => { void result.current.addExercise(0); });
    // Le POST est en vol : la ligne neuve n'a pas encore d'identité serveur.
    act(() => { result.current.updateExercise(0, 1, 'weight', '60'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    // Rien ne part encore — et c'est VOULU : un PATCH sur une identité que le
    // serveur ne connaît pas rendrait 404. Ce qui compte est que la frappe soit
    // GARDÉE, pas jetée.
    expect(api.patch).not.toHaveBeenCalled();
    expect(result.current.hasPendingWrites()).toBe(true);

    await act(async () => { repondrePost({ id: 'ex-neuf' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    // Sur l'identité CHOISIE ICI, pas celle que le serveur rend : c'est la même.
    const neuve = result.current.macros[0].blocks[0].weeks[0].sessions![0].exercises[1].id!;
    expect(corpsPatch(new RegExp(`exercises/${neuve}$`))).toEqual({ weight: '60' });
  });

  it('régénérer la semaine ANNULE les patchs de ses anciennes lignes', async () => {
    /** ⚠️ LE MÊME DÉFAUT, SUR UN CHEMIN QU'ON N'AVAIT PAS REGARDÉ. Générer
     *  remplace les lignes de la semaine : celles d'avant n'existent plus, et un
     *  patch en attente sur l'une d'elles part dans le vide — 404, et un toast
     *  qui parle d'un « problème d'enregistrement » là où il n'y a plus rien à
     *  enregistrer.
     *
     *  Le geste réel qui le déclenche : corriger une charge, puis cliquer
     *  « générer » dans les 400 ms.
     *
     *  ⚠️ LA SPEC A SUIVI LE DÉPLACEMENT (26/08) : la génération était quatre
     *  ordres depuis le front, elle est un `POST` unique depuis que brokkr la
     *  calcule. Ce qu'elle garde n'a pas changé — aucun PATCH ne doit suivre sur
     *  une ligne effacée. */
    // La BASE de la maquette est vide, et ça suffit : ce qu'on éprouve est le
    // REMPLACEMENT de la semaine, pas ce que la génération y met —
    // `generate-from-base` a ses propres tests.
    const { result } = monter();

    act(() => { result.current.updateExercise(0, 0, 'weight', '80'); });
    await act(async () => { await result.current.generateWeekOneFromBase(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE * 2); });

    // La génération a bien eu lieu, mais aucun PATCH ne suit sur une ligne que
    // le serveur vient d'effacer.
    expect(api.post).toHaveBeenCalledWith(
      // Sans second argument : la route ne déclare aucun corps (FRE-144).
      expect.stringContaining('/blocks/bloc-1/generate-week'));
    expect(api.patch.mock.calls.filter(([url]) => url.includes('/exercises/'))).toEqual([]);
  });

  it('fermer l’onglet tente l’envoi ET retient le geste', async () => {
    /** ⚠️ LE FLUSH AU DÉMONTAGE NE COUVRE PAS CE CAS : fermer un onglet ne
     *  démonte rien, et les 400 ms du debounce partent avec la page.
     *
     *  Les deux moitiés comptent. L'envoi aboutit souvent mais ne se garantit
     *  pas — et rien ne nous en informerait ; c'est `preventDefault` qui fait
     *  découvrir l'écriture en vol AVANT de fermer, plutôt que trois jours plus
     *  tard devant une séance restée à l'ancienne valeur. */
    const { result } = monter();
    act(() => { result.current.updateExercise(0, 0, 'weight', '80'); });

    const fermeture = new Event('beforeunload', { cancelable: true });
    await act(async () => { window.dispatchEvent(fermeture); });

    expect(corpsPatch(/exercises\/ex-1$/)).toEqual({ weight: '80' });
    expect(fermeture.defaultPrevented).toBe(true);
  });

  it('sans rien en attente, fermer l’onglet ne demande RIEN', async () => {
    // Un avertissement systématique s'apprend à cliquer sans lire, et le jour où
    // il porte vraiment quelque chose, personne ne le voit.
    const { result } = monter();
    expect(result.current.hasPendingWrites()).toBe(false);

    const fermeture = new Event('beforeunload', { cancelable: true });
    await act(async () => { window.dispatchEvent(fermeture); });

    expect(fermeture.defaultPrevented).toBe(false);
  });

  it('supprimer une ligne ANNULE le patch qui lui était destiné', async () => {
    const { result } = monter();

    act(() => { result.current.updateExercise(0, 0, 'weight', '80'); });
    act(() => { result.current.removeExercise(0, 0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });

    // Le patch part quand même sur une ligne détruite : 404, puis un toast qui
    // parle d'un « problème d'enregistrement » alors qu'il n'y a plus rien à
    // enregistrer. Le message envoie chercher au mauvais endroit.
    expect(api.patch).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- */
/* FRE-45 — la même règle des deux côtés du geste                             */
/* ------------------------------------------------------------------------- */

describe('un geste structurel qui ÉCHOUE resynchronise', () => {
  /** ⚠️ LA RÈGLE, ET ELLE EST DÉJÀ ÉCRITE DANS `addMacro` : « garder un local
   *  divergent du serveur est pire que perdre le geste ». Un POST de création
   *  peut échouer APRÈS que le serveur a créé l'objet ; un DELETE peut échouer
   *  après qu'il l'a supprimé — la réponse se perd, pas l'effet.
   *
   *  Sans resynchronisation, l'écran garde alors un objet fantôme jusqu'au
   *  prochain focus : le coach le voit, clique dedans, et chaque frappe part sur
   *  un identifiant mort.
   *
   *  ⚠️ CETTE RÈGLE N'ÉTAIT APPLIQUÉE QU'AUX CRÉATIONS. Les trois suppressions
   *  faisaient `catch { saveFailed(e); return; }` — le toast, pas le rattrapage.
   *  Une moitié de règle, exactement la forme de défaut qui se répète ici. */
  // Un REFUS — le serveur a répondu. Une requête jamais partie, elle, se garde
  // (voir plus bas) : ce n'est pas le même cas, et ce n'est plus le même sort.
  const echoue = () => Promise.reject(new ApiError(500, 'boom'));

  it('une SUPPRESSION refusée prévient ET rafraîchit', async () => {
    // ⚠️ ON OBSERVE L'INVALIDATION, PAS UN `api.get`. `useTraining` est bouchonné
    // dans ce harnais : invalider ne peut déclencher aucune requête, et une
    // assertion sur `api.get` serait rouge quoi qu'on écrive dans le produit.
    const rafraichir = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    api.delete.mockImplementationOnce(echoue);
    const { result } = monter();
    rafraichir.mockClear();

    await act(async () => { await result.current.removeWeek(0); });

    expect(toastSaveError).toHaveBeenCalled();
    // ⚠️ L'ASSERTION QUI PORTE LA SPEC. Le toast seul laissait l'écran mentir.
    expect(rafraichir).toHaveBeenCalledWith({ queryKey: ['training', 'prog-1'] });
    rafraichir.mockRestore();
  });

  it('une suppression refusée ne retire RIEN de l’écran', async () => {
    api.delete.mockImplementationOnce(echoue);
    const { result } = monter();

    await act(async () => { await result.current.removeWeek(0); });

    // Le serveur a refusé : la semaine est toujours là-bas, elle doit rester ici.
    expect(result.current.macros[0].blocks[0].weeks).toHaveLength(1);
  });

  /** ⚠️ SANS RÉSEAU, CE N'EST PAS UN REFUS : le geste est GARDÉ (25/09). Le
   *  coach supprime une semaine dans le train ; elle part de l'écran, et la
   *  suppression attend le réseau sur le disque, à sa place dans la file. */
  it('une suppression SANS réseau retire la semaine de l’écran, et attend sur le disque', async () => {
    api.delete.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')));
    const { result } = monter();

    await act(async () => { await result.current.removeWeek(0); });

    expect(toastSaveError).not.toHaveBeenCalled();
    expect(result.current.macros[0].blocks[0].weeks).toHaveLength(0);
    expect(disque.get('eitri-file-ecritures')).toEqual([
      expect.objectContaining({ genre: 'suppression', cible: 'weeks', programId: 'prog-1' }),
    ]);
  });

  it('⚠️ une séance et une ligne créées SANS réseau attendent sur le disque, dans l’ordre, avec la frappe', async () => {
    api.post.mockImplementation(() => Promise.reject(new Error('Failed to fetch')));
    api.patch.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')));
    const { result } = monter();

    await act(async () => { await result.current.addSession('Jeudi'); });
    const seance = result.current.macros[0].blocks[0].weeks[0].sessions!.at(-1)!;
    await act(async () => { await result.current.addExercise(1); });
    act(() => { result.current.updateExercise(1, 0, 'name', 'SQUAT'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE); });
    const ligne = result.current.macros[0].blocks[0].weeks[0].sessions![1].exercises[0];

    expect(toastSaveError).not.toHaveBeenCalled();
    expect(disque.get('eitri-file-ecritures')).toEqual([
      expect.objectContaining({ genre: 'creation', cible: 'sessions', id: seance.id, corps: { id: seance.id, name: 'Jeudi' } }),
      expect.objectContaining({ genre: 'creation', cible: 'exercises', id: ligne.id, parent: seance.id }),
      expect.objectContaining({ genre: 'patch', cible: 'exercises', id: ligne.id, patch: { name: 'SQUAT' } }),
    ]);
    api.post.mockImplementation(async () => ({ id: 'srv-neuf' }));
  });

  it('un renommage SANS réseau attend sur le disque, comme une frappe', async () => {
    api.patch.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')));
    const { result } = monter();

    act(() => { result.current.renameBlock(0, 'Force'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    expect(result.current.macros[0].blocks[0].name).toBe('Force');
    expect(disque.get('eitri-file-ecritures')).toEqual([
      expect.objectContaining({ genre: 'patch', cible: 'blocks', patch: { name: 'Force' } }),
    ]);
  });
});

/** LE CONTENU NE SE DEMANDE QUE POUR UN BLOC QUI EXISTE, ET DANS SON PROGRAMME.
 *
 *  ⚠️ VU EN PRODUCTION LE 21/09, en console : deux `GET /blocks/…/content` en
 *  404. Le serveur faisait son travail — un bloc d'un autre athlète EST
 *  inatteignable, et un bloc supprimé n'existe plus. C'est la DEMANDE qui était
 *  fautive, et elle l'était de deux façons distinctes, qu'on garde séparément.
 *
 *  On regarde ce que l'éditeur réclame, pas ce que le réseau en fait : le 404
 *  est la conséquence, le couple incohérent est la cause. */
describe('le contenu demandé désigne toujours un bloc vivant', () => {
  it('changer d’athlète ne demande pas le bloc du PRÉCÉDENT', async () => {
    /** ⚠️ LA FENÊTRE EST LE SUJET. `macros` est un état LOCAL, nourri par un
     *  effet qui ne fait rien tant que la nouvelle charpente n'est pas arrivée
     *  (`if (!structure) return`). Le programme, lui, a déjà changé. Pendant ces
     *  quelques rendus, la sélection désigne donc un bloc de l'athlète d'avant,
     *  et le contenu partait avec le NOUVEAU programme et l'ANCIEN bloc.
     *
     *  MUTATION QUI ROUGIT : rendre `selection.block?.id` au lieu du bloc validé
     *  contre la charpente — `prog-2 / bloc-1` réapparaît dans les demandes. */
    const { rerender } = monter();
    expect(contenusDemandes).toContainEqual({ programId: 'prog-1', blockId: 'bloc-1' });

    // Le coach change d'athlète : la charpente de `prog-2` n'est pas là encore.
    contenusDemandes.length = 0;
    await act(async () => { rerender({ programId: 'prog-2' }); });

    expect(contenusDemandes).toEqual([]);
  });

  it('supprimer un bloc retire son contenu du cache, au lieu de le rappeler', async () => {
    /** ⚠️ CE N'EST PAS LA SÉLECTION QUI FAUTE ICI, C'EST L'INVALIDATION.
     *  `invalidateQueries` REJOUE les requêtes actives — dont celle du bloc
     *  qu'on vient de supprimer, encore montée le temps d'un rendu. La trace de
     *  production le dit en clair : `onDelete → invalidateQueries →
     *  refetchQueries → GET /blocks/…/content`. Invalider ce qui n'existe plus
     *  n'a aucun sens ; il faut l'OUBLIER.
     *
     *  MUTATION QUI ROUGIT : retirer le `removeQueries` de `removeBlock` —
     *  l'entrée reste en cache, et c'est elle que l'invalidation rappellerait. */
    macrosServeur = [{
      ...arbre()[0],
      blocks: [arbre()[0].blocks[0], { ...arbre()[0].blocks[0], id: 'bloc-2', blockNumber: 2 }],
    }];
    const { result, qc } = monter();

    // Le contenu du bloc 2 a été lu une fois : il est en cache, comme après une
    // visite du coach.
    qc.setQueryData(['block-content', 'prog-1', 'bloc-2'], { base: null, weeks: [] });
    expect(qc.getQueryData(['block-content', 'prog-1', 'bloc-2'])).toBeDefined();

    await act(async () => { await result.current.removeBlock(1); });

    expect(qc.getQueryData(['block-content', 'prog-1', 'bloc-2'])).toBeUndefined();
  });
});
