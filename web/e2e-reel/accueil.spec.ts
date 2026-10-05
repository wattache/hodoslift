import { expect, test } from '@playwright/test';

import { ATHLETE, nettoyer, poserUnMacro, seConnecter } from './aides';

/** PAR DÉFAUT, ON ARRIVE SUR SA SEMAINE D'ENTRAÎNEMENT (William, 14/09).
 *
 *  La table complète vit sur `Accueil` (views/guichet.tsx). Le dev-mock n'a
 *  qu'un utilisateur, coach ET athlète : la case de l'athlète SEUL ne se
 *  traverse qu'ici, avec un vrai compte.
 *
 *  MUTATION QUI ROUGIT : `versSaSemaine` sans `!me.isCoach` → /dashboard.
 */
test.afterEach(nettoyer);

test('un athlète qui ouvre l’app arrive sur sa semaine, pas sur le tableau de bord', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);
  await seConnecter(page, ATHLETE);
  await page.goto('/');
  await expect(page).toHaveURL(/\/training$/, { timeout: 15_000 });
  await expect(page.getByText('SQUAT').first()).toBeVisible({ timeout: 15_000 });
});
