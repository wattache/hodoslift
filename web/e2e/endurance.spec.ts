import { expect, test, type Page } from '@playwright/test';

/** L'ENDURANCE MUSCULAIRE (FRE-116) — lire et programmer circuit, EMOM, AMRAP.
 *
 *  Ce qu'on garde ici et que les unitaires de `groupe.test.ts` ne peuvent pas :
 *  que l'ÉCRAN lise vraiment la nature, la chaîne sans lâcher et les tours. Les
 *  règles (quels champs partagés, quelle durée) y sont éprouvées sans écran.
 *
 *  ⚠️ LE DEV-MOCK N'ENREGISTRE RIEN : ces specs gardent le rendu et l'état
 *  local, pas la persistance. Celle-ci l'est côté brokkr
 *  (`tests/test_training_lines.py`, section « groupes chronométrés »).
 *
 *  Fixture : bloc « Intensification », séance « Séance 2 — Endurance » — un
 *  circuit MU → PU → DIPS BAR sans lâcher puis SQUAT, un EMOM en rotation de
 *  trois mouvements, un AMRAP de deux à 7 tours. */

const ouvrirLEndurance = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Intensification' }).click();
  await page.getByTitle('Séance 2 — Endurance').click();
};

test("l'EMOM en rotation donne à chaque mouvement sa minute", async ({ page }) => {
  await ouvrirLEndurance(page);

  await expect(page.getByText('EMOM EN ROTATION', { exact: true })).toBeVisible();
  for (const minute of ['MIN 1', 'MIN 2', 'MIN 3']) {
    await expect(page.getByText(minute, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/on repart à MIN 1/i)).toBeVisible();
});

test('SANS LÂCHER s’écrit UNE fois, sur les trois mouvements qu’il enchaîne', async ({ page }) => {
  /** MUTATION QUI ROUGIT : `chaineSansLacher` qui ne voit aucune chaîne. */
  await ouvrirLEndurance(page);
  await expect(page.getByText(/sans lâcher · 3 mouv\./i)).toHaveCount(1);
});

test("l'athlète compte ses tours d'AMRAP au pied du groupe", async ({ page }) => {
  await ouvrirLEndurance(page);
  const tours = page.getByLabel('Tours réalisés');
  await expect(tours).toHaveText('7');
  await page.getByRole('button', { name: '+', exact: true }).click();
  await expect(tours).toHaveText('8');
});

test('le coach rattache la ligne suivante à un groupe, et elle prend sa nature', async ({ page }) => {
  /** Sans ce geste, aucun groupe ne dépassait deux lignes : zéro en production,
   *  et un EMOM de cinq mouvements impossible à écrire.
   *
   *  MUTATION QUI ROUGIT : ne pas proposer le lien sous la dernière ligne. */
  await ouvrirLEndurance(page);
  await page.getByRole('button', { name: 'Coach', exact: true }).click();

  // L'AMRAP défait, SQUAT redevient libre sous l'EMOM.
  await page.getByTitle('Délier le groupe').last().click();
  await page.getByTitle('Ajouter la suivante au groupe').first().click();

  await page.getByRole('button', { name: 'Athlète', exact: true }).click();
  await expect(page.getByText('MIN 4', { exact: true })).toBeVisible();
});

test('le coach pose UNBROKEN entre deux mouvements du circuit', async ({ page }) => {
  await ouvrirLEndurance(page);
  await page.getByRole('button', { name: 'Coach', exact: true }).click();

  // DIPS BAR → SQUAT n'est pas lié : c'est la seule bascule éteinte du circuit.
  const eteintes = page.locator('button[aria-pressed="false"]', { hasText: 'UNBROKEN' });
  await eteintes.first().click();

  await page.getByRole('button', { name: 'Athlète', exact: true }).click();
  await expect(page.getByText(/sans lâcher · 4 mouv\./i)).toHaveCount(1);
});
