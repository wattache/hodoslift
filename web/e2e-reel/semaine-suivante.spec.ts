import { expect, test } from '@playwright/test';
import { modeCoach, nettoyer, S1_DATEE, poserUnMacro, seConnecter, seriesParSemaine } from './aides';

/** LE scénario que rien ne couvrait, et le plus coûteux qu'on ait eu.
 *
 *  « Ajouter une semaine » clonait la précédente AVEC les uuid de ses lignes.
 *  Les frappes du coach dans la semaine neuve partaient donc en
 *  `PATCH /exercises/{ligne de la semaine PASSÉE}` — le serveur acceptait, et
 *  écrasait le réalisé déjà entraîné. Silencieusement : ça se découvrait trois
 *  semaines plus tard en relisant l'historique.
 *
 *  L'assertion qui compte n'est pas « la nouvelle semaine a la bonne valeur »,
 *  c'est **« l'ANCIENNE n'a pas bougé »**. C'est elle qui manquait partout.
 */
test.afterEach(nettoyer);

test('frapper dans la semaine neuve ne touche pas la précédente', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }], { datesDeS1: S1_DATEE });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  // ⚠️ ON RETARDE LE REFETCH, ET C'EST TOUT L'INTÉRÊT DU TEST.
  //
  // `addWeek` invalide la requête, et la réponse arrive en ~50 ms : l'état local
  // est alors remplacé par la vérité du serveur, ids compris. La fenêtre de
  // corruption est donc RÉELLE mais trop courte pour être atteinte par hasard —
  // une première version de ce test restait verte avec le bug réintroduit, ce
  // qui en faisait un test qui ment.
  //
  // En retardant `GET /training`, on maintient l'état local issu de
  // `buildNextWeek` le temps de frapper. C'est exactement la situation du coach
  // sur un réseau lent, et c'est là que la corruption avait lieu.
  await page.route('**/training', async route => {
    await new Promise(r => setTimeout(r, 4000));
    await route.continue();
  });

  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await expect.poll(async () => (await seriesParSemaine()).length,
                    { timeout: 10_000 }).toBe(2);

  // La semaine 2 est sélectionnée après sa création : on tape dedans TOUT DE
  // SUITE, avant que le refetch n'ait pu corriger les identités.
  const series = page.getByLabel('Séries').first();
  await series.fill('9');
  await series.blur();
  await page.waitForTimeout(1200);      // le debounce d'écriture est à 400 ms

  await expect.poll(seriesParSemaine, { timeout: 10_000 })
    .toEqual([['5'], ['9']]);          // ← S1 intacte, S2 modifiée
});
