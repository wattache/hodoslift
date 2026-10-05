import { expect, test } from '@playwright/test';
import { fauxPush } from './faux-push';

/** « ME PRÉVENIR QUAND MON COACH GÉNÈRE UNE NOUVELLE SEMAINE » (28/09) — le
 *  réglage de la page Profil, par appareil. Le navigateur est un faux
 *  (`faux-push.ts`) : ce qu'on éprouve est l'écran. L'aller-retour avec brokkr
 *  se prouve dans le harnais réel. */

const interrupteur = (page: import('@playwright/test').Page) => page.getByRole('switch', { name: /nouvelle semaine/ });
const etat = (page: import('@playwright/test').Page) => page.locator('[data-etat-push]');

test('activer demande la permission, s’abonne, et l’écran dit « activé sur cet appareil »', async ({ page }) => {
  await fauxPush(page);
  await page.goto('/profil');
  await expect(interrupteur(page)).not.toBeChecked();
  await expect(etat(page)).toHaveAttribute('data-etat-push', 'inactif');

  await interrupteur(page).click();
  await expect(interrupteur(page)).toBeChecked();
  await expect(etat(page)).toHaveAttribute('data-etat-push', 'actif');

  // Désactiver : l'abonnement du navigateur est retiré, l'écran suit.
  await interrupteur(page).click();
  await expect(interrupteur(page)).not.toBeChecked();
  await expect(etat(page)).toHaveAttribute('data-etat-push', 'inactif');
});

test('une permission bloquée dans le navigateur se dit, et l’interrupteur ne ment pas', async ({ page }) => {
  await fauxPush(page, { permission: 'denied' });
  await page.goto('/profil');
  await expect(etat(page)).toHaveAttribute('data-etat-push', 'refuse');
  await expect(interrupteur(page)).toBeDisabled();
});

test('un navigateur qui ne sait pas faire de push (Safari dans l’onglet) dit quoi faire', async ({ page }) => {
  // Sans faux : le Chromium de Playwright a `PushManager`, mais aucun worker n'est
  // enregistré en local — on retire l'API pour jouer le cas Safari.
  await page.addInitScript(() => { delete (window as unknown as { PushManager?: unknown }).PushManager; });
  await page.goto('/profil');
  await expect(etat(page)).toHaveAttribute('data-etat-push', 'indisponible');
  await expect(etat(page)).toContainText(/écran d’accueil|écran d'accueil/);
  await expect(interrupteur(page)).toBeDisabled();
});
