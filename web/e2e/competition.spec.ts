import { expect, test } from '@playwright/test';

/** Parcours compétition : liste → détail (deep-link router) → Plateau. */

test('ouvre une compétition et affiche ses données', async ({ page }) => {
  await page.goto('/competitions');

  // La liste montre les compétitions mock (à venir + terminées).
  await expect(page.getByText('FNSL Inter-Région').first()).toBeVisible();
  await expect(page.getByText('FNSL Région').first()).toBeVisible();

  // Ouverture du détail → l'URL porte l'id (deep-link).
  await page.getByText('FNSL Inter-Région').first().click();
  await expect(page).toHaveURL(/\/competitions\/comp-1$/);

  // Le Plateau : les groupes et leurs athlètes, et l'athlète en barre.
  await expect(page.getByRole('heading', { name: 'Groupes et athlètes' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'En barre' }).getByRole('heading', { name: 'Léa Martin' })).toBeVisible();
  await expect(page.getByText('MUSCLE UP').first()).toBeVisible();
});

test('deep-link direct vers un détail de compétition', async ({ page }) => {
  await page.goto('/competitions/comp-0');
  await expect(page.getByText('FNSL Région').first()).toBeVisible();
});
