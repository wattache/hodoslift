import { expect, test, type Page } from '@playwright/test';

/** Répétitions réelles (FRE-19) : l'autre axe du record, jumeau de
 *  `actual-weight.spec.ts`.
 *
 *  Le défaut d'origine : le champ n'était proposé QUE si la consigne était une
 *  fourchette (« 8-10 »). Un athlète prescrit à « 2 » n'avait aucun moyen de
 *  signaler qu'il en avait fait 3 — et comme les mouvements principaux sont
 *  presque toujours prescrits en nombre fixe, les records ne voyaient jamais le
 *  réel. La fixture ci-dessous est exactement ce cas. */

/** Déplie le 1er exercice de la séance du jour (fixture : MUSCLE UP,
 *  4×2 @ 9 kg — reps prescrites en nombre FIXE, pas en fourchette). */
async function openFirstExercise(page: Page) {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Détail' }).click();
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran, et la replier ne laissait qu'un en-tête au-dessus du vide. Le clic
  // n'a plus de cible : l'en-tête est redevenu un simple titre.
  await page.getByTitle(/Voir notes|Ajouter une note/).first().click();
}

const actualReps = (page: Page) => page.getByRole('textbox', { name: 'Rép. réelles' });

test('les répétitions réelles sont saisissables sur une prescription FIXE', async ({ page }) => {
  await openFirstExercise(page);

  // Le cœur du ticket : avant, ce champ n'existait pas ici.
  await expect(actualReps(page)).toBeVisible();
});

test('la prescription en placeholder, pour situer la saisie', async ({ page }) => {
  await openFirstExercise(page);

  // Vide veut dire « fait comme prévu », pas « aucune répétition ».
  await expect(actualReps(page)).toHaveAttribute('placeholder', '2');
  await expect(actualReps(page)).toHaveValue('');
});

test('saisir les répétitions réelles n’écrase pas la prescription', async ({ page }) => {
  await openFirstExercise(page);

  await actualReps(page).fill('3');
  await actualReps(page).blur();

  await expect(actualReps(page)).toHaveValue('3');
  // La consigne (2) ET le réel (3) coexistent, comme pour la charge.
  await expect(page.getByText('2 → 3').first()).toBeVisible();
});

test('un réel IDENTIQUE à la consigne n’affiche aucun écart', async ({ page }) => {
  await openFirstExercise(page);

  await actualReps(page).fill('2');
  await actualReps(page).blur();

  // « 2 → 2 » ne serait que du bruit : l'écart ne s'affiche que s'il existe.
  await expect(page.getByText('2 → 2')).toHaveCount(0);
});

test('effacer les répétitions réelles rend la séance « faite comme prévu »', async ({ page }) => {
  await openFirstExercise(page);

  await actualReps(page).fill('3');
  await actualReps(page).blur();
  await expect(page.getByText('2 → 3').first()).toBeVisible();

  await actualReps(page).fill('');
  await actualReps(page).blur();

  await expect(page.getByText('2 → 3')).toHaveCount(0);
});
