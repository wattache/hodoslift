import { expect, test } from '@playwright/test';

/** LA FRISE DE PÉRIODISATION — l'onglet Calendrier (16/09).
 *
 *  La géométrie (semaines réelles, trous, fenêtre, jalons) est gardée par
 *  `lib/frise-periodisation.test.ts`. Ce que ces specs gardent, et qu'aucune
 *  unitaire ne voit : que l'ÉCRAN branche les gestes promis à William.
 *
 *    1. tout ce qui désigne un bloc y mène — l'Entraînement, sur sa semaine ;
 *    2. glisser sur des jours ouvre le formulaire, prérempli avec la plage ;
 *    3. les objectifs du bloc se lisent au survol (ils vivaient dans l'onglet
 *       Périodisation, qui a disparu) ;
 *    4. le formulaire ne propose plus de saisir une compétition.
 *
 *  Fixture : « Prépa FNSL » — l'Intensification contient aujourd'hui, dans une
 *  semaine de NEUF jours (`week-3`) ; l'Accumulation porte deux objectifs. */

test('cliquer un bloc ouvre l’Entraînement sur sa semaine — celle d’aujourd’hui s’il est en cours', async ({ page }) => {
  /** MUTATION QUI ROUGIT : la bande sans `onClick`. */
  await page.goto('/calendar');
  await page.locator('[data-bloc="block-2"]').click();
  await expect(page).toHaveURL(/\/training\?week=week-3$/);
});

test('glisser sur des jours ouvre le formulaire d’événement sur cette plage', async ({ page }) => {
  /** MUTATION QUI ROUGIT : ouvrir le formulaire sur aujourd'hui, en ignorant la plage. */
  await page.goto('/calendar');
  const jours = page.locator('[data-jour]');
  await expect(jours.first()).toBeVisible();
  const [debut, fin] = await Promise.all([jours.nth(1).getAttribute('data-jour'), jours.nth(3).getAttribute('data-jour')]);
  await jours.nth(1).hover();
  await page.mouse.down();
  await jours.nth(3).hover();
  await page.mouse.up();
  const brouillon = page.locator('[data-brouillon-debut]');
  await expect(brouillon).toHaveAttribute('data-brouillon-debut', debut!);
  await expect(brouillon).toHaveAttribute('data-brouillon-fin', fin!);
});

test('les objectifs du bloc se lisent au survol de sa bande', async ({ page }) => {
  /** MUTATION QUI ROUGIT : l'infobulle sans la liste des objectifs. */
  await page.goto('/calendar');
  await page.locator('[data-bloc="block-1"]').hover();
  const bulle = page.getByRole('tooltip');
  await expect(bulle).toContainText('MUSCLE UP');
  await expect(bulle).toContainText('SQUAT');
});

test('le formulaire ne propose plus de saisir une compétition — elle vit dans son onglet', async ({ page }) => {
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByTitle('Vacances', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Compétition', { exact: true })).toHaveCount(0);
});
