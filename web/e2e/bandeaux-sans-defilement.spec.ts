import { devices, expect, test, type Locator, type Page } from '@playwright/test';

/** LES BANDEAUX NE DÉFILENT PLUS SOUS LE DOIGT (retour utilisateur, 12/09).
 *
 *  « Pas pratique sur tel d'avoir pas mal de menus où faut glisser de droite à
 *  gauche » — trois bandeaux nommés : les onglets de l'espace athlète, les blocs
 *  du programme, les séances de la semaine. La réponse commune : NE RIEN CACHER.
 *  Sous 640 px chacun revient à la ligne (colonnes, pastilles enroulées, grille
 *  de trois) au lieu de défiler.
 *
 *  ⚠️ CE QU'ON MESURE, ET POURQUOI PAS SEULEMENT « tout est dans l'écran ». Le
 *  mock porte deux blocs et deux séances : à 390 px ils tiendraient AUSSI dans
 *  l'ancienne rangée qui défile, et une spec qui ne regarderait que les boîtes
 *  serait verte avec ou sans le correctif. Ce qui distingue les deux formes,
 *  c'est que l'ancienne PEUT défiler (`overflow-x: auto`) et la nouvelle ne le
 *  peut pas : c'est ça, la promesse, et c'est ça qu'on lit. Les boîtes sont
 *  vérifiées en plus, pour la partie de la promesse qu'elles portent.
 *
 *  Les macros gardent leur défilement à dessein (un contexte, pas une décision)
 *  et ne sont pas ici.
 */

test.use({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } });

/** Le conteneur direct d'une cellule : peut-il défiler horizontalement ? */
const parentDefile = (cellule: Locator) => cellule.evaluate((el) => {
  const p = el.parentElement!;
  return ['auto', 'scroll'].includes(getComputedStyle(p).overflowX);
});

const dansLEcran = async (cellule: Locator) => {
  await expect(cellule).toBeVisible();
  const b = (await cellule.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(390);
  return b;
};

const rienNeDeborde = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('les onglets de l’espace athlète tiennent tous, en colonnes, sans défiler', async ({ page }) => {
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'Navigation' });
  const onglets = nav.getByRole('link');
  // Cinq avec le suivi kiné (le mock l'a), quatre sans : jamais un de caché.
  await expect(onglets).toHaveCount(5);
  for (const o of await onglets.all()) await dansLEcran(o);
  expect(await parentDefile(onglets.first())).toBe(false);
  expect(await rienNeDeborde(page)).toBe(0);
});

test('les blocs du programme s’enroulent en pastilles, à 44 px, sans défiler', async ({ page }) => {
  /** ⚠️ ÇA A ÉTÉ UNE GRILLE DE DEUX, ET LA MAQUETTE 1b L'A RETIRÉE (13/09). Chaque
   *  bloc y prenait la moitié de la largeur : l'aplat du bloc courant devenait
   *  l'élément le plus fort de l'écran — de la navigation — et trois blocs
   *  faisaient un escalier avec une cellule vide. La promesse du 12/09 ne
   *  change pas : rien ne défile, rien n'est caché, 44 px au doigt. La forme,
   *  si : des pastilles à la largeur de leur nom, qui passent à la ligne. */
  await page.goto('/training');
  const accumulation = page.getByRole('button', { name: 'Accumulation' });
  const intensification = page.getByRole('button', { name: 'Intensification' });
  const a = await dansLEcran(accumulation);
  const b = await dansLEcran(intensification);
  // Côte à côte sur la même rangée, chacun à la largeur de son nom.
  expect(Math.round(a.y)).toBe(Math.round(b.y));
  expect(a.height).toBeGreaterThanOrEqual(44);
  expect(a.width).toBeLessThan(170);
  expect(await parentDefile(accumulation)).toBe(false);
  expect(await accumulation.evaluate(el => getComputedStyle(el.parentElement!).flexWrap)).toBe('wrap');
  expect(await rienNeDeborde(page)).toBe(0);
});

test('les séances de la semaine passent en grille de trois, sans défiler', async ({ page }) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: /Semaine 1/ }).first().click();
  const haut = page.getByRole('button', { name: /Haut du corps/ }).first();
  const squat = page.getByRole('button', { name: /Séance 2 — Squat/ }).first();
  const a = await dansLEcran(haut);
  const b = await dansLEcran(squat);
  // Deux cellules sur trois colonnes : même rangée, même largeur — la troisième
  // colonne reste vide plutôt que d'étirer l'une des deux.
  expect(Math.round(a.y)).toBe(Math.round(b.y));
  expect(Math.round(a.width)).toBe(Math.round(b.width));
  expect(await parentDefile(haut)).toBe(false);
  expect(await rienNeDeborde(page)).toBe(0);
});
