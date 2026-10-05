import { expect, test } from '@playwright/test';

/** Un écran dont le fichier a disparu : après une livraison, l'app restée
 *  ouverte réclame un fichier du build précédent.
 *
 *  Le dev-mock sert chaque vue sous `/src/views/…` : couper cette requête
 *  reproduit l'import qui échoue, par le vrai routeur. */

test('un écran introuvable recharge l\'app une fois, puis montre notre écran d\'erreur', async ({ page }) => {
  await page.route('**/src/views/competitions.tsx*', r => r.abort());
  let chargements = 0;
  page.on('load', () => { chargements++; });

  await page.goto('/competitions');

  // Le fichier manque encore après le rechargement : ce n'est plus une version
  // périmée, et l'app s'arrête sur son écran au lieu de boucler.
  await expect(page.getByRole('heading', { name: 'Une erreur est survenue' })).toBeVisible();
  await expect(page.getByText('Hey developer')).toHaveCount(0);
  expect(chargements).toBe(2);
});
