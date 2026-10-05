import { expect, test } from '@playwright/test';

/** LE CHRONO INTÉGRÉ, À DÉCLENCHER (William, 14/09).
 *
 *  Ce que ces specs gardent :
 *    1. RIEN ne le lance tout seul — noter un RPE, en particulier ;
 *    2. il se lance depuis l'en-tête, sur n'importe quel écran ;
 *    3. il continue de tourner quand on QUITTE l'app : un rechargement après
 *       dix minutes montre dix minutes, pas zéro ;
 *    4. la pause fige le temps.
 *
 *  L'horloge est pilotée (`page.clock`) : dix vraies minutes ne prouveraient rien
 *  de plus.
 */

const bandeau = (page: import('@playwright/test').Page) => page.getByRole('timer');
const lancer = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /Lancer le chrono|Start the stopwatch/ });

test('noter un RPE ne lance aucun chrono', async ({ page }) => {
  /** Le minuteur lancé par le RPE a été retiré le 14/09 : on ne note pas
   *  toujours son RPE série par série. MUTATION QUI ROUGIT : rebrancher un
   *  lancement sur le choix d'un RPE. */
  await page.goto('/training');
  await page.getByRole('button', { name: 'Détail' }).click();
  await page.getByTitle(/Voir notes|Ajouter une note/).first().click();
  const menu = page.getByRole('combobox', { name: 'RPE réel' });
  await menu.selectOption('6.5');
  await expect(menu).toHaveValue('6.5');
  await expect(bandeau(page)).toHaveCount(0);
});

test('lancé depuis l’en-tête, il survit à la navigation et au départ de l’app', async ({ page }) => {
  await page.clock.install();
  await page.goto('/library');
  await expect(bandeau(page)).toHaveCount(0);

  await lancer(page).click();
  await expect(bandeau(page)).toBeVisible();
  await expect(bandeau(page)).toContainText('0:00');

  // Un autre écran : il tourne encore.
  await page.clock.fastForward(65_000);
  await page.goto('/training');
  await expect(bandeau(page)).toContainText('1:05');

  // ⚠️ L'APP QUITTÉE : dix minutes sans rendu, puis un rechargement. Un compteur
  // incrémenté repartirait de zéro ; des instants gardés disent 11:05.
  // MUTATION QUI ROUGIT : ne pas lire le stockage à l'initialisation.
  await page.clock.fastForward(600_000);
  await page.reload();
  await expect(bandeau(page)).toContainText('11:05');
});

test('la pause fige le temps, et fermer le fait disparaître', async ({ page }) => {
  /** MUTATION QUI ROUGIT : `basculerPause` qui ne fait rien. */
  await page.clock.install();
  await page.goto('/dashboard');
  await lancer(page).click();
  await page.clock.fastForward(20_000);
  await bandeau(page).getByRole('button', { name: /Mettre en pause|Pause/ }).click();
  await expect(bandeau(page)).toHaveAttribute('data-etat', 'en-pause');
  const fige = await bandeau(page).textContent();

  await page.clock.fastForward(30_000);
  await expect(bandeau(page)).toHaveText(fige ?? '');

  await bandeau(page).getByRole('button', { name: /Fermer le chrono|Close the stopwatch/ }).click();
  await expect(bandeau(page)).toHaveCount(0);
});
