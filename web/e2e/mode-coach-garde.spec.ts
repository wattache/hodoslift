import { expect, test, type Page } from '@playwright/test';

import { choisirAthlete } from './aides-athlete';

/** LE MODE COACH SURVIT AUX DÉTOURS (FRE-178).
 *
 *  C'était un état local de la vue Entraînement : aller voir un 1RM (tableau de
 *  bord) ou la bibliothèque la démontait, et le retour la remontait en mode
 *  athlète. Le signe du mode coach, ici, est « Éditer la BASE » : il n'existe
 *  qu'en mode coach.
 *
 *  MUTATION QUI ROUGIT : revenir à `useState('athlete')` — les deux détours
 *  retombent en mode athlète.
 */

const modeCoach = (page: Page) => page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ });

async function passerEnCoach(page: Page) {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await expect(modeCoach(page)).toBeVisible();
}

test('sans aucun clic, c’est le mode athlète', async ({ page }) => {
  await page.goto('/training');
  await expect(page.getByRole('button', { name: 'Coach', exact: true })).toBeVisible();
  await expect(modeCoach(page)).toHaveCount(0);
});

test('un détour par la bibliothèque ne fait pas perdre le mode coach', async ({ page }) => {
  await passerEnCoach(page);
  await page.getByRole('link', { name: 'Bibliothèque' }).click();
  await expect(page).toHaveURL(/\/library/);
  // Le retour réel : on rechoisit l'athlète dans l'en-tête, puis l'onglet.
  await choisirAthlete(page, /Léa/);
  await page.waitForURL(u => !u.pathname.startsWith('/library'));
  if (!/\/training/.test(page.url())) await page.getByRole('link', { name: 'Entraînement' }).click();
  await expect(modeCoach(page)).toBeVisible();
});

test('un détour par le tableau de bord (le 1RM), DANS l’espace athlète, non plus', async ({ page }) => {
  await passerEnCoach(page);
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole('link', { name: 'Entraînement' }).click();
  await expect(modeCoach(page)).toBeVisible();
});

test('repasser en athlète se garde aussi', async ({ page }) => {
  await passerEnCoach(page);
  await page.getByRole('button', { name: 'Athlète', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Coach', exact: true })).toBeVisible();
  await expect(modeCoach(page)).toHaveCount(0);
});

test('d’un athlète géré à un autre, le mode coach suit — c’est une préférence, pas un réglage par athlète', async ({ page }) => {
  await passerEnCoach(page);
  await choisirAthlete(page, /Théo/);
  await expect(modeCoach(page)).toBeVisible();
});

/* ⚠️ LE CAS « ATHLÈTE QU'ON NE COACHE PAS » N'EST PAS ICI : le dev-mock n'en
 * offre aucun dans le sélecteur (Léa et Théo sont tous deux gérés). Il tient à
 * une lecture — `mode` vaut « coach » seulement si `canUseCoachMode` — et pas à
 * un effet qui effacerait la préférence. */
