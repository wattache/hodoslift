import { expect, test, type Page } from '@playwright/test';

/** LE TABLEAU DU COACH, GRAND ÉCRAN (brief coach, 27/09) : colonnes
 *  essentielles, le verrou À CÔTÉ de la charge, un dépli par ligne, et le réel
 *  en lecture. */

const ouvrirLaSeance = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
  await page.getByRole('button', { name: /Semaine 1/ }).click();
  await expect(ligne(page, 1)).toBeVisible();
};
const seance = (page: Page) => page.locator('[data-seance-id]').first();
const ligne = (page: Page, i: number) => seance(page).locator(`[data-ligne="${i}"]`);

test('⚠️ la charge reste lisible : le verrou est à côté du champ, jamais dessus', async ({ page }) => {
  /** Le bug remonté par un coach : le cadenas était posé PAR-DESSUS le champ, il
   *  restait une quarantaine de pixels, et « 232.5 » devenait « 232 » puis « 16. ». */
  await ouvrirLaSeance(page);
  const charge = ligne(page, 1).getByRole('textbox', { name: 'Charge' });
  await charge.fill('232.5');
  await charge.blur();
  await expect(charge).toHaveValue('232.5');

  // Le texte tient dans le champ : rien n'est coupé.
  expect(await charge.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth)).toBe(true);

  // Et le verrou ne recouvre pas le champ d'un seul pixel.
  const verrou = ligne(page, 1).getByRole('button', { name: /Charge (verrouillée|libre)/ });
  const [c, v] = await Promise.all([charge.boundingBox(), verrou.boundingBox()]);
  expect(c && v && (v.x >= c.x + c.width || v.x + v.width <= c.x)).toBe(true);
});

test('le verrou dit son état dans son nom, et bascule sans toucher à la valeur', async ({ page }) => {
  await ouvrirLaSeance(page);
  const charge = ligne(page, 1).getByRole('textbox', { name: 'Charge' });
  const avant = await charge.inputValue();
  const verrou = ligne(page, 1).getByRole('button', { name: /Charge (verrouillée|libre)/ });
  const etat = await verrou.getAttribute('aria-pressed');
  await verrou.click();
  await expect(verrou).toHaveAttribute('aria-pressed', etat === 'true' ? 'false' : 'true');
  // Le nom accessible suit l'état : l'infobulle seule n'est pas lue sur un bouton.
  await expect(verrou).toHaveAccessibleName(etat === 'true' ? /Charge libre/ : /Charge verrouillée/);
  await expect(charge).toHaveValue(avant);
});

test('toute la prescription tient sur la ligne : variantes, format, tempo, repos, assistance', async ({ page }) => {
  /** William, 30/09 : une ligne par exercice, comme avant la refonte — ouvrir
   *  chaque ligne pour écrire une séance handicapait. MUTATION QUI ROUGIT :
   *  remettre format, tempo ou repos dans le dépli. */
  await ouvrirLaSeance(page);
  const lignes = await seance(page).locator('[data-ligne]').count();
  expect(lignes).toBeGreaterThan(1);
  // Sans rien déplier : chaque rangée porte ses champs.
  await expect(seance(page).locator('[aria-expanded="true"]')).toHaveCount(0);
  await expect(seance(page).locator('[data-rangee]').getByRole('combobox', { name: 'Format' })).toHaveCount(lignes);
  const rangee = ligne(page, 1).locator('[data-rangee]');
  await expect(rangee.getByRole('button', { name: 'Tempo' })).toBeVisible();
  await expect(rangee.getByRole('textbox', { name: 'Repos' })).toBeVisible();
  await expect(rangee.getByRole('button', { name: 'Assistance' })).toBeVisible();
  await expect(rangee.getByRole('button', { name: 'Variantes' })).toBeVisible();
  // Et tient dans la largeur : rien ne se chevauche, la grille ne déborde pas de sa séance.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('le dépli est l’exception : replié d’office, il porte la note, la nature et la progression', async ({ page }) => {
  await ouvrirLaSeance(page);
  await expect(seance(page).getByRole('textbox', { name: 'Note coach' })).toHaveCount(0);

  const chevron = ligne(page, 1).getByRole('button', { name: /^Déplier la ligne/ });
  await chevron.click();
  await expect(chevron).toHaveAttribute('aria-expanded', 'true');
  await expect(ligne(page, 1).getByRole('textbox', { name: 'Note coach' })).toBeVisible();
  await expect(ligne(page, 1).getByRole('combobox', { name: 'Nature' })).toBeVisible();
  await expect(ligne(page, 1).locator('[data-rendu]')).toBeVisible();
  // La prescription n'y est pas répétée : un seul Format sur la ligne.
  await expect(ligne(page, 1).getByRole('combobox', { name: 'Format' })).toHaveCount(1);

  // Deux lignes peuvent rester ouvertes ; le chevron referme la sienne.
  await ligne(page, 2).getByRole('button', { name: /^Déplier la ligne/ }).click();
  await expect(seance(page).getByRole('textbox', { name: 'Note coach' })).toHaveCount(2);
  await chevron.click();
  await expect(seance(page).getByRole('textbox', { name: 'Note coach' })).toHaveCount(1);
});

test('« Tout déplier » ouvre le reste de chaque ligne d’un geste, « Tout replier » le referme', async ({ page }) => {
  await ouvrirLaSeance(page);
  const lignes = await seance(page).locator('[data-ligne]').count();
  await seance(page).getByRole('button', { name: 'Tout déplier' }).click();
  await expect(seance(page).getByRole('textbox', { name: 'Note coach' })).toHaveCount(lignes);
  await seance(page).getByRole('button', { name: 'Tout replier' }).click();
  await expect(seance(page).getByRole('textbox', { name: 'Note coach' })).toHaveCount(0);
});

test('le réel ne se saisit pas dans le tableau du coach : on y programme', async ({ page }) => {
  /** William, 30/09 : « quand on programme, on n'a pas besoin du réel ». Le RPE
   *  réel se LIT (spec suivante), il ne s'écrit pas ici. */
  await ouvrirLaSeance(page);
  await expect(seance(page).getByRole('combobox', { name: 'RPE réel' })).toHaveCount(0);
  await expect(seance(page).locator('[data-rangee]').getByText(/RPE ressenti|pas encore fait/)).toHaveCount(0);
});

test('le RPE réel de l’athlète se lit dans la rangée, à côté de la cible — sans déplier', async ({ page }) => {
  /** William, 05/10 : « on veut le voir sans déplier, c'est une semaine coach ».
   *  La colonne Réel sortie en 1.0.6 emportait le seul endroit où le coach le
   *  voyait : quatre lignes sur cinq n'ont pas de détail par série (mesuré en
   *  prod, 4 355 sur 5 424 sur quatre semaines).
   *
   *  MUTATION QUI ROUGIT : retirer le `data-rpe-reel` de la rangée. */
  await ouvrirLaSeance(page);
  const rangees = seance(page).locator('[data-rangee]');
  // Muscle up (cible 8, réel 8) et pull up (cible 7,5, réel 7) l'ont noté ; le rowing non.
  await expect(rangees.locator('[data-rpe-reel]')).toHaveText(['→8', '→7']);
  await expect(rangees.nth(0).locator('[data-rpe-reel]')).toHaveText('→8');
  await expect(rangees.nth(2).locator('[data-rpe-reel]')).toHaveCount(0);
  // Replié : aucune ligne n'est ouverte, et le réel est là quand même.
  await expect(rangees.getByRole('button', { name: /^Déplier la ligne/, expanded: true })).toHaveCount(0);
  await expect(rangees.nth(0).locator('[data-rpe-reel]')).toHaveAttribute('title', 'RPE réel noté par l’athlète');
});
