import { expect, test, type Page } from '@playwright/test';

/** SIGNALER UNE GÊNE DEPUIS LA LIGNE DE SÉANCE — sur le dev-mock.
 *
 *  Ce que le mock prouve : le bouton sur la ligne, le volet qui nomme la ligne
 *  et le jour, la figure qui rouvre la douleur déjà suivie, et la puce de ce qui
 *  a déjà été signalé ici. Ce qu'il ne prouve PAS : l'écriture jusqu'à
 *  Postgres — c'est `test_douleurs.py` qui la tient. */

async function ouvrirLaSeance(page: Page) {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Détail' }).click();
  await page.getByTitle(/Voir notes|Ajouter une note/).first().click();
}

test('la gêne déjà signalée sur cette ligne se lit en puce, et mène aux douleurs', async ({ page }) => {
  await ouvrirLaSeance(page);
  const puce = page.locator('[data-gene-notee]').first();
  await expect(puce).toContainText('Mon épaule');
  await expect(puce).toContainText('3/10');
  await expect(puce).toHaveAttribute('href', '/kine?vue=douleurs');
});

test('le volet nomme la ligne et le jour, et toucher la zone déjà suivie rouvre SA note', async ({ page }) => {
  await ouvrirLaSeance(page);
  await page.locator('[data-signaler-gene]').first().click();

  const volet = page.getByRole('dialog');
  await expect(volet.getByText(/MUSCLE UP Strict · 4×2 @ 9 kg/)).toBeVisible();

  await volet.locator('svg[role="group"]').first()
    .getByRole('button', { name: /Deltoïde antérieur droite|Anterior deltoid right/ }).click();
  // La MÊME liste que dans l'onglet : « Mon épaule » proposée d'abord.
  await expect(volet.getByRole('heading', { name: /À quelle douleur|Which pain/ })).toBeVisible();
  await expect(volet.getByRole('radio', { name: /Mon épaule/ })).toHaveAttribute('aria-checked', 'true');
  // ⚠️ « ENTRAÎNÉ ? » N'EST PAS DEMANDÉ : la ligne y répond. Le sélecteur ne
  // montre donc ni Entraînement ni Repos, et le volet le dit.
  await expect(volet.getByText(/jour entraîné|training day/)).toBeVisible();
  await expect(volet.getByRole('button', { name: /^(Repos|Rest)$/ })).toHaveCount(0);
  // Onze intensités, zéro compris — le même sélecteur que l'onglet Douleurs.
  await expect(volet.getByRole('group', { name: /Intensité|Intensity/ }).getByRole('button')).toHaveCount(11);
});

test('toucher une zone libre ouvre la déclaration, « Suivre » attend un nom', async ({ page }) => {
  await ouvrirLaSeance(page);
  await page.locator('[data-signaler-gene]').first().click();
  const volet = page.getByRole('dialog');
  await volet.locator('svg[role="group"]').first()
    .getByRole('button', { name: /^(Pectoraux droite|Chest right)$/ }).click();
  await expect(volet.getByRole('heading', { name: /Nouvelle douleur|New pain/ })).toBeVisible();
  await expect(volet.getByRole('button', { name: /Suivre cette douleur|Track this pain/ })).toBeDisabled();
});

test('toucher une zone suivie propose SA douleur, ou une nouvelle', async ({ page }) => {
  await ouvrirLaSeance(page);
  await page.locator('[data-signaler-gene]').first().click();
  const volet = page.getByRole('dialog');
  await volet.locator('svg[role="group"]').first()
    .getByRole('button', { name: /Deltoïde antérieur droite|Anterior deltoid right/ }).click();
  await expect(volet.getByRole('radio', { name: /Mon épaule/ })).toHaveAttribute('aria-checked', 'true');
  await volet.getByRole('radio', { name: /nouvelle douleur|new pain/i }).click();
  await expect(volet.getByLabel(/appeler cette douleur|call this/i)).toBeVisible();
  await expect(volet.getByRole('button', { name: /Suivre cette douleur|Track this pain/ })).toBeDisabled();
});
