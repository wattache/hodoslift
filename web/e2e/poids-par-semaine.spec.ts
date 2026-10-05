import { expect, test } from '@playwright/test';

/** LE POIDS PAR SEMAINE, dans le Tracker (William, 29/09) : l'onglet, le
 *  tableau, le départ et la cible. Le dev-mock fige le calcul de brokkr ; ce
 *  qu'on éprouve est l'écran. Le calcul et l'aller-retour du départ se prouvent
 *  dans le harnais réel. */

test('l’onglet montre le départ, la pesée visée, et une ligne par semaine', async ({ page }) => {
  await page.goto('/tracker');
  await page.getByRole('tab', { name: 'Poids par semaine' }).click();

  await expect(page.locator('[data-depart]')).toContainText('63,0 kg');
  await expect(page.locator('[data-cible]')).toContainText('Open de printemps');
  await expect(page.locator('[data-poids-semaines] tbody tr')).toHaveCount(3);
  await expect(page.locator('[data-semaine="3"] [data-ecart]')).toHaveText('−1,3 kg');
  await expect(page.locator('[data-reste-actuel]')).toContainText('reste 4,7 kg');
});

test('le départ se modifie sur place, avec une date qui ne peut pas être dans le futur', async ({ page }) => {
  await page.goto('/tracker');
  await page.getByRole('tab', { name: 'Poids par semaine' }).click();
  await page.getByRole('button', { name: 'Modifier' }).click();

  const kg = page.getByRole('spinbutton', { name: 'Poids de départ' });
  await expect(kg).toHaveValue('63');
  await kg.fill('64.5');
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  await kg.fill('0');
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(kg).toHaveCount(0);
});

test('choisir la date du départ reprend la pesée saisie ce jour-là', async ({ page }) => {
  await page.goto('/tracker');
  await page.getByRole('tab', { name: 'Poids par semaine' }).click();
  await page.getByRole('button', { name: 'Modifier' }).click();

  // Hier : le dev-mock y porte une pesée (62,0 kg).
  const hier = new Date(); hier.setDate(hier.getDate() - 1);
  const iso = hier.toISOString().slice(0, 10);
  await page.getByTitle('Date du départ').click();
  await page.locator(`[role="gridcell"][data-day="${iso}"] button`).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('spinbutton', { name: 'Poids de départ' })).toHaveValue('62');
  await expect(page.locator('[data-pesee-reprise]')).toContainText('62,0 kg');
});
