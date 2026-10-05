import { expect, test, type Page } from '@playwright/test';
import { choisirAthlete } from './aides-athlete';

/** LA SÉLECTION DU TOTAL DE LA TABLE RM SURVIT (FRE-126).
 *
 *  Retour d'un coach : « on clique une fois pour virer CU, et ça reste en
 *  mémoire. » Elle vivait dans un `useState` — donc perdue à chaque changement
 *  d'onglet, d'athlète ou rechargement, et recliquée à chaque fois.
 *
 *  ⚠️ ET ELLE EST MÉMORISÉE PAR ATHLÈTE. « Je ne compte pas le chin-up » est une
 *  décision qui porte sur UN athlète, pas sur la façon de lire l'application :
 *  une clé partagée ferait basculer le total de tout le monde d'un seul clic.
 */

const chinUp = (page: Page) => page.getByRole('button', { name: /chin.?up/i });

async function ouvrirLeTableauDeBord(page: Page) {
  await page.goto('/dashboard');
  await expect(chinUp(page)).toBeVisible();
}

test('retirer un mouvement du total SURVIT au rechargement', async ({ page }) => {
  await ouvrirLeTableauDeBord(page);
  await expect(chinUp(page)).toHaveAttribute('aria-pressed', 'true');

  await chinUp(page).click();
  await expect(chinUp(page)).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(chinUp(page)).toHaveAttribute('aria-pressed', 'false');
});

test('la sélection d’un athlète ne déteint pas sur un autre', async ({ page }) => {
  /** ⚠️ LE CONTRE-EXEMPLE, ET C'EST LUI QUI JUSTIFIE LA CLÉ PAR ATHLÈTE. Une
   *  persistance globale passerait la spec précédente sans broncher — et ferait
   *  disparaître le chin-up du total de tous les athlètes du coach. */
  await ouvrirLeTableauDeBord(page);
  await chinUp(page).click();
  await expect(chinUp(page)).toHaveAttribute('aria-pressed', 'false');

  await choisirAthlete(page, /Théo Bernard/);
  await expect(chinUp(page)).toHaveAttribute('aria-pressed', 'true');
});
