import { expect, test } from '@playwright/test';

/** LE CALENDRIER AU MOIS (FRE-245) — la bascule, et toucher un jour.
 *  La grille (lundi→dimanche, mois voisins) est gardée par `lib/calendrier-mois.test.ts`. */

test('la vue Mois se choisit, se retrouve au retour, et toucher un jour ouvre le formulaire à cette date', async ({ page }) => {
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Mois', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();

  // Un jour qui n'est PAS aujourd'hui : le formulaire s'ouvre par défaut sur
  // aujourd'hui, et ne prouverait rien. MUTATION QUI ROUGIT : ignorer le jour touché.
  const cases = page.locator('[role="gridcell"][data-jour]');
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const jour = (await cases.evaluateAll((els, a) =>
    els.map(e => e.getAttribute('data-jour')!).find(j => j !== a), aujourdhui))!;
  await page.locator(`[role="gridcell"][data-jour="${jour}"] > button`).first().click();
  // Une FENÊTRE, pas une ligne de la liste : au téléphone, la liste est hors de l'écran.
  const brouillon = page.getByRole('dialog');
  await expect(brouillon).toContainText('Nouvel évènement');
  await expect(brouillon).toHaveAttribute('data-brouillon-debut', jour);
  await expect(brouillon).toHaveAttribute('data-brouillon-fin', jour);

  // MUTATION QUI ROUGIT : la vue tenue en état local seulement.
  await page.reload();
  await expect(page.getByRole('grid')).toBeVisible();
});
