import { expect, test } from '@playwright/test';

/** LE TITRE DE L'EN-TÊTE — chaque page dit son nom, et aucune ne dit « French
 *  Forge » à quelqu'un d'une autre structure. Suivi kiné et Profil n'étaient pas
 *  dans la table des titres : ils tombaient sur un repli écrit en dur.
 *  MUTATION QUI ROUGIT : retirer `/kine` de la table — le repli reprend. */

for (const [chemin, titre] of [['/kine', 'Suivi kiné'], ['/profil', 'Profil']] as const) {
  test(`${chemin} porte son titre`, async ({ page }) => {
    await page.goto(chemin);
    await page.keyboard.press('Shift');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(titre);
  });
}
