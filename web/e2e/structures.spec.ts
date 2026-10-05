import { expect, test } from '@playwright/test';

/** CHANGER DE STRUCTURE — FRE-13.
 *
 *  Le compte du dev-mock est coach ET kiné chez French Forge (sa fiche : Léa),
 *  coach SEULEMENT chez SCAPPULIFT (son athlète : Zoé) — le cas de Nico, pris à
 *  l'envers. La promesse : la structure choisie décide de ce qu'on EST et de ce
 *  qu'on VOIT, et le choix survit au rechargement (c'est lui qui choisit
 *  l'ouverture de la fois suivante).
 *
 *  ⚠️ DEUX STRUCTURES DANS LA MÊME SESSION, ET LES DEUX SONT REGARDÉES. Une spec
 *  qui ne vérifierait que SCAPPULIFT passerait avec une liste jamais bornée. */

/** Le sélecteur de structure : une ligne dans la barre latérale, qui ouvre la
 *  liste des structures (logo, nom, rôles). */
const declencheur = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /Changer de structure|Switch organisation/ });

/** Change de structure par le geste réel : ouvrir la liste, cliquer la carte. */
const allerDans = async (page: import('@playwright/test').Page, nom: RegExp) => {
  await declencheur(page).click();
  await page.getByRole('listbox', { name: /Changer de structure|Switch organisation/ })
    .getByRole('option', { name: nom }).click();
};

/** La structure courante, telle que la ligne l'affiche. */
const courante = (page: import('@playwright/test').Page) => declencheur(page);

/** Les athlètes du panneau de l'en-tête. ⚠️ CADRÉ SUR LA LISTE DU PANNEAU : le
 *  sélecteur de structures porte AUSSI des `option` — une recherche sur la page
 *  entière les aurait ramassées. */
const athletesProposes = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: /Changer d'athlète|Switch athlete/ }).click();
  const noms = await page.locator('#selecteur-athlete-liste').getByRole('option').allInnerTexts();
  await page.keyboard.press('Escape');
  return noms.join(' | ');
};

test('la structure choisie borne les athlètes et les rôles, et survit au rechargement', async ({ page }) => {
  await page.goto('/dashboard');
  // Premier lancement : rien de retenu → la première où il est staff, French Forge.
  await expect(courante(page)).toContainText('French Forge');
  await expect.poll(() => athletesProposes(page)).toMatch(/Léa/);
  expect(await athletesProposes(page)).not.toMatch(/Zoé/);
  // Kiné chez French Forge : l'entrée des modèles de bilan existe.
  await expect(page.getByRole('link', { name: /Modèles de bilan|Assessment templates/ })).toBeVisible();

  await allerDans(page, /SCAPPULIFT/);
  // ⚠️ UNE SEULE ATHLÈTE CHEZ SCAPPULIFT : le sélecteur de l'en-tête ne propose
  // alors rien à choisir — il n'y a pas de panneau à ouvrir. C'est l'athlète
  // AFFICHÉE qui le prouve, et l'absence de Léa.
  await expect(page.getByRole('heading', { level: 2, name: /Zoé/i }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Léa/i })).toHaveCount(0);
  // Pas kiné chez SCAPPULIFT : l'entrée disparaît — le rôle est celui de LÀ.
  await expect(page.getByRole('link', { name: /Modèles de bilan|Assessment templates/ })).toHaveCount(0);

  // Retenu sur l'appareil, sous la clé que lit l'ouverture (`index.html`).
  expect(await page.evaluate(() => localStorage.getItem('hodos.structure'))).toBe('scappulift');
  await page.reload();
  await expect(courante(page)).toContainText('SCAPPULIFT');
});
