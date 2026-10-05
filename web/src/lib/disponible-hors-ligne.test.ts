import { beforeEach, describe, expect, it, vi } from 'vitest';

/** L'INDICATEUR NE DOIT MENTIR NI DANS UN SENS NI DANS L'AUTRE — FRE-118.
 *
 *  ⚠️ CE QU'IL PROMET EST DIFFICILE À RATTRAPER. L'athlète le lit AVANT de
 *  descendre au sous-sol ; s'il a tort, la découverte se fait une fois la séance
 *  commencée, sans réseau. D'où la lecture du DISQUE plutôt qu'une déduction
 *  depuis l'état des requêtes : le persister peut échouer (quota, navigation
 *  privée, IndexedDB refusé), et l'écran continuerait d'annoncer une sécurité
 *  qui n'existe pas.
 */
const disque = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => disque.get(k),
  set: async (k: string, v: unknown) => { disque.set(k, v); },
  del: async (k: string) => { disque.delete(k); },
}));

const { toutesSurLeDisque } = await import('@/lib/disponible-hors-ligne');
const { CLE_DU_CACHE } = await import('@/lib/persistance-hors-ligne');

const poser = (...hashs: string[]) =>
  disque.set(CLE_DU_CACHE, JSON.stringify({
    clientState: { queries: hashs.map(h => ({ queryHash: h })) },
  }));

beforeEach(() => disque.clear());

describe('« cette semaine est sur le téléphone »', () => {
  it('dit oui quand TOUTES y sont', async () => {
    poser('a', 'b', 'c');
    expect(await toutesSurLeDisque(['a', 'c'])).toBe(true);
  });

  it('⚠️ dit non dès qu’il en manque UNE', async () => {
    // C'est l'assertion qui porte le fichier. Les séances sur le disque sans
    // `me` ne s'ouvrent pas : le gate arrête l'athlète avant de les afficher.
    // Répondre « oui » serait juste sur la donnée et faux sur la promesse.
    poser('a', 'b');
    expect(await toutesSurLeDisque(['a', 'manquante'])).toBe(false);
  });

  it('un disque VIDE ne promet rien', async () => {
    expect(await toutesSurLeDisque(['a'])).toBe(false);
  });

  it('un cache ILLISIBLE ne promet rien non plus', async () => {
    // Une écriture interrompue, un quota atteint en plein `JSON.stringify` : ce
    // n'est plus un cache. Le pire serait de le prendre pour bon.
    disque.set(CLE_DU_CACHE, '{"clientState": {"queries": [');
    expect(await toutesSurLeDisque(['a'])).toBe(false);
  });

  it('une liste vide de requêtes n’est pas une promesse tenue par défaut', async () => {
    poser();
    expect(await toutesSurLeDisque(['a'])).toBe(false);
  });
});
