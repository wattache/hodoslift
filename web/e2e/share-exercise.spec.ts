import { expect, test, type Page } from '@playwright/test';

/** Partage de la PROGRESSION d'un exercice sur le bloc (FRE-21).
 *
 *  L'image n'a de sens qu'à partir de deux semaines chargées : en dessous, il
 *  n'y a pas de progression à montrer et le bouton ne doit pas exister. */

async function openFirstExercise(page: Page) {
  await page.getByRole('button', { name: 'Détail' }).click();
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran, et la replier ne laissait qu'un en-tête au-dessus du vide. Le clic
  // n'a plus de cible : l'en-tête est redevenu un simple titre.
  await page.getByTitle(/Voir notes|Ajouter une note/).first().click();
}

test('génère l’image de progression d’un exercice', async ({ page }) => {
  await page.goto('/training');
  // Le bloc Accumulation porte plusieurs semaines — donc une progression.
  await page.getByRole('button', { name: /Accumulation/ }).first().click();
  await page.getByRole('button', { name: /Semaine/ }).first().click();
  await openFirstExercise(page);

  await page.getByTitle('Partager la progression').first().click();

  const img = page.getByRole('dialog').locator('img');
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('src', /^blob:/);

  const size = await img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }));
  expect(size.w).toBe(1080);
  expect(size.h).toBe(1350); // même 4:5 que l'image de séance
});

test('aucun partage de progression sur un bloc d’une seule semaine', async ({ page }) => {
  await page.goto('/training');
  await openFirstExercise(page);

  // Un seul point : le bouton promettrait une courbe qui n'existe pas.
  await expect(page.getByTitle('Partager la progression')).toHaveCount(0);
  // Celui de la séance, lui, reste disponible.
  await expect(page.getByTitle('Partager la séance').first()).toBeVisible();
});
