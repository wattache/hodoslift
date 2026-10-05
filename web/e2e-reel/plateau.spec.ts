import { expect, test } from '@playwright/test';
import { BROKKR, COACH, jeton, seConnecter } from './aides';

/** UN TOUR COMPLET SUR LE PLATEAU, par le vrai chemin (FRE-204).
 *
 *  Annoncer, juger, et voir le plateau passer au tour suivant — avec brokkr
 *  derrière : la catégorie range l'athlète dans son groupe, le score revient
 *  du serveur, et la rafale de gestes ne part qu'en UNE écriture.
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
type Lu = { participants: { name: string; flight?: string; score: number;
  movements: { name: string; attempts: { weight: number; result: string; selectedTier?: string }[] }[] }[] };
const lire = async () => (await (await appel('/competitions')).json())
  .find((c: { id: string }) => c.id === COMPET) as Lu;

const plan = (r: number) => ({ weight: 0, result: '', weights: { pessimistic: r - 2.5, realistic: r, optimistic: r + 2.5 } });
const squat = (r: number) => [{ name: 'SQUAT', attempts: [plan(r), plan(r + 5), plan(r + 10)] }];

test.afterEach(async () => {
  await appel(`/competitions/${COMPET}`, { method: 'DELETE' });
});

test('annoncer, juger, et le tour suivant — en une seule écriture', async ({ page }) => {
  const r = await appel(`/competitions/${COMPET}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Plateau E2E', date: '2026-12-13', maxAttempts: 3,
      movementNames: ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'],
      flights: [{ name: 'A', categories: [{ gender: 'M', weightCategory: '-80' }] }],
      participants: [
        { name: 'Bravo E2E', bodyweight: 79, gender: 'M', weightCategory: '-80', movements: squat(110) },
        { name: 'Alpha E2E', bodyweight: 78, gender: 'M', weightCategory: '-80', movements: squat(100) },
      ],
    }),
  });
  expect(r.status, await r.text()).toBe(200);
  // La catégorie a rangé les deux athlètes dans le groupe A : c'est brokkr qui le dit.
  expect((await lire()).participants.map(p => p.flight)).toEqual(['A', 'A']);

  const ecritures: string[] = [];
  page.on('request', req => { if (req.method() === 'PATCH' && req.url().includes(COMPET)) ecritures.push(req.url()); });

  await seConnecter(page);
  await page.goto('/competitions');
  await page.getByRole('button', { name: /Plateau E2E/ }).click();

  const enBarre = page.getByRole('region', { name: 'En barre' });
  // Personne au muscle up : le plateau s'ouvre sur le premier squat, Alpha (100) avant Bravo (110).
  await expect(page.getByText(/Tour 10 \/ 12 · Groupe A/)).toBeVisible();
  await expect(enBarre.getByRole('heading', { name: 'Alpha E2E' })).toBeVisible();
  await expect(enBarre.getByText(/passe en 1er sur 2/)).toBeVisible();

  // La rafale : Alpha annonce son R et passe, Bravo annonce son R et passe.
  const plan_ = () => enBarre.getByRole('group', { name: /Charges du plan/ });
  await plan_().getByRole('button', { name: /^100/ }).click();
  await enBarre.getByRole('button', { name: 'REP', exact: true }).click();
  await expect(enBarre.getByRole('heading', { name: 'Bravo E2E' })).toBeVisible();
  await plan_().getByRole('button', { name: /^110/ }).click();
  await enBarre.getByRole('button', { name: 'REP', exact: true }).click();

  // Le tour fini, le plateau passe seul au deuxième squat — Alpha (105) d'abord.
  await expect(page.getByText(/Tour 11 \/ 12 · Groupe A/)).toBeVisible();
  await expect(enBarre.getByRole('heading', { name: 'Alpha E2E' })).toBeVisible();

  // En base : les deux annonces et les deux verdicts, et le score servi.
  await expect.poll(async () => (await lire()).participants
    .map(p => [p.name, p.score, p.movements[0].attempts[0].selectedTier, p.movements[0].attempts[0].result]),
  { timeout: 10_000 }).toEqual([['Alpha E2E', 100, 'realistic', 'rep'], ['Bravo E2E', 110, 'realistic', 'rep']]);
  /** MUTATION QUI ROUGIT : retirer le délai de `commit` — chaque geste part seul. */
  expect(ecritures).toHaveLength(1);
});
