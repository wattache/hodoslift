import { expect, test } from '@playwright/test';

import { ATHLETE, colonne, nettoyer, poserUnMacro, seConnecter } from './aides';

/** LA SAISIE PAR SÉRIE, LES DEUX GESTES DU RETOUR CLIENT (23/10), par l'écran et
 *  relus EN BASE : copier une série sur les suivantes, et décocher « par série »
 *  pour revenir à la saisie unique — détail effacé, moyennes avec. */
test.afterEach(nettoyer);

const ligne = () => colonne(
  "SELECT coalesce(array_to_string(e.felt_rpe_by_set, ','), '∅') || ' | ' "
  + "|| coalesce(array_to_string(e.weight_done_by_set, ','), '∅') || ' | ' "
  + "|| coalesce(e.felt_rpe, '∅') || ' | ' || coalesce(e.weight_done, '∅') "
  + "FROM training_exercises e JOIN training_sessions s ON s.id = e.session_id "
  + "JOIN training_weeks w ON w.id = s.week_id JOIN training_blocks b ON b.id = w.block_id "
  + "JOIN training_macros m ON m.id = b.macro_id "
  + "WHERE m.program_id = 'e2e-program' AND e.name = 'SQUAT'");

test('copier la série 1 remplit les suivantes ; décocher « par série » efface tout', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '3', reps: '5', weight: '100' }]);
  await seConnecter(page, ATHLETE);
  await page.goto('/training');
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByTitle('Ajouter une note').first().click();
  await page.getByRole('button', { name: 'par série' }).click();

  // Série 1 : un RPE et une charge.
  await page.getByRole('combobox', { name: 'RPE réel' }).first().selectOption('8');
  const charge = page.getByLabel('Charge réelle').first();
  await charge.click();
  await charge.fill('60');
  await charge.press('Enter');

  // MUTATION QUI ROUGIT : le bouton qui ne copie que sur la série suivante.
  await page.getByRole('button', { name: 'Copier la série 1 sur les suivantes' }).click();
  await expect.poll(ligne, { timeout: 10_000 }).toBe('8,8,8 | 60,60,60 | 8 | 60');

  // MUTATION QUI ROUGIT : décocher qui replie sans effacer — le « 3/3 » resterait.
  await page.getByRole('button', { name: 'par série' }).click();
  await page.getByRole('button', { name: 'Effacer', exact: true }).click();
  await expect.poll(ligne, { timeout: 10_000 }).toBe('∅ | ∅ | ∅ | ∅');
});
