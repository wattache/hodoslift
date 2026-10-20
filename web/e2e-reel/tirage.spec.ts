import { expect, test } from '@playwright/test';
import { BROKKR, COACH, jeton, seConnecter } from './aides';

/** LE TIRAGE, par le vrai chemin : pull up OU chin up, au choix de l'athlète,
 *  sur l'emplacement « PULL UP » de la compétition. Choisi sur sa carte, il
 *  arrive en base, et la ligne porte le mouvement réellement disputé — servi par
 *  brokkr (`mouvement_reel`). */

const COMPET = 'e2e-tirage';
const ORIGINE = 'http://localhost:5200';

async function appel(chemin: string, options: RequestInit = {}) {
  return fetch(`${BROKKR}${chemin}`, {
    ...options,
    headers: { Authorization: `Bearer ${await jeton(COACH)}`, Origin: ORIGINE, 'Content-Type': 'application/json',
               ...(options.headers ?? {}) },
  });
}
const tirageEnBase = async () => ((await (await appel('/competitions')).json())
  .find((c: { id: string }) => c.id === COMPET)?.participants[0]?.tirage);

test.afterEach(async () => { await appel(`/competitions/${COMPET}`, { method: 'DELETE' }); });

test('le coach passe son athlète en chin up depuis sa carte, et la ligne le dit', async ({ page }) => {
  const plan = { weight: 0, result: '', weights: { pessimistic: 90, realistic: 92.5, optimistic: 95 } };
  const r = await appel(`/competitions/${COMPET}`, { method: 'PUT', body: JSON.stringify({
    name: 'Tirage E2E', date: '2026-12-13', maxAttempts: 3, movementNames: ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'],
    participants: [{ name: 'Alpha E2E', bodyweight: 78, gender: 'M', movements: [{ name: 'PULL UP', attempts: [plan, plan, plan] }] }],
  }) });
  expect(r.status, await r.text()).toBe(200);
  expect(await tirageEnBase()).toBe('PULL UP');

  await seConnecter(page);
  await page.goto('/competitions');
  await page.getByRole('button', { name: /Tirage E2E/ }).click();
  await page.getByRole('combobox', { name: 'Tirage' }).selectOption('CHIN UP');

  await expect.poll(tirageEnBase, { timeout: 10_000 }).toBe('CHIN UP');
  // La ligne nomme le mouvement disputé, servi par brokkr à la relecture.
  await expect(page.getByRole('region', { name: 'Groupes et athlètes' }).getByText('CHIN UP', { exact: true })).toBeVisible();
});
