import { expect, test } from '@playwright/test';
import { BROKKR, COACH, jeton, seConnecter } from './aides';

/** DEUX COACHS SUR UN MÊME PLATEAU — FRE-162.
 *
 *  Le plateau renvoie la liste ENTIÈRE des participants et de leurs essais à
 *  chaque saisie. Le coach dont l'écran avait été chargé AVANT l'écriture d'un
 *  autre effaçait celle-ci sans que personne le sache. On ne permet pas la saisie
 *  concurrente (décision William, 16/09) : on rend le conflit VISIBLE, et rien ne
 *  s'efface.
 *
 *  ⚠️ PAR L'ÉCRAN, ET PAS SEULEMENT PAR L'API : la garde a deux moitiés. brokkr
 *  refuse une version périmée (`tests/test_competitions.py`) ; le front doit
 *  présenter la bonne — et, surtout, ne pas se la refuser à lui-même quand le
 *  plateau enregistre plusieurs fois de suite. Seule une spec d'écran voit ça.
 *
 *  L'autre coach est joué par l'API : c'est exactement ce qu'un second téléphone
 *  enverrait, sans une seconde session à orchestrer. */

const COMPET = 'e2e-deux-coachs';
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
const lire = async () => (await (await appel('/competitions')).json())
  .find((c: { id: string }) => c.id === COMPET) as { version: string; participants: { name: string; bodyweight?: number }[] };

test.afterEach(async () => {
  await appel(`/competitions/${COMPET}`, { method: 'DELETE' });
});

test.beforeEach(async ({ page }) => {
  const r = await appel(`/competitions/${COMPET}`, {
    method: 'PUT',
    body: JSON.stringify({
      // Dans le futur : l'écran range les compétitions passées ailleurs.
      name: 'Plateau à deux E2E', date: '2026-12-13', maxAttempts: 3,
      movementNames: ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'],
      participants: [{ name: 'Alpha E2E', bodyweight: 70, gender: 'M', movements: [] }],
    }),
  });
  expect(r.status, await r.text()).toBe(200);
  await seConnecter(page);
  await page.goto('/competitions');
  await page.getByRole('button', { name: /Plateau à deux E2E/ }).click();
});

// Le poids du jour se saisit sous le nom de l'athlète, dans le bloc des groupes ;
// Alpha, seul inscrit, y est affiché d'office.
const poidsDAlpha = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Groupes et athlètes' }).getByRole('textbox', { name: /Poids du jour/ });

test('deux enregistrements qui se croisent ne se refusent pas l’un l’autre', async ({ page }) => {
  /** ⚠️ LE CAS QUE LA FILE EXISTE POUR TENIR. Le plateau enregistre 600 ms après
   *  la dernière frappe ; si la réponse tarde — un réseau de salle —, la saisie
   *  suivante part AVANT le retour de la précédente, avec la même version, et le
   *  serveur la refuserait. Contre son propre auteur.
   *
   *  En local, un PATCH revient en quelques millisecondes : sans ce retard, la
   *  spec passait avec ou sans la file, c'est-à-dire pour rien.
   *
   *  MUTATIONS QUI ROUGISSENT : envoyer sans attendre l'écriture précédente ; ne
   *  pas remettre en cache la version rendue par le PATCH. */
  await page.route(`**/competitions/${COMPET}`, async route => {
    if (route.request().method() === 'PATCH') await new Promise(r => setTimeout(r, 1500));
    await route.continue();
  });
  await poidsDAlpha(page).fill('71');
  await page.waitForTimeout(900);         // le premier PATCH est parti, et il est en vol
  await poidsDAlpha(page).fill('72');
  await expect.poll(async () => (await lire()).participants[0].bodyweight, { timeout: 15_000 }).toBe(72);
  await expect(page.getByText('Cette compétition a changé')).toHaveCount(0);
});

test('un second coach a enregistré entre-temps : le refus se voit, et son travail reste', async ({ page }) => {
  /** MUTATION QUI ROUGIT : retirer la comparaison de version côté brokkr — Bravo
   *  disparaît de la base. */
  // L'autre téléphone ajoute Bravo, à partir de la version que l'écran a lue.
  const { version } = await lire();
  const r = await appel(`/competitions/${COMPET}`, {
    method: 'PATCH',
    body: JSON.stringify({
      version,
      participants: [
        { name: 'Alpha E2E', bodyweight: 70, gender: 'M', movements: [] },
        { name: 'Bravo E2E', bodyweight: 80, gender: 'M', movements: [] },
      ],
    }),
  });
  expect(r.status, await r.text()).toBe(200);

  // Cet écran, lui, n'a jamais vu Bravo — et saisit quand même.
  await poidsDAlpha(page).fill('75');

  await expect(page.getByText('Cette compétition a changé')).toBeVisible({ timeout: 10_000 });
  // Rien d'effacé en base…
  expect((await lire()).participants.map(p => p.name)).toEqual(['Alpha E2E', 'Bravo E2E']);
  // …et l'écran s'est rechargé sur ce qui existe vraiment.
  await expect(page.getByRole('region', { name: 'Groupes et athlètes' }).getByText('Bravo E2E')).toBeVisible({ timeout: 10_000 });
});
