import { expect, test } from '@playwright/test';

/** UNE COURBE PAR COMBINAISON (FRE-182) — le Tracker, onglet « Charge & RPE ».
 *
 *  Le calcul (regrouper par variante triée, tempo, format ; la charge max de
 *  chaque combinaison) est gardé côté brokkr (`tests/test_tracking.py`). Ici :
 *  que l'écran allume les bonnes courbes, et que l'infobulle les lise.
 *
 *  Fixture : MUSCLE UP du mock — COMP (60 séries), sans variante (40), RINGS ·
 *  310 (20), NO DIPS · EMOM (8). */

test('les trois combinaisons les plus travaillées s’allument, la quatrième attend', async ({ page }) => {
  /** MUTATION QUI ROUGIT : `COURBES_PAR_DEFAUT` à 4. */
  await page.goto('/tracker');
  const pastilles = page.getByLabel(/Combinaisons du mouvement|Movement combinations/).getByRole('button');
  await expect(pastilles).toHaveCount(4);
  await expect(page.locator('[data-courbe]')).toHaveCount(3);
  await expect(pastilles.nth(3)).toHaveAttribute('aria-pressed', 'false');

  await pastilles.nth(3).click();
  await expect(page.locator('[data-courbe]')).toHaveCount(4);
  await pastilles.nth(0).click();
  await expect(page.locator('[data-courbe]')).toHaveCount(3);
});

test('l’infobulle donne la charge de CHAQUE courbe allumée', async ({ page }) => {
  /** MUTATION QUI ROUGIT : l'infobulle qui ignore `courbes`. */
  await page.goto('/tracker');
  const graphe = page.locator('svg.h-80').first();
  await graphe.scrollIntoViewIfNeeded();
  const boite = (await graphe.boundingBox())!;
  // Une semaine vers la fin, où COMP est présente.
  await page.mouse.move(boite.x + boite.width * 0.9, boite.y + boite.height / 2);
  const infobulle = page.getByRole('tooltip');
  await expect(infobulle).toBeVisible();
  await expect(infobulle.getByText('COMP', { exact: true })).toBeVisible();
});
