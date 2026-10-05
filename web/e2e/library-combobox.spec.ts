import { expect, test, type Page } from '@playwright/test';

/** Liste FERMÉE adossée à la bibliothèque (remplace `<input list>` + `<datalist>`).
 *
 *  Le bug d'origine : le navigateur filtrait nativement les options du
 *  `datalist` selon la saisie, donc taper une valeur inconnue vidait le
 *  dépliement au lieu de montrer le catalogue. Ces tests verrouillent le
 *  comportement inverse. */

const search = (page: Page) => page.getByPlaceholder('Rechercher…');
const option = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Ouvre le combobox Tempo du 1er exercice éditable.
 *  La valeur de départ n'est pas supposée : la vue s'ouvre sur la semaine
 *  courante, dont les tempos peuvent être vides. */
async function openTempo(page: Page) {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  // Le tempo vit dans le dépli de la ligne (brief coach, 27/09).
  const trigger = page.getByRole('button', { name: 'Tempo', exact: true }).first();
  await trigger.click();
  return trigger;
}

/** Ouvre le combobox avec une valeur déjà posée — l'état où le `datalist`
 *  masquait le reste du catalogue. */
async function openTempoWithValue(page: Page, value: string) {
  const trigger = await openTempo(page);
  await option(page, value).click();
  await expect(trigger).toHaveText(value);
  await trigger.click();
  return trigger;
}

test('une valeur posée ne masque pas le reste du catalogue', async ({ page }) => {
  await openTempoWithValue(page, '30X0');

  // Le cœur de la régression corrigée.
  await expect(option(page, '30X0')).toBeVisible();
  await expect(option(page, '3-0-1-0')).toBeVisible();
});

test('la recherche filtre, et l’effacer restaure la liste complète', async ({ page }) => {
  await openTempo(page);

  await search(page).fill('3-0');
  await expect(option(page, '3-0-1-0')).toBeVisible();
  await expect(option(page, '30X0')).toBeHidden();

  await search(page).fill('');
  await expect(option(page, '30X0')).toBeVisible();
  await expect(option(page, '3-0-1-0')).toBeVisible();
});

test('sélectionner une entrée la valide', async ({ page }) => {
  const trigger = await openTempo(page);

  await option(page, '3-0-1-0').click();

  await expect(search(page)).toBeHidden();
  await expect(trigger).toHaveText('3-0-1-0');
});

test('une valeur hors bibliothèque ne peut pas être saisie librement', async ({ page }) => {
  const trigger = await openTempoWithValue(page, '30X0');

  // « 0031 » est exactement le cas signalé : absent du catalogue.
  await search(page).fill('0031');
  await expect(option(page, '30X0')).toBeHidden();

  // Abandonner la recherche ne doit RIEN écrire : ce qu'on tape dans le champ
  // de recherche n'est pas la valeur du champ.
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveText('30X0');
});

test('une valeur absente n’offre aucune porte de sortie, et renvoie à la Bibliothèque', async ({ page }) => {
  await openTempo(page);

  await search(page).fill('0031');

  // Décision produit : pas de création à la volée. Le catalogue se décide au
  // même endroit pour tout le monde. Le popover ne propose donc AUCUNE action.
  const popover = page.getByRole('dialog');
  await expect(popover.getByRole('button')).toHaveCount(0);
  await expect(popover.getByText(/Ajoute cette entrée depuis la Bibliothèque/)).toBeVisible();
});

test('la ligne « Aucun » vide la valeur, et disparaît dès qu’on recherche', async ({ page }) => {
  const trigger = await openTempoWithValue(page, '30X0');

  await search(page).fill('30');
  // Sinon Entrée effacerait la valeur au lieu de prendre le 1er résultat.
  await expect(page.getByRole('button', { name: '— Aucun' })).toBeHidden();

  await search(page).fill('');
  await page.getByRole('button', { name: '— Aucun' }).click();
  await expect(trigger).toHaveText('—');
});
