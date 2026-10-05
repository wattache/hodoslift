import { expect, test, type Page } from '@playwright/test';

/** FRE-180 — un seul exercice déplié, et les flèches du clavier dans la semaine.
 *
 *  Fixture : la semaine 1 d'Accumulation du dev-mock (la séance ouverte d'office). */

/** Le chevron de la ligne `k` — et seulement lui. ⚠️ `[data-pli] button[aria-expanded]`
 *  tout court attrapait aussi les bascules DANS un pli ouvert : `nth(1)` visait
 *  alors un bouton de la ligne 0, et la spec restait verte avec l'ancienne
 *  bascule — vue VERTE sur la mutation, d'où ce ciblage. */
const chevron = (page: Page, k: number) =>
  page.locator('[data-pli]').nth(k).getByTitle(/Ajouter une note|Voir notes|Add a note/).first();

test('déplier un exercice replie celui qui était ouvert', async ({ page }) => {
  /** MUTATION QUI ROUGIT : la bascule d'avant, qui laissait les autres ouverts. */
  await page.goto('/training');
  await expect(chevron(page, 1)).toBeVisible();

  await chevron(page, 0).click();
  await expect(chevron(page, 0)).toHaveAttribute('aria-expanded', 'true');

  await chevron(page, 1).click();
  await expect(chevron(page, 1)).toHaveAttribute('aria-expanded', 'true');
  await expect(chevron(page, 0)).toHaveAttribute('aria-expanded', 'false');

  // Et le replier le referme, sans en rouvrir un autre.
  await chevron(page, 1).click();
  await expect(chevron(page, 0)).toHaveAttribute('aria-expanded', 'false');
  await expect(chevron(page, 1)).toHaveAttribute('aria-expanded', 'false');
});

test('en mode coach, ↓ passe à la même colonne de la ligne suivante', async ({ page }) => {
  /** MUTATION QUI ROUGIT : la grille de la semaine sans `naviguerAuClavier`. */
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();

  const series = page.getByLabel('Séries');
  await series.nth(0).click();
  await page.keyboard.press('ArrowDown');
  await expect(series.nth(1)).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await expect(series.nth(0)).toBeFocused();
});

test('dans la BASE, les flèches marchent toujours après l’extraction', async ({ page }) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  // Une case de séries d'un principe, puis la case d'en dessous.
  const cases = page.locator('input:not([type=date]):visible');
  await cases.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(cases.first()).not.toBeFocused();
  await expect(page.locator('input:focus, select:focus, button[aria-haspopup]:focus')).toHaveCount(1);
});

test('le coach voit toute la semaine, et cliquer un jour y descend ; l’athlète garde une séance', async ({ page }) => {
  /** MUTATIONS QUI ROUGISSENT : filtrer aussi les séances du coach ; ne pas
   *  défiler au clic dans le bandeau. */
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/training');
  await page.getByRole('button', { name: 'Intensification' }).click();
  await page.getByRole('button', { name: 'Coach', exact: true }).click();

  const endurance = page.locator('[data-seance-id="s2-endurance"]');
  await expect(page.locator('[data-seance-id]')).toHaveCount(2);
  await expect(endurance).not.toBeInViewport();
  await page.getByTitle('Séance 2 — Endurance').click();
  await expect(endurance).toBeInViewport();

  // L'athlète, lui, n'a toujours qu'une séance à l'écran.
  await page.getByRole('button', { name: 'Athlète', exact: true }).click();
  await expect(page.locator('[data-seance-id]')).toHaveCount(1);
});
