import { expect, test, type Page } from '@playwright/test';

/** LA PROGRESSION SUR LE BLOC, AU CHOIX DE CHACUN (brief progression, 27/09).
 *
 *  UNE préférence par personne, vue partout — le pli de l'athlète, le dépli du
 *  coach, la BASE. Sur le dev-mock, brokkr n'écrit rien : c'est le repli `localStorage` qui
 *  porte la préférence d'un rechargement à l'autre. La persistance serveur se
 *  prouve dans le harnais réel (`e2e-reel/preference-progression.spec.ts`). */

const ouvrirLePli = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Athlète', exact: true }).click();
  await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
  await page.getByRole('button', { name: /Semaine 2/ }).click();
  await page.getByTitle(/Voir notes|Ajouter une note/).first().click();
  await expect(page.locator('[data-rendu]').first()).toBeVisible();
};
const rendu = (page: Page) => page.locator('[data-rendu]').first();
const choisirSurLaCarte = (page: Page, nom: string) =>
  page.getByRole('group', { name: 'Affichage' }).first().getByRole('button', { name: nom }).click();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.removeItem('eitri-progression'); });
});

test('le sélecteur de la carte change le dessin sans recharger, et le choix survit au rechargement', async ({ page }) => {
  await ouvrirLePli(page);
  await expect(rendu(page)).toHaveAttribute('data-rendu', 'courbe');

  await choisirSurLaCarte(page, 'Chiffres');
  await expect(rendu(page)).toHaveAttribute('data-rendu', 'chiffres');
  // Les quatre valeurs y sont, l'écart compris.
  await expect(rendu(page).locator('[data-ecart]').first()).toBeVisible();
  await expect(rendu(page).locator('[data-valeur-volume]').first()).toBeVisible();
  await expect(rendu(page).locator('[data-valeur-rpe]').first()).toBeVisible();

  await page.reload();
  await ouvrirLePli(page);
  await expect(rendu(page)).toHaveAttribute('data-rendu', 'chiffres');
});

test('le même rendu partout : choisi dans le pli de l’athlète, il est là dans le dépli du coach', async ({ page }) => {
  await ouvrirLePli(page);
  await choisirSurLaCarte(page, 'Chiffres');
  await expect(rendu(page)).toHaveAttribute('data-rendu', 'chiffres');

  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  const ligne = page.locator('[data-seance-id]').first().locator('[data-ligne="1"]');
  await ligne.getByRole('button', { name: /^Déplier la ligne/ }).click();
  await expect(rendu(page)).toHaveAttribute('data-rendu', 'chiffres');
});

test('le réglage tient dans le profil : des vignettes, un aperçu, et le choix s’applique', async ({ page }) => {
  await page.goto('/profil');
  await expect(page.getByRole('radio', { name: 'Courbe' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-apercu] [data-rendu]')).toHaveAttribute('data-rendu', 'courbe');

  await page.getByRole('radio', { name: 'Chiffres' }).click();
  await expect(page.getByRole('radio', { name: 'Chiffres' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-apercu] [data-rendu]')).toHaveAttribute('data-rendu', 'chiffres');
  // Et l'écran DIT que c'est enregistré.
  await expect(page.locator('[data-enregistrement]')).toHaveAttribute('data-enregistrement', 'enregistre');

  // Et la carte du pli dessine ce qui vient d'être choisi.
  await ouvrirLePli(page);
  await expect(rendu(page)).toHaveAttribute('data-rendu', 'chiffres');
});

test('la BASE aussi : l’historique d’un mouvement dessine le rendu choisi, et son sélecteur écrit la même préférence', async ({ page }) => {
  // Le bloc Intensification a MUSCLE UP dans sa trame, et le bloc Accumulation
  // l'a fait : l'historique existe. Repliés par défaut, on ouvre le bloc.
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Intensification', exact: true }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  const historique = page.getByRole('button', { name: /^Bloc 1/ }).first();
  await historique.click();
  await expect(historique).toHaveAttribute('aria-expanded', 'true');
  await expect(rendu(page)).toHaveAttribute('data-rendu', 'courbe');

  await choisirSurLaCarte(page, 'Chiffres');
  await expect(rendu(page)).toHaveAttribute('data-rendu', 'chiffres');
  await expect(rendu(page).locator('[data-ecart]').first()).toBeVisible();

  // Même préférence partout : le pli de l'athlète a suivi.
  await ouvrirLePli(page);
  await expect(rendu(page)).toHaveAttribute('data-rendu', 'chiffres');
});
