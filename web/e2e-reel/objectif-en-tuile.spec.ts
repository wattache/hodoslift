import { expect, test } from '@playwright/test';
import { BROKKR, PROGRAMME, arbre, jeton, modeCoach, nettoyer, poserDuRealise, poserUnMacro, seConnecter } from './aides';

/** LA TUILE D'OBJECTIF DIT OÙ EN EST L'ATHLÈTE (FRE-254), calculé par brokkr sur
 *  les lignes RÉALISÉES du bloc : un 4×4 fait à 85 kg pour un objectif 4×4 à
 *  90 kg → « 85 kg en S1 », il reste 5. Traverse la vraie requête : la ligne n'est
 *  lue que si elle est tracée (RPE noté) et qu'elle porte une charge. */
test.afterEach(nettoyer);

test('la tuile lit la meilleure série du bloc au schéma de l’objectif', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '4', reps: '4', weight: '85', tier: 1 }]);
  await poserDuRealise({ SQUAT: { feltRPE: '8' } });
  const bloc = (await arbre()).macros[0].blocks[0];
  const r = await fetch(`${BROKKR}/programs/${PROGRAMME}/blocks/${bloc.id}/objectives`, {
    method: 'PUT', headers: { Authorization: `Bearer ${await jeton()}`, 'Content-Type': 'application/json' },
    // Posé depuis le principe SQUAT tier 1 : c'est son lien qui fait lire la série.
    body: JSON.stringify({ objectives: [{ exercise: 'SQUAT', sets: '4', reps: '4', weightMin: '90',
                                          source: 'principe', tier: 1 }],
                           version: bloc.objectivesVersion }),
  });
  expect(r.status, await r.clone().text()).toBe(200);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /^(Objectifs du bloc|Block objectives)$/ }).first().click();
  const tuile = page.locator('li', { hasText: '90 kg' }).first();
  // MUTATION QUI ROUGIT : `lignes_realisees` qui ne lit plus la charge prescrite.
  await expect(tuile).toContainText('85 kg en S1', { timeout: 15_000 });
  await expect(tuile).toContainText('+5');
});
