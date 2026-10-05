import { expect, test } from '@playwright/test';

import { ATHLETE, nettoyer, poserDuRealise, poserUnMacro, seConnecter } from './aides';

/** « N SANS RESSENTI » SE MET À JOUR QUAND ON NOTE LE RESSENTI (14/09).
 *
 *  Le compte vient de brokkr, avec le contenu du bloc (FRE-160). Noter le RPE
 *  manquant bouchait bien le trou en base, mais l'écran ne relisait jamais ce
 *  contenu : Willi voyait encore « 1 sans ressenti » sur une séance complète.
 *  Mesuré en production : zéro ligne sans ressenti sur sa séance, badge affiché.
 *
 *  ⚠️ SEUL LE HARNAIS RÉEL LE VOIT : sur le dev-mock, il n'y a pas de serveur
 *  pour recompter.
 *
 *  MUTATION QUI ROUGIT : retirer `['block-content']` de `clesDeriveesDuRealise`.
 */
test.afterEach(nettoyer);

test('noter le ressenti manquant fait disparaître « 1 sans ressenti »', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '4', reps: '3', weight: '100' }]);
  // Du travail noté, sans ressenti : le trou que le compteur signale.
  await poserDuRealise({ SQUAT: { weightDone: '100' } });

  await seConnecter(page, ATHLETE);
  await page.goto('/training');
  await expect(page.getByText('1 sans ressenti')).toBeVisible({ timeout: 15_000 });

  await page.getByTitle(/Voir notes|Ajouter une note/).first().click();
  await page.getByRole('combobox', { name: 'RPE réel' }).first().selectOption('8');

  await expect(page.getByText(/sans ressenti/)).toHaveCount(0, { timeout: 10_000 });
});
