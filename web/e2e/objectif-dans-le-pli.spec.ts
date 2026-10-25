import { expect, test } from '@playwright/test';

/** L'ATHLÈTE RETROUVE L'OBJECTIF DU BLOC EN DÉPLIANT UN EXERCICE (FRE-253).
 *  Le dev-mock pose les objectifs sur « Accumulation » : un muscle-up et un
 *  squat. La spec y va, déplie, et lit. */
test('déplier un exercice montre l’objectif du bloc qui porte son mouvement', async ({ page }) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
  await page.getByRole('button', { name: 'Détail' }).click();
  await page.getByTitle(/Voir notes|Ajouter une note/).first().click();

  // MUTATION QUI ROUGIT : l'encart absent du pli (objectifs non transmis).
  const encart = page.locator('[data-objectif-de-l-exercice]').first();
  await expect(encart).toBeVisible();
  await expect(encart).toContainText(/Objectifs? du bloc/);
});
