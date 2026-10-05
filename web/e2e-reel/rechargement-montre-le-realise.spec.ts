import { expect, test } from '@playwright/test';

import { ATHLETE, arbre, nettoyer, poserUnMacro, seConnecter } from './aides';

/** APRÈS UN RECHARGEMENT, LE RESSENTI SAISI S'AFFICHE TOUT DE SUITE (FRE-159).
 *
 *  Signalé le 09/09 : « je mets un RPE, je recharge, et ça n'est pas persisté ».
 *  Tout était en base ; c'est le cache PERSISTÉ pour le hors-ligne qui revenait
 *  au démarrage, déclaré frais 30 s, avec l'instantané d'avant la saisie. On
 *  rechargeait jusqu'à sortir de la fenêtre.
 *
 *  Réglé par `f3db9ae` : le contenu du bloc est relu après le calme de la
 *  saisie (2 s), donc le cache qu'on persiste porte la valeur. Reste une fenêtre
 *  assumée : recharger dans ces 2 s-là.
 *
 *  MUTATION QUI ROUGIT : retirer `['block-content']` de `clesDeriveesDuRealise`.
 */
test.afterEach(nettoyer);

test('un RPE noté, puis la page rechargée : il est là sans attendre', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '4', reps: '3', weight: '100' }]);
  await seConnecter(page, ATHLETE);
  await page.goto('/training');
  await page.getByTitle(/Voir notes|Ajouter une note/).first().click({ timeout: 15_000 });
  await page.getByRole('combobox', { name: 'RPE réel' }).first().selectOption('8');

  // En base d'abord : ce n'est pas l'écriture qu'on éprouve.
  await expect.poll(async () =>
    (await arbre()).macros[0].blocks[0].weeks[0].sessions?.[0].exercises[0]?.feltRPE,
  { timeout: 10_000 }).toBe('8');
  // Au-delà du calme de 2 s après lequel la file relit le contenu du bloc.
  await page.waitForTimeout(3_500);

  await page.reload();
  await page.getByTitle(/Voir notes|Ajouter une note/).first().click({ timeout: 15_000 });
  // 5 s : bien en deçà des 30 s pendant lesquelles l'ancien cache se croyait frais.
  await expect(page.getByRole('combobox', { name: 'RPE réel' }).first())
    .toHaveValue('8', { timeout: 5_000 });
});
