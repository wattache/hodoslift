import { expect, test, type Page } from '@playwright/test';

/** AUCUNE SUPPRESSION NE PART SANS QU'ON L'AIT DEMANDÉ.
 *
 *  ⚠️ QUATRE ÉCHAPPAIENT À LA RÈGLE, et toutes dans les deux écrans où l'on écrit
 *  le plus longtemps : trois dans l'éditeur de BASE (une ligne de principe, une
 *  ligne d'accessoire, une pastille de mouvement), une au tableau de bord (un
 *  record manuel). Les douze autres passaient bien par `useConfirm` — c'est cette
 *  MAJORITÉ qui rendait les quatre invisibles : on suppose la règle tenue partout
 *  parce qu'elle l'est presque partout.
 *
 *  ⚠️ ET CE QUI PART N'EST PAS UNE CASE À COCHER. Une ligne de principe porte la
 *  prescription entière d'un mouvement — séries, reps, charge, incrément, note —
 *  et la BASE se reproduit ensuite dans chaque semaine générée. Un clic de
 *  corbeille sans retour y coûte une soirée de programmation.
 *
 *  Ces specs vérifient la MARCHE ARRIÈRE, pas seulement l'apparition du dialogue :
 *  annuler doit tout laisser en place. Un dialogue qui s'affiche mais supprime
 *  quand même serait pire que pas de dialogue — il donnerait confiance.
 */

const ouvrirLaBase = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Intensification' }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
};

/** Les corbeilles de la section « Principes », et elles seules.
 *
 *  ⚠️ UN SÉLECTEUR SUR TOUTE LA PAGE ATTRAPE LE PANNEAU « GÉRER », qui porte les
 *  mêmes corbeilles pour le macro, le bloc et la semaine. Écrite large, cette
 *  spec cliquait « supprimer le macro » et confirmait : le programme entier
 *  partait, et l'échec ressemblait à un défaut du produit. */
const corbeilles = (page: Page) =>
  page.locator('section', { has: page.getByText('Principes', { exact: true }) })
      .last()
      .locator('button:has(svg.lucide-trash2)');

test('annuler ne supprime pas une ligne de l’éditeur de BASE', async ({ page }) => {
  await ouvrirLaBase(page);

  const avant = await corbeilles(page).count();
  expect(avant).toBeGreaterThan(0);

  await corbeilles(page).first().click();
  await expect(page.getByRole('button', { name: 'Supprimer', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(corbeilles(page)).toHaveCount(avant);
});

test('confirmer supprime bien la ligne', async ({ page }) => {
  await ouvrirLaBase(page);

  const avant = await corbeilles(page).count();
  await corbeilles(page).first().click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();

  await expect(corbeilles(page)).toHaveCount(avant - 1);
});

test('retirer une pastille annonce ce qui part AVEC elle', async ({ page }) => {
  await ouvrirLaBase(page);

  const pastilles = page.getByRole('button', { name: '×' });
  const avant = await pastilles.count();
  await pastilles.first().click();

  // ⚠️ LA CONSÉQUENCE EST INVISIBLE À L'ÉCRAN : ce « × » a l'air d'une case qu'on
  // décoche, et il emporte les lignes de principe portant ce mouvement plus son
  // rang dans la répartition des jours. Le dire est tout l'intérêt du dialogue —
  // confirmer sans le savoir ne vaut pas mieux que ne rien demander.
  await expect(page.getByText(/répartition des jours/)).toBeVisible();

  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(pastilles).toHaveCount(avant);
});

test('vider un record manuel demande confirmation, et dit ce qu’il vaut', async ({ page }) => {
  // ⚠️ LA SUPPRESSION LA PLUS SOURNOISE DU PRODUIT. Les onze autres passent par
  // une corbeille : l'intention est claire avant même le dialogue. Ici le geste
  // est « je corrige une valeur » — on vide une case, et le record part. C'est le
  // seul endroit où l'on détruit sans avoir visé un bouton de destruction, donc
  // le seul où le dialogue apprend quelque chose au lieu de le rappeler.
  await page.goto('/dashboard');
  // ⚠️ PAR SA SECTION, PAS PAR `.first()` : le tableau des pourcentages de 1RM,
  // juste au-dessus, porte lui aussi un bouton « Éditer ». Un `.first()` ouvrait
  // le mauvais tableau et la spec accusait le produit d'un champ manquant.
  const records = page.locator('section', { has: page.getByText('Records personnels (All-Time)') });
  await records.getByRole('button', { name: 'Éditer' }).click();

  // MUSCLE UP × 1 vaut 11 kg dans la maquette. La case se désigne par son nom
  // accessible, qui MANQUAIT : les cinquante cellules de la grille étaient un
  // champ « kg » indistinct pour un lecteur d'écran.
  const case11 = page.getByRole('textbox', { name: 'Record manuel MUSCLE UP 1 rep' });
  await expect(case11).toHaveValue('11');
  await case11.fill('');
  await case11.blur();

  await expect(page.getByText(/Supprimer le record manuel/)).toBeVisible();
  // La valeur perdue est ANNONCÉE : « supprimer un record » ne dit pas lequel on
  // s'apprête à perdre, et c'est justement ce qu'on ne voit plus une fois la case
  // vidée à l'écran.
  await expect(page.getByText(/11 kg/)).toBeVisible();

  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
});
