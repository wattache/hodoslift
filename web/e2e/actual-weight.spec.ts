import { expect, test, type Page } from '@playwright/test';

/** Charge réelle (FRE-18) : l'athlète rend compte de ce qu'il a soulevé, sans
 *  jamais écraser la consigne du coach.
 *
 *  Deux défauts d'origine, tous deux couverts ici :
 *  - charge verrouillée → le champ disparaissait, rien n'était saisissable ;
 *  - charge non verrouillée → la saisie écrasait `weight`, la prescription. */

/** Déplie le 1er exercice de la séance du jour (fixture : MUSCLE UP,
 *  4×2 @ 9 kg, charge VERROUILLÉE). */
async function openFirstExercise(page: Page) {
  await page.goto('/training');
  // Mode athlète : la vue s'ouvre sur « Aperçu », séance repliée.
  await page.getByRole('button', { name: 'Détail' }).click();
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran, et la replier ne laissait qu'un en-tête au-dessus du vide. Le clic
  // n'a plus de cible : l'en-tête est redevenu un simple titre.
  await page.getByTitle(/Voir notes|Ajouter une note/).first().click();
}

const actualWeight = (page: Page) => page.getByRole('textbox', { name: 'Charge réelle' });

test('la charge réelle est saisissable même quand la charge est verrouillée', async ({ page }) => {
  await openFirstExercise(page);

  // Le verrou porte sur la consigne, pas sur le compte rendu.
  await expect(actualWeight(page)).toBeVisible();
});

test('la charge prescrite en placeholder, pour situer la saisie', async ({ page }) => {
  await openFirstExercise(page);

  // Vide veut dire « fait comme prévu », pas « aucune charge » : le placeholder
  // rappelle donc la consigne. Un NOMBRE seul (13/09) : l'unité est dans le titre
  // de la tuile, « Charge (kg) » — « 9 kg » en fond laissait croire qu'il fallait
  // la taper.
  await expect(actualWeight(page)).toHaveAttribute('placeholder', '9');
  await expect(page.getByText('Charge (kg)', { exact: true })).toBeVisible();
  await expect(actualWeight(page)).toHaveValue('');
});

test('saisir la charge réelle n’écrase pas la prescription', async ({ page }) => {
  await openFirstExercise(page);

  await actualWeight(page).fill('7.5');
  await actualWeight(page).blur();

  // La consigne (9) ET le réel (7.5) coexistent — c'est tout l'objet du ticket.
  await expect(page.getByText('9 kg → 7.5 kg').first()).toBeVisible();
  await expect(actualWeight(page)).toHaveValue('7.5');
});

test('la progression du bloc montre aussi « prescrit → réel »', async ({ page }) => {
  await openFirstExercise(page);

  await actualWeight(page).fill('7.5');
  await actualWeight(page).blur();

  // Sur la courbe : le réel en or sur son point, la consigne à côté du point
  // creux. MUTATION QUI ROUGIT : ne plus rendre le prescrit de la courbe.
  // Virgule : la carte écrit les charges dans la locale (« 112,5 », pas « 112.5 »).
  await expect(page.locator('[data-valeur-charge]', { hasText: /^7,5$/ })).toBeVisible();
  await expect(page.locator('[data-prescrit-charge]', { hasText: /^9$/ })).toBeVisible();
});

test('effacer la charge réelle rend la séance « faite comme prévu »', async ({ page }) => {
  await openFirstExercise(page);

  await actualWeight(page).fill('7.5');
  await actualWeight(page).blur();
  await expect(page.getByText('9 kg → 7.5 kg').first()).toBeVisible();

  await actualWeight(page).fill('');
  await actualWeight(page).blur();

  // Plus d'écart affiché : on retombe sur la seule consigne.
  await expect(page.getByText('9 kg → 7.5 kg')).toHaveCount(0);
  await expect(page.getByText('9 kg').first()).toBeVisible();
});
