import { expect, test, type Page } from '@playwright/test';

/** UNE TRAME NE PERD RIEN EN SILENCE (FRE-198), sur le dev-mock.
 *
 *  ⚠️ LA FIXTURE EST LA FAUTE ELLE-MÊME. La BASE du bloc « Accumulation »
 *  place DIPS le J4 et ne le porte PAS dans `selectedPrincipaux` — l'état
 *  exact où quatre cases ont disparu le 19/09 : un renommage laisse la grille
 *  citer un mouvement que la sélection ne connaît plus.
 *
 *  ⚠️ CE QUE LE MOCK PROUVE ICI, ET C'EST L'ESSENTIEL : le CÂBLAGE. La règle
 *  elle-même est éprouvée seule dans `lib/cycle.test.ts` ; ce que seule une
 *  page peut dire, c'est que la vue la traverse — rendre `movements` depuis la
 *  seule sélection recompile, passe tous les tests unitaires, et fait
 *  disparaître la colonne.
 *
 *  Ce que le mock ne peut PAS : que la case SURVIVE à l'enregistrement. Les
 *  writers y sont des no-op. C'est la mesure sur la donnée réelle qui le dit —
 *  106 cases perdues par l'ancienne lecture, zéro par celle-ci. */

const ouvrirLaBaseDAccumulation = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await expect(page.getByRole('heading', { name: /Répartition du cycle|Cycle split/ })).toBeVisible();
};

const caseDe = (page: Page, jour: string, mouvement: string) =>
  page.getByRole('button', { name: new RegExp(`^${jour}, ${mouvement}\\s*:`) });

test('un mouvement placé mais NON sélectionné garde sa colonne et son tier', async ({ page }) => {
  await ouvrirLaBaseDAccumulation(page);

  // SQUAT est dans la sélection : sa colonne allait de soi.
  await expect(caseDe(page, 'J4', 'SQUAT')).toBeVisible();

  // DIPS ne l'est pas — et c'est tout l'objet du ticket. Sans FRE-198 la
  // colonne n'existe pas, et la case du J4 n'est nulle part à l'écran.
  await expect(caseDe(page, 'J4', 'DIPS')).toBeVisible();
  // Le tier se dit en toutes lettres au lecteur d'écran, et en chiffre à l'œil.
  await expect(caseDe(page, 'J4', 'DIPS')).toHaveAccessibleName(/Secondaire|Secondary/);
  await expect(caseDe(page, 'J4', 'DIPS')).toHaveText('2');
});

test('la colonne héritée vient APRÈS les mouvements choisis', async ({ page }) => {
  await ouvrirLaBaseDAccumulation(page);

  // ⚠️ L'ORDRE N'EST PAS COSMÉTIQUE : `generation_semaine` range un mouvement
  // hors sélection en FIN de séance (`rang_mouvement` rend 10**6). L'écran doit
  // dire la même chose que ce qui sera engendré — sinon le coach voit un ordre
  // et en génère un autre, ce qui est le défaut d'origine de FRE-29.
  const entetes = await page.getByRole('columnheader').allInnerTexts();
  const rang = (m: string) => entetes.findIndex(t => t.includes(m));
  expect(rang('DIPS')).toBeGreaterThan(rang('SQUAT'));
  expect(rang('DIPS')).toBeGreaterThan(rang('MUSCLE UP'));
});
