import { expect, test } from '@playwright/test';
import { fauxPush } from '../e2e/faux-push';
import { ATHLETE, colonne, seConnecter } from './aides';

/** L'ABONNEMENT PUSH ARRIVE EN BASE, ET EN REPART (28/09).
 *
 *  ⚠️ POURQUOI CONTRE LA VRAIE PILE. Sur le dev-mock, activer l'interrupteur
 *  ne prouve que l'écran. La promesse est que brokkr GARDE l'abonnement de cet
 *  appareil — c'est lui qu'il lira pour envoyer quand le coach générera — et
 *  qu'il le retire quand on désactive. `colonne()` lit la table.
 *
 *  Le navigateur reste un faux (`faux-push.ts`) : Chromium sans service de
 *  push ne peut pas s'abonner pour de vrai, et ce n'est pas notre code. */

const ENDPOINT = 'https://push.example.test/abonnement/harnais';
const UID = 'e2e-athlete-user';
const enBase = () => colonne(`SELECT count(*) FROM push_subscriptions WHERE uid = '${UID}' AND endpoint = '${ENDPOINT}'`);
const effacer = () => { colonne(`DELETE FROM push_subscriptions WHERE uid = '${UID}'`); };

test.beforeEach(effacer);
test.afterEach(effacer);

test('activer écrit l’abonnement de cet appareil chez brokkr, désactiver le retire', async ({ page }) => {
  expect(enBase()).toBe('0');
  await fauxPush(page, { endpoint: ENDPOINT });
  await seConnecter(page, ATHLETE);
  await page.goto('/profil');

  const interrupteur = page.getByRole('switch', { name: /nouvelle semaine/ });
  await interrupteur.click();
  await expect(page.locator('[data-etat-push]')).toHaveAttribute('data-etat-push', 'actif');
  await expect.poll(enBase).toBe('1');

  await interrupteur.click();
  await expect(page.locator('[data-etat-push]')).toHaveAttribute('data-etat-push', 'inactif');
  await expect.poll(enBase).toBe('0');
});
