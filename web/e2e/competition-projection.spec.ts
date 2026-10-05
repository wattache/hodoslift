import { expect, test } from '@playwright/test';

/** LES TOTAUX P, R ET O PROJETÉS (FRE-203), sur le dev-mock.
 *
 *  Le calcul vit dans brokkr (`compute_projection`) et y a ses specs ; ici, on
 *  garde ce que l'écran en fait : la projection s'affiche sous le total tant
 *  qu'il reste des essais à venir, et se tait quand elle égale le total.
 *
 *  ⚠️ Le mock porte les valeurs que brokkr servirait : Léa a tout à venir sur
 *  l'Open (134,5 dans les trois hypothèses) ; elle a fini la FNSL Région (174). */

test('la projection s’affiche sous le total tant que des essais restent', async ({ page }) => {
  await page.goto('/competitions/comp-1');
  const projection = page.getByLabel(/Totaux projetés/).first();
  await expect(projection).toBeVisible();
  await expect(projection).toContainText('P 134.5');
  await expect(projection).toContainText('R 134.5');
  await expect(projection).toContainText('O 134.5');
});

test('la projection se tait quand elle égale le total', async ({ page }) => {
  await page.goto('/competitions/comp-0');
  // Le total est là (174), la projection non : elle l'égale dans les trois hypothèses.
  await expect(page.getByText('174').first()).toBeVisible();
  await expect(page.getByLabel(/Totaux projetés/)).toHaveCount(0);
});

test('chaque athlète du groupe montre sa projection, pas seulement celui qu’on regarde', async ({ page }) => {
  /** La refonte du Plateau (24/09) ne la gardait que dans le récapitulatif de
   *  l'athlète choisi. MUTATION QUI ROUGIT : retirer la projection du classement
   *  du groupe — il n'en resterait aucune. */
  await page.goto('/competitions/comp-2');
  const classement = page.getByRole('region', { name: /Classement · Groupe A · au total/ });
  await expect(classement.getByLabel(/Totaux projetés/)).toHaveCount(3);
});
