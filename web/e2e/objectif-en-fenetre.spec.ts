import { expect, test, type Page } from '@playwright/test';

/** L'OBJECTIF DE BLOC SE POSE DANS UNE FENÊTRE (FRE-252) — par ses deux portes :
 *  « Objectif » sous la liste, vide ; et le bouton d'une ligne de BASE,
 *  pré-rempli avec toute la prescription, format ET options compris. */

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
  // Le mouvement de la ligne est déjà choisi : la fenêtre n'est pas vide.
  await expect(fenetre.getByRole('combobox').first()).not.toHaveValue('');

  await fenetre.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(fenetre).toHaveCount(0);
  await expect(page.getByText(/Objectif ajouté à/)).toBeVisible();
});

test('« Objectif » sous la liste ouvre la même fenêtre, vide, avec les options du format', async ({ page }) => {
  await ouvrirLaBaseDu(page, 'Accumulation');
  await page.getByRole('button', { name: /^(Éditer|Edit)$/ }).first().click();
  await page.getByRole('button', { name: /^Objectif$/ }).click();
  const fenetre = page.getByRole('dialog');
  await expect(fenetre).toContainText('Nouvel objectif');
  // Les options n'existent qu'avec un format — et le cluster en a deux.
  await expect(fenetre.getByText('Schéma', { exact: true })).toHaveCount(0);
  await fenetre.locator('select').nth(2).selectOption('CLUSTER');
  await expect(fenetre.getByText('Schéma', { exact: true })).toBeVisible();
  await expect(fenetre.getByText('Repos du cluster', { exact: true })).toBeVisible();
});
