import { expect, test, type Page, type Route } from '@playwright/test';
import { BROKKR, COACH, jeton, seConnecter } from './aides';

/** LE PLATEAU SUR UN RÉSEAU DE SALLE — une relecture périmée n'efface rien.
 *
 *  Chaque geste renvoie la feuille ENTIÈRE, depuis l'état de l'écran. Si une
 *  relecture partie AVANT la dernière écriture revient après elle, l'écran
 *  retombe sur un état d'avant : le verdict tout juste saisi disparaît, et le
 *  geste suivant l'efface de la base — un 200, aucun message.
 *
 *  ⚠️ EN LOCAL, TOUT REVIENT EN QUELQUES MILLISECONDES : sans retards fabriqués,
 *  la spec passe avec ou sans la garde.
 *
 *  ⚠️ CE QUE LE DEV-MOCK NE VOIT PAS : il n'écrit ni ne relit rien. */

const COMPET = 'e2e-reseau-lent';
const ORIGINE = 'http://localhost:5200';
const attendre = (ms: number) => new Promise(r => setTimeout(r, ms));

async function appel(chemin: string, options: RequestInit = {}) {
  return fetch(`${BROKKR}${chemin}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${await jeton(COACH)}`, Origin: ORIGINE, 'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}
type Lu = { participants: { bodyweight?: number; movements: { attempts: { result: string; selectedTier?: string }[] }[] }[] };
const lire = async () => (await (await appel('/competitions')).json())
  .find((c: { id: string }) => c.id === COMPET) as Lu;

const plan = (r: number) => ({ weight: 0, result: '', weights: { pessimistic: r - 2.5, realistic: r, optimistic: r + 2.5 } });

const estLaListe = (route: Route) => route.request().method() === 'GET' && /\/competitions(\?|$)/.test(route.request().url());
const estUneEcriture = (route: Route) => route.request().method() === 'PATCH';

test.afterEach(async () => {
  await appel(`/competitions/${COMPET}`, { method: 'DELETE' });
});

test.beforeEach(async ({ page }) => {
  const r = await appel(`/competitions/${COMPET}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Réseau lent E2E', date: '2026-12-13', maxAttempts: 3,
      movementNames: ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'],
      participants: [{ name: 'Alpha E2E', bodyweight: 78, gender: 'M',
                       movements: [{ name: 'SQUAT', attempts: [plan(100), plan(105), plan(110)] }] }],
    }),
  });
  expect(r.status, await r.text()).toBe(200);
  await seConnecter(page);
  await page.goto('/competitions');
  await page.getByRole('button', { name: /Réseau lent E2E/ }).click();
  await expect(enBarre(page).getByRole('heading', { name: 'Alpha E2E' })).toBeVisible();
});

const enBarre = (page: Page) => page.getByRole('region', { name: 'En barre' });
const annoncer = (page: Page) => enBarre(page).getByRole('group', { name: /Charges du plan/ }).getByRole('button', { name: /^100/ }).click();
const rep = (page: Page) => enBarre(page).getByRole('button', { name: 'REP', exact: true });
/** Le premier squat jugé, le plateau est au deuxième ; il y reste tant que le verdict tient à l'écran.
 *  ⚠️ LU SUR L'INSTANT (`isVisible`), JAMAIS ATTENDU : l'écran se répare seul à la relecture
 *  suivante, et une assertion qui patiente attendrait la réparation — puis laisserait le geste
 *  suivant partir d'un état sain. La spec passait alors avec ou sans la garde. */
const tourSuivant = (page: Page) => page.getByText(/Tour 11 \/ 12/);
const poids = (page: Page) => page.getByRole('region', { name: 'Groupes et athlètes' }).getByRole('textbox', { name: /Poids du jour/ });
/** Le verdict et le poids, tels qu'ils sont EN BASE. */
const enBase = async () => { const p = (await lire()).participants[0]; return [p.movements[0].attempts[0].result, p.bodyweight]; };

test('une relecture partie AVANT l’écriture ne revient pas effacer le verdict', async ({ page }) => {
  /** LA DESCENTE EST LENTE : le serveur a répondu, la réponse traîne. La
   *  relecture qui suit l'annonce est encore en vol quand le REP part ; elle
   *  revient ensuite avec la feuille d'AVANT le REP.
   *
   *  MUTATION QUI ROUGIT : retirer `enVol.current` de la garde du resync
   *  (`competition-detail.tsx`). */
  await page.route('**/competitions**', async route => {
    if (!estLaListe(route) && !estUneEcriture(route)) return route.continue();
    const response = await route.fetch();
    await attendre(estUneEcriture(route) ? 1200 : 2500);
    await route.fulfill({ response }).catch(() => {});   // la relecture annulée n'attend plus personne
  });

  await annoncer(page);              // l'écriture part à 0,6 s, revient à 1,8 s ; la relecture reviendra à 4,3 s
  await page.waitForTimeout(2600);
  await rep(page).click();           // part à 3,2 s, revient à 4,4 s
  await page.waitForTimeout(2400);   // 5,0 s : la relecture périmée est revenue, la bonne pas encore
  const aLEcran = await tourSuivant(page).isVisible();
  await poids(page).fill('79');      // le geste suivant renvoie la feuille entière

  await expect.poll(enBase, { timeout: 20_000 }).toEqual(['rep', 79]);
  expect(aLEcran, 'le verdict était encore à l’écran au moment du geste suivant').toBe(true);
});
