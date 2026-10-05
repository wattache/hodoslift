import { expect, test } from '@playwright/test';

/** Partage de séance : le dialog s'ouvre et l'image se génère réellement
 *  (canvas → blob → <img>), au format 4:5 attendu par Instagram. */

test('génère une image de séance partageable', async ({ page }) => {
  await page.goto('/training');

  // ⚠️ LE PARTAGE NE VIT PLUS SUR CHAQUE LIGNE DE JOUR (refonte des écrans, 09/2026). Sept boutons
  // permanents pour un geste qu'on fait une fois par séance, c'était du bruit
  // sur la rangée la plus dense de l'écran : il n'apparaît que sur le jour
  // OUVERT. La spec ouvre donc une séance avant de le chercher — ce que fait
  // quiconque partage la sienne.
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran, et la replier ne laissait qu'un en-tête au-dessus du vide. Le clic
  // n'a plus de cible : l'en-tête est redevenu un simple titre.

  await page.getByRole('button', { name: /Partager la séance|Share session/ }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // L'aperçu n'apparaît que si le canvas a produit un blob exploitable.
  const preview = dialog.locator('img');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', /^blob:/);

  // Une image réellement décodée a des dimensions naturelles non nulles :
  // c'est ce qui distingue un rendu valide d'un blob vide.
  const dimensions = await preview.evaluate((img: HTMLImageElement) => ({
    w: img.naturalWidth,
    h: img.naturalHeight,
  }));
  expect(dimensions.w).toBe(1080);
  expect(dimensions.h).toBe(1350); // 4:5, format unique
});
