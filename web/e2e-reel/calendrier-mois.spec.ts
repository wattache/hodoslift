import { expect, test } from '@playwright/test';
import { colonne, seConnecter } from './aides';

/** TOUCHER UN JOUR DU MOIS CRÉE L'ÉVÈNEMENT À CETTE DATE, EN BASE (FRE-245). */
const NOM = 'e2e-mois-anniversaire';
const enBase = () => colonne(`SELECT start_date || ':' || end_date FROM calendar_events WHERE name = '${NOM}'`);
test.afterEach(() => { colonne(`DELETE FROM calendar_events WHERE name = '${NOM}' RETURNING 1`); });

test('un évènement saisi depuis la vue Mois arrive en base au jour touché', async ({ page }) => {
  colonne(`DELETE FROM calendar_events WHERE name = '${NOM}' RETURNING 1`);
  await seConnecter(page);
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Mois', exact: true }).click();

  // Le 15 du mois affiché — jamais aujourd'hui, sauf le 15 : on prend alors le 16.
  const auj = new Date();
  const j = auj.getDate() === 15 ? 16 : 15;
  const jour = `${auj.getFullYear()}-${String(auj.getMonth() + 1).padStart(2, '0')}-${j}`;
  await page.locator(`[role="gridcell"][data-jour="${jour}"] > button`).first().click();
  await page.getByPlaceholder("Nom de l'événement").fill(NOM);
  await page.getByRole('button', { name: 'Créer' }).click();

  await expect.poll(enBase, { timeout: 10_000 }).toBe(`${jour}:${jour}`);
});
