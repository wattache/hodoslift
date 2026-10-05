import { expect, test, type Page } from '@playwright/test';

import { BROKKR, PROGRAMME, arbre, colonne, jeton, modeCoach, nettoyer, poserUnMacro, seConnecter } from './aides';

/** UN ONGLET RESTÉ OUVERT N'EFFACE PLUS LA COCHE POSÉE AILLEURS (FRE-163).
 *
 *  Le cas vécu (William, 14/09) : la base ouverte sur l'ordinateur, une coche
 *  « atteint » posée depuis le téléphone. `PUT …/objectives` remplace la liste
 *  ENTIÈRE : l'onglet de l'ordinateur, resté sur sa lecture, renvoyait sa liste
 *  sans la coche — et l'effaçait, sans un mot.
 *
 *  Ce que cette spec garde, et que les tests brokkr ne voient pas : que l'ÉCRAN
 *  envoie bien la version qu'il a lue. Un front qui ne suivrait pas enverrait un
 *  PUT sans version (422 : plus aucun objectif enregistrable) ou avec une version
 *  fraîche volée au cache (l'écrasement revient).
 *
 *  Le « téléphone » passe par l'API : la version que tient l'onglet doit être
 *  PÉRIMÉE, et l'interface n'offre aucun geste pour en fabriquer une.
 *
 *  MUTATION QUI ROUGIT : retirer la comparaison de version dans
 *  `replace_objectives` (brokkr) — la coche du téléphone disparaît.
 */
test.afterEach(nettoyer);

const LE_BLOC = `SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id
                 WHERE m.program_id = '${PROGRAMME}'`;

/** Déplie les objectifs du bloc, passe en édition, ouvre l'objectif SQUAT. */
async function ouvrirLObjectif(page: Page) {
  await page.getByRole('button', { name: /^(Objectifs du bloc|Block objectives)$/ }).click();
  const liste = page.locator('section').filter({ has: page.getByText(/SQUAT/) }).last();
  await page.getByRole('button', { name: /^(Éditer|Edit)$/ }).last().click();
  await liste.getByRole('button', { name: /SQUAT/ }).first().click();
}

/** Un champ de l'objectif ouvert — par son `<label>`, qui le distingue des
 *  cases de la grille voisine, nommées par `aria-label`. */
const champ = (page: Page, libelle: string) =>
  page.locator('label', { hasText: libelle }).locator('input');

async function ecrireDepuisLeTelephone(blocId: string, objectives: unknown[]) {
  const bloc = (await arbre()).macros[0].blocks.find(b => b.id === blocId)!;
  const r = await fetch(`${BROKKR}/programs/${PROGRAMME}/blocks/${blocId}/objectives`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await jeton()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectives, version: bloc.objectivesVersion }),
  });
  expect(r.status, await r.clone().text()).toBe(200);
}

test('la coche du téléphone survit à l’onglet de l’ordinateur resté ouvert', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);
  const blocId = colonne(LE_BLOC);
  await ecrireDepuisLeTelephone(blocId, [{ exercise: 'SQUAT', sets: '5', reps: '1' }]);

  // L'ordinateur ouvre la liste, en édition.
  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: 'Semaine 1' }).first().click();
  await ouvrirLObjectif(page);
  const series = champ(page, 'Séries');
  await expect(series).toHaveValue('5', { timeout: 15_000 });

  // Le téléphone coche « atteint ».
  await ecrireDepuisLeTelephone(blocId, [{ exercise: 'SQUAT', sets: '5', reps: '1', atteintLe: '2026-09-14' }]);

  // L'ordinateur, sur sa lecture d'avant, change les séries.
  await series.fill('4');

  // Refusé, et dit.
  await expect(page.getByText('Ces objectifs ont changé')).toBeVisible({ timeout: 10_000 });
  // ⚠️ EN BASE : la coche est toujours là, les séries n'ont pas bougé.
  expect(colonne(
    `SELECT coalesce(atteint_le::text, 'NULL') || ' ' || sets FROM block_objectives WHERE block_id = '${blocId}'`,
  )).toBe('2026-09-14 5');
  // Et l'écran s'est rechargé sur la vraie liste : la coche y est.
  await expect(champ(page, 'Séries')).toHaveValue('5', { timeout: 10_000 });
});

test('depuis l’écran, deux modifications à la suite passent toutes les deux', async ({ page }) => {
  /** Le premier concerné par un 409 serait l'écran lui-même : sa seconde écriture
   *  doit partir avec la version rendue par la première, pas avec celle de sa
   *  lecture. Sinon, plus personne ne pourrait modifier deux champs de suite. */
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);
  const blocId = colonne(LE_BLOC);
  await ecrireDepuisLeTelephone(blocId, [{ exercise: 'SQUAT', sets: '5', reps: '1' }]);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: 'Semaine 1' }).first().click();
  await ouvrirLObjectif(page);

  await champ(page, 'Séries').fill('4');
  await expect.poll(() => colonne(`SELECT sets FROM block_objectives WHERE block_id = '${blocId}'`),
                    { timeout: 10_000 }).toBe('4');
  await champ(page, 'Reps').fill('2');
  await expect.poll(() => colonne(`SELECT reps FROM block_objectives WHERE block_id = '${blocId}'`),
                    { timeout: 10_000 }).toBe('2');
  await expect(page.getByText('Ces objectifs ont changé')).toHaveCount(0);
});
