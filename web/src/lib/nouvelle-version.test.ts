// @vitest-environment jsdom
/** « Recharger » doit s'afficher sur ORDINATEUR aussi.
 *
 *  Le message ne dépendait que de deux signaux, et un poste fixe les rate tous
 *  les deux : un onglet qui reste VISIBLE n'émet jamais `visibilitychange`, et
 *  une page rechargée de force (Ctrl+Maj+R) n'est plus contrôlée par le service
 *  worker. Un téléphone passe sans cesse à l'arrière-plan et ne sait pas
 *  recharger de force : il ne connaît aucun des deux trous. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.fn();
vi.mock('sonner', () => ({ toast: (...a: unknown[]) => toast(...a) }));
vi.mock('@/i18n', () => ({ default: { t: (cle: string) => cle } }));
vi.mock('@/lib/observabilite', () => ({ signalerDegradation: vi.fn() }));

const MA_VERSION = 'abc1234';
const swDe = (version: string) => `// sw\nconst CACHE_NAME = 'eitri-${version}-1790000000000';\n`;

let serviceWorker: EventTarget & { controller: unknown; getRegistration: () => Promise<unknown> };
let servie: string | Error;
let arreter: () => void = () => {};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('VITE_GIT_SHA', MA_VERSION);
  toast.mockClear();
  servie = swDe(MA_VERSION);
  serviceWorker = Object.assign(new EventTarget(), {
    controller: {} as unknown,
    getRegistration: () => Promise.resolve({ update: () => Promise.resolve() }),
  });
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
  vi.stubGlobal('fetch', vi.fn(() =>
    servie instanceof Error
      ? Promise.reject(servie)
      : Promise.resolve({ ok: true, text: () => Promise.resolve(servie as string) })));
});

afterEach(() => {
  arreter();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function demarrer() {
  const { surveillerNouvelleVersion } = await import('./nouvelle-version');
  arreter = surveillerNouvelleVersion();
}

describe('surveillerNouvelleVersion', () => {
  it("prévient un onglet resté VISIBLE, qui n'émet jamais visibilitychange", async () => {
    await demarrer();
    servie = swDe('def5678');                       // un déploiement passe
    await vi.advanceTimersByTimeAsync(16 * 60_000);  // l'onglet n'a pas bougé
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe('maj.disponible');
  });

  it('prévient une page NON contrôlée — rechargée de force — quand le worker est remplacé', async () => {
    serviceWorker.controller = null;                 // Ctrl+Maj+R
    await demarrer();
    servie = swDe('def5678');
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("se tait à la PREMIÈRE installation : le worker arrive, la version n'a pas changé", async () => {
    serviceWorker.controller = null;
    await demarrer();
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).not.toHaveBeenCalled();
  });

  it('se tait tant que la version servie est la sienne', async () => {
    await demarrer();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(toast).not.toHaveBeenCalled();
  });

  it('se tait hors ligne, et reprend au retour du réseau', async () => {
    await demarrer();
    servie = new Error('hors ligne');
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(toast).not.toHaveBeenCalled();
    servie = swDe('def5678');
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("demande TOUJOURS la même URL : le worker met en cache tout GET de même origine", async () => {
    await demarrer();
    await vi.advanceTimersByTimeAsync(46 * 60_000);
    const urls = new Set((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0]));
    expect([...urls]).toEqual(['/sw.js']);
  });

  it("ne prend pas le sw.js du DÉVELOPPEMENT (`eitri-v1`) pour une autre version", async () => {
    await demarrer();
    servie = "const CACHE_NAME = 'eitri-v1';";
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(toast).not.toHaveBeenCalled();
  });
});
