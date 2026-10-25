import { expect, test, type Page } from '@playwright/test';

/** L'OBJECTIF DE BLOC SE POSE DEPUIS UNE LIGNE DE LA BASE (FRE-252, FRE-254) :
 *  le bouton cible ouvre une fenêtre pré-remplie, l'identité de la ligne y est
 *  figée ; il n'existe plus d'ajout à vide, sans lien. */

const ouvrirLaBaseDu = async (page: Page, bloc: string) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: bloc, exact: true }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await page.getByRole('button', { name: /^(Objectifs du bloc|Block objectives)$/ }).click();
};

test('depuis une ligne de BASE : la fenêtre arrive pré-remplie, et l’objectif rejoint la liste', async ({ page }) => {
  await ouvrirLaBaseDu(page, 'Accumulation');

  // MUTATION QUI ROUGIT : le bouton absent des lignes (prop non branchée).
  await page.getByRole('button', { name: /^Poser un objectif depuis la ligne / }).first().click();
  const fenetre = page.getByRole('dialog');
  await expect(fenetre).toContainText('Nouvel objectif');
  // La ligne d'origine est affichée, et son identité n'est plus un champ.
  // MUTATION QUI ROUGIT : la fenêtre qui laisse modifier le mouvement.
  await expect(fenetre.locator('[data-ligne-de-l-objectif]')).toContainText('MUSCLE UP');
  await expect(fenetre.locator('label', { hasText: /^Mouvement$/ })).toBeHidden();

  await fenetre.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(fenetre).toHaveCount(0);
  await expect(page.getByText(/Objectif ajouté à/)).toBeVisible();
});

test('plus d’ajout à vide : la liste renvoie au bouton cible de la BASE', async ({ page }) => {
  /** MUTATION QUI ROUGIT : remettre le bouton « Objectif » sous la liste. */
  await ouvrirLaBaseDu(page, 'Accumulation');
  await page.getByRole('button', { name: /^(Éditer|Edit)$/ }).first().click();
  await expect(page.getByText(/Un objectif se pose depuis une ligne de la BASE/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Objectif$/ })).toHaveCount(0);
});
