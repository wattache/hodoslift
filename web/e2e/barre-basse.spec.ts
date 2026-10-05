import { expect, test } from '@playwright/test';

/** LA BARRE BASSE AU TÉLÉPHONE (Passe 3, constat 01 · 14/09).
 *
 *  Les onglets de l'espace athlète défilaient avec la page : en bas d'une séance,
 *  il fallait remonter tout l'écran pour aller au suivi. Ce que ces specs gardent :
 *
 *    1. en bas de page, les destinations sont À L'ÉCRAN, collées au bas ;
 *    2. le bandeau du chrono se pose AU-DESSUS de la barre, il ne la couvre pas ;
 *    3. sur grand écran, rien ne change : les onglets restent en haut, une fois.
 *
 *  MUTATIONS QUI ROUGISSENT : garder la nav d'en haut au téléphone (elle sort de
 *  l'écran au défilement) ; `bottom-0` pour le bandeau (il couvre la barre).
 */

test.describe('au téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('en bas de séance, le suivi est sous le pouce', async ({ page }) => {
    await page.goto('/training');
    const nav = page.getByRole('navigation', { name: 'Navigation' });
    await expect(nav).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const b = (await nav.boundingBox())!;
    expect(b.y).toBeGreaterThan(0);
    expect(Math.round(b.y + b.height)).toBe(844);

    await nav.getByRole('link', { name: 'Tracker' }).click();
    await expect(page).toHaveURL(/\/tracker$/);
  });

  test('le bandeau du chrono se pose au-dessus de la barre', async ({ page }) => {
    await page.goto('/training');
    await page.getByRole('button', { name: 'Lancer le chrono' }).click();
    const bandeau = (await page.getByRole('timer').boundingBox())!;
    const barre = (await page.getByRole('navigation', { name: 'Navigation' }).boundingBox())!;
    expect(bandeau.y + bandeau.height).toBeLessThanOrEqual(barre.y + 1);
  });
});

test('sur grand écran, les onglets restent en haut, une seule fois', async ({ page }) => {
  await page.goto('/training');
  const nav = page.getByRole('navigation', { name: 'Navigation' });
  await expect(nav).toHaveCount(1);
  expect(await nav.evaluate(el => getComputedStyle(el).position)).not.toBe('fixed');
});
