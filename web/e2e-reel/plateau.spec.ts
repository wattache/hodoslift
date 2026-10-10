import { expect, test } from '@playwright/test';
import { BROKKR, COACH, jeton, seConnecter } from './aides';

/** LA SAISIE SUR LA CARTE, par le vrai chemin (FRE-204, FRE-225).
 *
 *  Le coach ouvre un athlète, annonce, juge — tout sur sa carte, plus d'encart
 *  qui suit la séquence. Avec brokkr derrière : la catégorie range les deux
 *  athlètes dans le même groupe, le score revient du serveur, la rafale de
 *  gestes ne part qu'en UNE écriture, et la compétition se crée sous le
 *  règlement qu'on nomme.
 *
 *  ⚠️ DEUX COACHS QUI ÉCRIVENT EN MÊME TEMPS NE SONT PAS COUVERTS : le second
 *  reçoit un 409 (la garde de version, FRE-162) et perd sa saisie. C'est le
 *  ticket d'une écriture par essai, pas une spec à faire passer en trichant.
 *
 *  ⚠️ CE QUE LE DEV-MOCK NE VOIT PAS : ses écritures sont des no-op, il ne peut
 *  ni compter les PATCH, ni dire que l'annonce est arrivée en base. */

const COMPET = 'e2e-plateau';
const ORIGINE = 'http://localhost:5200';

async function appel(chemin: string, options: RequestInit = {}) {
  return fetch(`${BROKKR}${chemin}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${await jeton(COACH)}`, Origin: ORIGINE, 'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}
type Lu = { reglement: string; participants: { name: string; flight?: string; score: number;
  movements: { name: string; attempts: { weight: number; result: string; selectedTier?: string; norepReason?: string }[] }[] }[] };
const lire = async () => (await (await appel('/competitions')).json())
  .find((c: { id: string }) => c.id === COMPET) as Lu;

const plan = (r: number) => ({ weight: 0, result: '', weights: { pessimistic: r - 2.5, realistic: r, optimistic: r + 2.5 } });
const squat = (r: number) => [{ name: 'SQUAT', attempts: [plan(r), plan(r + 5), plan(r + 10)] }];

test.afterEach(async () => {
  await appel(`/competitions/${COMPET}`, { method: 'DELETE' });
});

test('un coach, deux athlètes : tout se saisit sur la carte, en une écriture, sous le règlement nommé', async ({ page }) => {
  const r = await appel(`/competitions/${COMPET}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Plateau E2E', date: '2026-12-13', maxAttempts: 3, reglement: 'finalrep',
      movementNames: ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'],
      flights: [{ name: 'A', categories: [{ gender: 'M', weightCategory: '-80' }] }],
      participants: [
        { name: 'Bravo E2E', bodyweight: 79, gender: 'M', weightCategory: '-80', movements: squat(110) },
        { name: 'Alpha E2E', bodyweight: 78, gender: 'M', weightCategory: '-80', movements: squat(100) },
      ],
    }),
  });
  expect(r.status, await r.text()).toBe(200);
  // La catégorie a rangé les deux athlètes dans le groupe A, et le règlement est celui nommé : c'est brokkr qui le dit.
  const avant = await lire();
  expect([avant.reglement, ...avant.participants.map(p => p.flight)]).toEqual(['finalrep', 'A', 'A']);

  const ecritures: string[] = [];
  page.on('request', req => { if (req.method() === 'PATCH' && req.url().includes(COMPET)) ecritures.push(req.url()); });

  await seConnecter(page);
  await page.goto('/competitions');
  await page.getByRole('button', { name: /Plateau E2E/ }).click();
  const bloc = page.getByRole('region', { name: 'Groupes et athlètes' });
  // Pas d'encart qui suit la séquence : la carte, et elle seule.
  await expect(page.getByRole('region', { name: 'En barre' })).toHaveCount(0);

  // Bravo d'abord : sa carte, son premier squat, 110, passé.
  await bloc.getByRole('group', { name: 'Athlètes du groupe' }).getByRole('button', { name: /^Bravo E2E/ }).click();
  await page.getByRole('button', { name: /^Bravo E2E — SQUAT essai 1/ }).click();
  const saisieBravo = page.getByRole('region', { name: 'SQUAT · essai 1' });
  await saisieBravo.getByRole('group', { name: /Charges du plan/ }).getByRole('button', { name: /^110/ }).click();
  await saisieBravo.getByRole('button', { name: 'REP', exact: true }).click();

  // Puis Alpha : la carte change parce qu'on l'a choisie, pas parce qu'un verdict l'a déplacée.
  await bloc.getByRole('group', { name: 'Athlètes du groupe' }).getByRole('button', { name: /^Alpha E2E/ }).click();
  await expect(bloc.getByRole('heading', { level: 3, name: 'Alpha E2E' })).toBeVisible();

  // Sa rafale, d'un trait : Alpha annonce son R, passe, puis échoue le suivant — motif FinalRep.
  await page.getByRole('button', { name: /^Alpha E2E — SQUAT essai 1/ }).click();
  const saisie1 = page.getByRole('region', { name: 'SQUAT · essai 1' });
  await saisie1.getByRole('group', { name: /Charges du plan/ }).getByRole('button', { name: /^100/ }).click();
  await saisie1.getByRole('button', { name: 'REP', exact: true }).click();
  await page.getByRole('button', { name: /^Alpha E2E — SQUAT essai 2/ }).click();
  const saisie2 = page.getByRole('region', { name: 'SQUAT · essai 2' });
  await saisie2.getByRole('group', { name: /Charges du plan/ }).getByRole('button', { name: /^105/ }).click();
  await saisie2.getByRole('button', { name: 'NO REP', exact: true }).click();
  await saisie2.getByRole('combobox', { name: 'Motif du no rep' }).selectOption('fr_depth');

  // Le score servi revient dans le classement, et la carte n'a pas bougé.
  // MUTATION QUI ROUGIT : suivre l'athlète en barre à la relecture.
  await expect(page.locator('li').filter({ hasText: 'Bravo E2E' }).filter({ hasText: '110 kg' })).toHaveCount(1, { timeout: 10_000 });
  await expect(bloc.getByRole('heading', { level: 3, name: 'Alpha E2E' })).toBeVisible();

  // En base : les annonces, les verdicts, le motif FinalRep, et le score servi.
  await expect.poll(async () => (await lire()).participants
    .map(p => [p.name, p.score, p.movements[0].attempts[0].selectedTier, p.movements[0].attempts[0].result, p.movements[0].attempts[1].norepReason ?? null]),
  { timeout: 10_000 }).toEqual([['Alpha E2E', 100, 'realistic', 'rep', 'fr_depth'], ['Bravo E2E', 110, 'realistic', 'rep', null]]);
  /** MUTATION QUI ROUGIT : retirer le délai de `commit` — chaque geste part seul. */
  expect(ecritures).toHaveLength(1);
});
