import { expect, test, type Page } from '@playwright/test';

/** DIRE OÙ IL MANQUE UNE SAISIE POUR QUE LE SUIVI LA VOIE (FRE-160).
 *
 *  Le seul trou qui rend service à signaler : du travail NOTÉ (reps ou charge
 *  réelles) sans aucun ressenti — invisible au suivi et aux records. Le serveur
 *  compte, au grain de la séance, à côté du n/N ; l'écran affiche, et se tait à
 *  zéro. Le mock porte UNE telle ligne (le squat de la Séance 2), et aucune
 *  ailleurs : l'autre séance de la semaine doit rester muette.
 *
 *  ⚠️ Une ligne à RPE seul n'est PAS un trou (l'usage nominal), ni une ligne sans
 *  rien (une séance non faite n'est pas un oubli) : `test_contenu_de_bloc.py`
 *  garde la règle ; ici on garde que l'écran la relaie et ne l'invente pas.
 */

const ouvrirLaSemaine1 = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: /Semaine 1/ }).first().click();
};

test('la séance qui porte du travail sans ressenti le dit, à côté du n/N', async ({ page }) => {
  await ouvrirLaSemaine1(page);
  await page.getByRole('button', { name: /Séance 2 — Squat/ }).first().click();
  const enTete = page.locator('section', { hasText: 'Séance 2 — Squat' }).first();
  await expect(enTete.getByText('1 sans ressenti')).toBeVisible();
  await expect(enTete.getByText(/exos/)).toBeVisible();
});

test('une séance sans trou se tait — pas de « 0 sans ressenti »', async ({ page }) => {
  await ouvrirLaSemaine1(page);
  await page.getByRole('button', { name: /Haut du corps/ }).first().click();
  await expect(page.getByText(/sans ressenti/)).toHaveCount(0);
});
