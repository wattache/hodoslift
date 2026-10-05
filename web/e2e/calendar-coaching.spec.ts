import { expect, test } from '@playwright/test';
import { choisirAthlete } from './aides-athlete';

const couloir = (page: import('@playwright/test').Page) => page.locator('[data-couloir-competitions]');

/** Le calendrier montre les compétitions où l'athlète affiché ENCADRE, en plus
 *  de celles où il concourt (FRE-25).
 *
 *  Deux défauts successifs, tous deux couverts ici :
 *  - le calendrier ne retenait que les compétitions où l'athlète est
 *    PARTICIPANT, et un coach ne l'est pas — il encadre ;
 *  - puis la disponibilité lue était celle de l'utilisateur CONNECTÉ, si bien
 *    qu'un coach consultant le planning d'un autre n'y voyait rien (ou pire, y
 *    voyait ses propres plateaux).
 *
 *  Fixtures — deux coachs, deux compétitions distinctes, aucun des deux ne
 *  dispute celle qu'il encadre :
 *    Léa  (compte `mock-coach`, athlète par défaut) → encadre « FNSL »
 *    Théo (compte `user-1`)                        → encadre « FNSL Inter-Région »
 *  Sans cette asymétrie, rien ne distinguerait « l'athlète affiché » de
 *  « l'utilisateur connecté ». */

test('la compétition encadrée apparaît dans le calendrier', async ({ page }) => {
  await page.goto('/calendar');

  // Léa n'y est pas inscrite : seule sa disponibilité de coach l'y amène.
  await expect(page.getByText('FNSL', { exact: true }).first()).toBeVisible();
});

test('elle ouvre bien sa fiche, comme une compétition où l’on concourt', async ({ page }) => {
  await page.goto('/calendar');

  // Depuis le 16/09, la pastille ouvre une popup, qui porte le lien.
  // « FNSL » est le PRÉFIXE de « FNSL Région » et « FNSL Inter-Région » : on vise
  // la pastille dont le nom est exactement celui-là.
  await couloir(page).getByRole('button').filter({ has: page.getByText('FNSL', { exact: true }) }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Ouvrir la compétition/ }).click();
  await expect(page).toHaveURL(/\/competitions\/comp-2$/);
});

test('une compétition où l’athlète concourt n’apparaît pas en double', async ({ page }) => {
  await page.goto('/calendar');

  // Participant ET coach disponible resteraient deux entrées sans déduplication.
  // ⚠️ DANS LE COULOIR DES COMPÉTITIONS : la liste des jalons la nomme aussi, et
  // c'est légitime — une ligne par source serait le défaut, pas une par vue.
  await expect(couloir(page).getByText('FNSL Inter-Région', { exact: true })).toHaveCount(1);
});

test('le calendrier suit l’athlète AFFICHÉ, pas l’utilisateur connecté', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.getByText('FNSL', { exact: true }).first()).toBeVisible();

  // Bascule sur Théo, qui encadre une AUTRE compétition. On revient
  // explicitement au calendrier : sinon on vérifierait l'absence de « FNSL » sur
  // une page qui ne l'affiche peut-être pas — un test vert pour rien.
  await choisirAthlete(page, /Théo Bernard/);
  await page.goto('/calendar');

  // Si le calendrier lisait les disponibilités du compte CONNECTÉ, « FNSL » serait
  // encore là et la FNSL Inter-Région absente : c'est exactement le bug remonté
  // en production sur le calendrier d'Aubin.
  await expect(page.getByText('FNSL Inter-Région', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('FNSL', { exact: true })).toHaveCount(0);
});
