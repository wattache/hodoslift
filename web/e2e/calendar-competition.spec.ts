import { expect, test, type Page } from '@playwright/test';

/** DEPUIS LA FRISE, UNE COMPÉTITION OUVRE SA FICHE — PAR UNE POPUP (16/09).
 *
 *  William : « le rendu est confusant ; un signe que c'est cliquable, puis une
 *  popup qui s'ouvre et dessus de quoi aller vers l'élément correspondant ». La
 *  pastille s'ouvre sur une popup (date, délai) qui porte le lien.
 *
 *  ⚠️ DEUX SOURCES, ET UNE SEULE A UNE FICHE. Les vraies compétitions viennent de
 *  `GET /competitions` ; les événements de type compétition saisis à la main
 *  dans le calendrier — 13 en production, qui ne se créent plus depuis le 16/09
 *  mais se lisent encore — n'ont rien derrière. Leur proposer un lien promettrait
 *  une page inexistante.
 *
 *  Fixtures : « FNSL Inter-Région » est une compétition (comp-1, où Léa concourt) ;
 *  « Open du club » est un événement du calendrier. */

const pastille = (page: Page, nom: string) => page.getByRole('button').filter({ hasText: nom }).first();

test('la pastille ouvre une popup, et la popup ouvre la fiche', async ({ page }) => {
  /** MUTATION QUI ROUGIT : la popup sans son bouton « Ouvrir la compétition ». */
  await page.goto('/calendar');
  await pastille(page, 'FNSL Inter-Région').click();
  await page.getByRole('dialog').getByRole('button', { name: /Ouvrir la compétition/ }).click();
  await expect(page).toHaveURL(/\/competitions\/comp-1$/);
});

test('au clavier aussi', async ({ page }) => {
  await page.goto('/calendar');
  await pastille(page, 'FNSL Inter-Région').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByRole('button', { name: /Ouvrir la compétition/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/competitions\/comp-1$/);
});

test('un événement saisi à la main n’a PAS de lien : la popup dit qu’il n’a pas de fiche', async ({ page }) => {
  /** MUTATION QUI ROUGIT : proposer le bouton sans regarder `competitionId`. */
  await page.goto('/calendar');
  await pastille(page, 'Open du club').click();
  const popup = page.getByRole('dialog');
  await expect(popup).toContainText('Open du club');
  await expect(popup.getByRole('button', { name: /Ouvrir la compétition/ })).toHaveCount(0);
  await expect(popup).toContainText('sans fiche');
});
