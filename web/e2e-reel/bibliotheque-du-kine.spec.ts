import { expect, test } from '@playwright/test';
import { KINE, colonne, seConnecter } from './aides';

/** LE KINÉ ENTRETIENT LA BIBLIOTHÈQUE DE SA STRUCTURE (FRE-247), par le vrai
 *  chemin : l'entrée du menu, le bouton, et la ligne EN BASE à son nom.
 *  Le compte du harnais n'est QUE kiné — le cas de celui de French Forge. */
const NOM = 'E2E NORDIC CURL DU KINE';
// L'auteur relu PAR SON EMAIL : c'est le compte kiné qui doit signer la ligne.
const enBase = () => colonne(
  `SELECT l.category || ':' || coalesce(u.email, '⌀') FROM library_entries l
   LEFT JOIN users u ON u.uid = l.created_by WHERE l.name = '${NOM}'`);
const menage = () => { colonne(`DELETE FROM library_entries WHERE name = '${NOM}' RETURNING 1`); };
test.beforeEach(menage);
test.afterEach(menage);

test('le kiné ouvre la Bibliothèque depuis le menu et y crée un exercice', async ({ page }) => {
  await seConnecter(page, KINE);
  // MUTATION QUI ROUGIT : l'entrée absente du menu du kiné.
  await page.getByRole('link', { name: 'Bibliothèque' }).first().click();
  await page.getByRole('tab', { name: 'Renforcement' }).or(page.getByRole('button', { name: 'Renforcement' })).first().click();
  // MUTATION QUI ROUGIT : `canWrite` sans le kiné — le bouton n'existe pas.
  await page.getByRole('button', { name: 'Nouvel élément' }).click();
  await page.getByPlaceholder('Nom…').fill(NOM);
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  // MUTATION QUI ROUGIT : `require_coach` côté brokkr — 403, rien en base.
  await expect.poll(enBase, { timeout: 10_000 }).toBe(`exercices:${KINE.email}`);
});
