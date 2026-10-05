import { devices, expect, test, type Page } from '@playwright/test';

/** LES CARTES DU COACH, TÉLÉPHONE (brief coach, 27/09) : la saisie complète
 *  au doigt — tuiles, stepper, « Champ suivant » — sans ouvrir le clavier. */

test.use({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } });

const ouvrirLaSeance = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
  await page.getByRole('button', { name: /Semaine 1/ }).click();
  await expect(carte(page, 1)).toBeVisible();
};
const seance = (page: Page) => page.locator('[data-seance-id]').first();
const carte = (page: Page, i: number) => seance(page).locator(`article[data-ligne="${i}"]`);

test('toucher la charge ouvre l’éditeur ; « Champ suivant » parcourt séries → reps → charge → RPE', async ({ page }) => {
  await ouvrirLaSeance(page);
  await carte(page, 1).getByRole('button', { name: /Charge kg/ }).click();

  const champ = carte(page, 1).getByRole('textbox', { name: 'Charge' });
  await expect(champ).toBeVisible();
  const avant = Number(await champ.inputValue()) || 0;
  await carte(page, 1).getByRole('button', { name: 'Augmenter' }).click();
  await expect(champ).toHaveValue(String(avant + 2.5));
  // Le pas est écrit, pas deviné — ou l'état du verrou, qui compte plus.
  await expect(carte(page, 1).getByText(/pas de 2,5|verrouillée pour l.athlète/)).toBeVisible();

  const suivant = carte(page, 1).getByRole('button', { name: 'Champ suivant' });
  await suivant.click();
  await expect(carte(page, 1).getByRole('combobox', { name: 'RPE cible' })).toBeVisible();
  await expect(carte(page, 1).getByText('pas de 0,5')).toBeVisible();
  await suivant.click();
  await expect(carte(page, 1).getByRole('textbox', { name: 'Séries' })).toBeVisible();
  await expect(carte(page, 1).getByText('pas de 1')).toBeVisible();
  await suivant.click();
  await expect(carte(page, 1).getByRole('textbox', { name: 'Reps' })).toBeVisible();
  await suivant.click();
  await expect(carte(page, 1).getByRole('textbox', { name: 'Charge' })).toBeVisible();

  await carte(page, 1).getByRole('button', { name: 'Terminé' }).click();
  await expect(carte(page, 1).getByRole('textbox', { name: 'Charge' })).toHaveCount(0);
  // La tuile porte la nouvelle valeur.
  await expect(carte(page, 1).getByRole('button', { name: /Charge kg/ })).toContainText(String(avant + 2.5));
});

test('le verrou est à côté de la charge, jamais dessus, et dit son état', async ({ page }) => {
  await ouvrirLaSeance(page);
  const tuile = carte(page, 1).getByRole('button', { name: /Charge kg/ });
  const verrou = carte(page, 1).getByRole('button', { name: /Charge (verrouillée|libre)/ });
  const [c, v] = await Promise.all([tuile.boundingBox(), verrou.boundingBox()]);
  expect(c && v && v.x >= c.x + c.width).toBe(true);
  expect(v!.width).toBeGreaterThanOrEqual(44);
  const etat = await verrou.getAttribute('aria-pressed');
  await verrou.click();
  await expect(verrou).toHaveAttribute('aria-pressed', etat === 'true' ? 'false' : 'true');
});

test('une ligne de groupe n’expose pas la saisie des séries : elles viennent de la première', async ({ page }) => {
  // Le bloc Intensification porte un dropset (séance s1) : sa seconde descente
  // ne saisit ni séries ni repos — ils sont ceux du tour.
  await page.goto('/training');
  await page.getByRole('button', { name: 'Intensification' }).click();
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  const dropset = page.locator('[data-seance-id="s1"]');
  const suite = dropset.locator('article[data-ligne]').last();
  await expect(suite).toBeVisible();
  await expect(suite.getByRole('button', { name: /Séries/ })).toBeDisabled();
  await expect(suite.getByRole('button', { name: /Séries/ })).toContainText('↑');
  await expect(suite.getByRole('button', { name: /^repos/ })).toHaveCount(0);
  // La première ligne du groupe, elle, saisit les deux.
  const premiere = dropset.locator('article[data-ligne]').first();
  await expect(premiere.getByRole('button', { name: /Séries/ })).toBeEnabled();
});

test('le menu ⋮ propose de dupliquer, lier, déplacer vers une autre séance, retirer', async ({ page }) => {
  await ouvrirLaSeance(page);
  await carte(page, 1).getByRole('button', { name: /^Actions de la ligne/ }).click();
  const menu = carte(page, 1).getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Retirer' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Dupliquer/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Déplacer vers/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(carte(page, 1).getByRole('menu')).toHaveCount(0);
});

test('rien ne déborde : la page ne défile pas horizontalement', async ({ page }) => {
  await ouvrirLaSeance(page);
  await carte(page, 1).getByRole('button', { name: /Charge kg/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Et la carte de la séance non plus : le plancher du doigt élargit ses boutons.
  expect(await page.evaluate(() =>
    [...document.querySelectorAll('[data-seance-id]')].every(e => e.scrollWidth <= e.clientWidth + 1))).toBe(true);
});
