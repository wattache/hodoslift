import { expect, test } from '@playwright/test';

/** LE CHOIX D'ATHLÈTE, DANS L'EN-TÊTE (Passe 3, constat 07, 14/09).
 *
 *  Trente-cinq personnes tenaient dans 248 px de barre latérale, six visibles.
 *  Ce que ces specs gardent :
 *    1. la barre latérale ne porte plus d'athlètes — la navigation seule ;
 *    2. ⌘K / Ctrl+K ouvre le sélecteur, la frappe filtre ET se surligne ;
 *    3. ⏎ choisit, et on RESTE sur la vue qui décrit un athlète ;
 *    4. ce qui ne décrit personne ouvre le tableau de bord du choisi.
 *
 *  ⚠️ LE DEV-MOCK N'A QUE DEUX ATHLÈTES ACTIFS : l'échelle (35) ne se joue pas ici.
 *  Le filtrage et le surlignage, eux, sont les mêmes à deux qu'à trente-cinq —
 *  `athlete-noms.test.ts` garde les accents et les indices.
 */

const declencheur = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /Changer d'athlète|Switch athlete/ });

test('la barre latérale ne porte plus aucun athlète', async ({ page }) => {
  /** MUTATION QUI ROUGIT : remettre `ligneAthlete` dans `AppSidebar`. */
  await page.goto('/training');
  await expect(declencheur(page)).toBeVisible();
  const barre = page.locator('[data-sidebar="sidebar"]').first();
  await expect(barre.getByText('Théo Bernard')).toHaveCount(0);
  await expect(barre.getByText('Léa Martin')).toHaveCount(0);
});

test('Ctrl+K ouvre, la frappe filtre et se surligne, ⏎ choisit sans quitter la vue', async ({ page }) => {
  /** MUTATIONS QUI ROUGISSENT : retirer l'écouteur de ⌘K ; rendre le nom sans
   *  `segmentsDeRecherche` ; renvoyer toujours `/dashboard` depuis
   *  `routeApresChangementDAthlete`. */
  await page.goto('/training');
  await expect(declencheur(page)).toBeVisible();
  await page.keyboard.press('Control+k');

  const recherche = page.getByRole('textbox', { name: /Chercher un athlète|Search an athlete/ });
  await expect(recherche).toBeFocused();
  await recherche.fill('bern');

  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option', { name: /Théo Bernard/ }).locator('mark')).toHaveText('Bern');

  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(declencheur(page)).toHaveAccessibleName(/Théo Bernard/);
  await expect(page).toHaveURL(/\/training$/);
});

test('depuis ce qui ne décrit personne, choisir ouvre le tableau de bord', async ({ page }) => {
  await page.goto('/library');
  await declencheur(page).click();
  await page.getByRole('option', { name: /Théo Bernard/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('hors de l’espace athlète, le nom ramène à la dernière page de l’athlète, mode coach compris', async ({ page }) => {
  /** William, 14/09 : « si je suis sur mon athlète et que je vais dans la
   *  bibliothèque, je n'ai rien pour revenir facilement ». La liste latérale était
   *  ce chemin ; partie avec le constat 07, il fallait rechoisir l'athlète qu'on
   *  regardait déjà. La flèche, elle, change toujours d'athlète.
   *  MUTATIONS QUI ROUGISSENT : le nom ouvre le choix au lieu de ramener ;
   *  `revenir` va toujours au tableau de bord. */
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('link', { name: 'Tracker' }).click();
  // L'URL change AVANT que la vue soit rendue (route chargée à la demande) :
  // c'est l'onglet actif qui dit que la page de l'athlète est bien à l'écran.
  await expect(page.getByRole('link', { name: 'Tracker' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('link', { name: 'Bibliothèque' }).click();
  await expect(page).toHaveURL(/\/library/);
  await page.getByRole('button', { name: /Revenir à Léa Martin/ }).click();
  await expect(page).toHaveURL(/\/tracker$/);

  await page.getByRole('link', { name: 'Entraînement' }).click();
  await expect(page.getByRole('link', { name: 'Entraînement' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Bibliothèque' }).click();
  await page.getByRole('button', { name: /Revenir à Léa Martin/ }).click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(page.getByRole('button', { name: /Éditer la BASE/ })).toBeVisible();

  // La flèche change d'athlète, depuis la bibliothèque aussi.
  await page.getByRole('link', { name: 'Bibliothèque' }).click();
  await expect(page.getByRole('button', { name: /Changer d'athlète/ })).toHaveCount(1);
});
