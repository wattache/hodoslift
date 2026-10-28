import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/** CE QUE LE SERVICE WORKER MET EN CACHE (FRE-263).
 *
 *  ⚠️ L'API, L'AUTH ET FIREBASE, JAMAIS — même servis depuis la même origine,
 *  comme le jour où l'image web parlera à brokkr par `/api`. Une réponse de
 *  brokkr porte les données de santé d'UN compte : resservie hors ligne, elle
 *  irait au compte suivant.
 *  MUTATION QUI ROUGIT : retirer la garde sur `/api/`, `/hodos.`, `/__/`. */
function intercepte(chemin: string): boolean {
  const ecouteurs: Record<string, (e: unknown) => void> = {};
  const self = { location: { origin: 'https://app.hodoslift.com' }, addEventListener: (n: string, f: (e: unknown) => void) => { ecouteurs[n] = f; } };
  // Ni réseau ni cache réels : seul compte le fait d'intercepter ou non.
  const caches = { match: async () => undefined, open: async () => ({ put: () => {} }) };
  const fetch = async () => new Response('');
  new Function('self', 'caches', 'fetch', readFileSync(join(__dirname, '../../public/sw.js'), 'utf8'))(self, caches, fetch);
  let repondu = false;
  ecouteurs.fetch({
    request: { method: 'GET', url: `https://app.hodoslift.com${chemin}`, destination: 'script', headers: new Headers() },
    respondWith: () => { repondu = true; },
  });
  return repondu;
}

it.each(['/api/users/me', '/hodos.v1.Douleurs/Lister', '/__/auth/handler'])('%s ne passe JAMAIS par le cache', chemin => {
  expect(intercepte(chemin)).toBe(false);
});

it('un fichier de l’application, lui, passe par le cache', () => {
  expect(intercepte('/assets/index-abc.js')).toBe(true);
});
