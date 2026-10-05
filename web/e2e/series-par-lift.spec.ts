import { expect, test, type Page } from '@playwright/test';

/** LES SÉRIES PAR SEMAINE, SUR LES LIFTS DE COMPÉTITION (FRE-148).
 *
 *  ⚠️ LA QUESTION INVERSE DU GRAPHE AU-DESSUS. Celui-ci creuse UN mouvement sur
 *  toutes ses métriques ; ce tableau compare TOUS les lifts sur une seule —
 *  « combien de séries de squat cette semaine, contre le muscle up ? »
 *
 *  ⚠️ ET C'EST LE COUPLE FAIT/PRESCRIT QUI PORTE TOUT. `setsDone` compte les
 *  séries TENUES (FRE-110) : seul, un zéro ne dit pas s'il n'y avait rien au
 *  programme ou si l'athlète n'est pas venu. Ces specs visent les trois
 *  lectures, parce que c'est leur distinction qui EST la fonctionnalité.
 */

const tableau = (page: Page) =>
  page.locator('section').filter({ hasText: /Séries par semaine|Sets per week/ });

const ouvrirLeTracker = async (page: Page) => {
  await page.goto('/tracker');
  // Un sous-onglet du Tracker depuis le 17/09 : « Charge & RPE » s'ouvre d'office.
  await page.getByRole('tab', { name: /Séries par semaine|Sets per week/ }).click();
  await expect(tableau(page).getByRole('table')).toBeVisible({ timeout: 15_000 });
};

/** La cellule d'un mouvement sur la semaine de rang `rang` (0 = la plus récente,
 *  qui est en HAUT — c'est celle qu'on vient voir). */
const cellule = (page: Page, rang: number, colonne: number) =>
  tableau(page).locator('tbody tr').nth(rang).locator('td').nth(colonne);

// Ordre canonique, constaté avant de compter dessus : les colonnes suivent
// PRINCIPAL_MOVEMENTS, filtré aux lifts que l'athlète a réellement travaillés.
const COLONNES = ['Semaine', 'MU', 'PU', 'SQ', 'BP', 'DL'];
const SQUAT = COLONNES.indexOf('SQ');
const BENCH = COLONNES.indexOf('BP');
const PULL_UP = COLONNES.indexOf('PU');

test('les colonnes sont les lifts travaillés, dans l’ordre canonique', async ({ page }) => {
  await ouvrirLeTracker(page);
  await expect(tableau(page).locator('thead th')).toHaveText(COLONNES);
});

test('une série tenue ne montre QU’UN chiffre', async ({ page }) => {
  await ouvrirLeTracker(page);

  // ⚠️ PAS DE « 7/7 ». Répéter le prescrit quand il est atteint remplirait la
  // table de bruit : l'écart est l'information, l'égalité est le cas normal.
  await expect(cellule(page, 0, SQUAT)).toHaveText('7');
});

test('une série calée se lit dans l’ÉCART, pas dans un chiffre plus petit', async ({ page }) => {
  await ouvrirLeTracker(page);

  // Semaine 1 (rang 0) : 8 tractions tenues sur 11 prescrites.
  await expect(cellule(page, 0, PULL_UP)).toHaveText('8/11');
});

test('un mouvement PRÉVU et jamais fait le DIT — il ne disparaît pas', async ({ page }) => {
  await ouvrirLeTracker(page);

  // ⚠️ LA SPEC QUI PORTE LE SUJET. Semaine 3 (rang 2) : le développé couché
  // était au programme, l'athlète n'est pas venu. Sans le prescrit en face, la
  // cellule afficherait « 0 » — indiscernable d'une semaine où le mouvement
  // n'était pas programmé. C'est aussi ce qui a rendu inutile une pastille
  // « aucune séance » : séance ou pas, ça fait des séries en moins, et l'écart
  // le dit déjà.
  await expect(cellule(page, 2, BENCH)).toHaveText('0/3');
});

test('rien au programme n’affiche RIEN, surtout pas un zéro', async ({ page }) => {
  await ouvrirLeTracker(page);

  // ⚠️ UN « 0 » ICI SE LIRAIT COMME UN MANQUEMENT. Semaine 4 (rang 3), le
  // muscle up n'était pas prévu : il n'a pas été raté, il n'a pas été demandé.
  // C'est la distinction vide/NULL du projet, portée jusqu'à la cellule.
  await expect(cellule(page, 3, COLONNES.indexOf('MU'))).toHaveText('—');
});
