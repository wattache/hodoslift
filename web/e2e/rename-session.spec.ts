import { expect, test } from '@playwright/test';

/** Renommage EN LIGNE d'une séance (remplace l'ancien window.prompt natif).
 *  Couvre les trois sorties : Entrée, bouton ✓, et Échap (annulation). */

async function openRenameEditor(page: import('@playwright/test').Page) {
  await page.goto('/training');
  // Le renommage est une action coach.
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  const card = page.locator('div').filter({ hasText: /^Séance 1/ }).first();
  await page.getByTitle('Renommer la séance').first().click();
  return card;
}

test('Entrée valide le nouveau nom', async ({ page }) => {
  await openRenameEditor(page);
  const input = page.getByPlaceholder('Renommer la séance');
  await expect(input).toBeVisible();

  await input.fill('Séance 1 — Tirage lourd');
  await input.press('Enter');

  await expect(input).toBeHidden();
  await expect(page.getByText('Séance 1 — Tirage lourd').first()).toBeVisible();
});

test('Échap annule sans renommer', async ({ page }) => {
  await openRenameEditor(page);
  const input = page.getByPlaceholder('Renommer la séance');

  await input.fill('Nom jamais validé');
  await input.press('Escape');

  await expect(input).toBeHidden();
  await expect(page.getByText('Nom jamais validé')).toHaveCount(0);
  await expect(page.getByText(/Séance 1/).first()).toBeVisible();
});
