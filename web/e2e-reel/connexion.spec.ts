import { expect, test } from '@playwright/test';
import { arbre, seConnecter } from './aides';

/** Le test de fumée du harnais : si celui-ci tombe, aucun autre ne veut rien dire.
 *
 *  Il éprouve la chaîne ENTIÈRE — popup de l'émulateur → `signInWithPopup` →
 *  `currentUser.getIdToken()` → en-tête `Authorization` → `verify_id_token` →
 *  autorisation Postgres — c'est-à-dire tout ce que les 77 specs du dev-mock ne
 *  touchent jamais. */
test('se connecter pour de vrai, et voir son programme', async ({ page }) => {
  await seConnecter(page);
  const { macros } = await arbre();
  expect(Array.isArray(macros)).toBe(true);
});
