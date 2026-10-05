import { expect, test } from '@playwright/test';
import { modeCoach, nettoyer, poserUnMacro, seConnecter } from './aides';

/** LA VIGNETTE DIT LA VÉRITÉ SUR L'ÉCRITURE (FRE-32).
 *
 *  ⚠️ CE QUE LES 8 SPECS UNITAIRES NE PROUVENT PAS. Elles éprouvent la machine à
 *  états du module de la file — avec des minuteurs SIMULÉS, sans écran. Elles
 *  restent vertes si l'état publié n'atteint jamais la vue : le hook l'expose,
 *  la vue ne le lit pas, et personne ne rougit.
 *
 *  C'est exactement ce qui rend cette spec-ci nécessaire : elle traverse la
 *  chaîne que le reste ne traverse pas — cellule → file → PATCH → état publié →
 *  vignette à l'écran, dans un vrai navigateur et avec les vraies 400 ms.
 *
 *  ⚠️ ET ELLE VÉRIFIE LES DEUX ÉTATS, pas seulement le sablier. « Enregistré »
 *  est l'apport principal du ticket : c'est lui qui dit qu'on peut fermer
 *  l'onglet. Un indicateur qui disparaît ne se distingue pas d'un indicateur
 *  jamais apparu.
 */
test.afterEach(nettoyer);

test('la vignette annonce l’écriture, puis son acquittement', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  // ⚠️ AU REPOS, ELLE N'AFFICHE RIEN. Annoncer « Enregistré » avant toute
  // écriture affirmerait quelque chose d'une écriture qui n'a pas eu lieu.
  await expect(page.getByText('Enregistré', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Enregistrement…')).toHaveCount(0);

  await page.getByRole('button', { name: 'Semaine 1' }).first().click();

  const charge = page.getByRole('textbox', { name: 'Charge' }).first();
  await expect(charge).toBeVisible({ timeout: 15_000 });

  await charge.fill('102.5');
  // La cellule ne valide qu'au blur : sans ce geste, rien ne part et il n'y a
  // rien à annoncer.
  await charge.blur();

  // ⚠️ LA FENÊTRE EST ÉTROITE : 400 ms de debounce plus l'aller-retour. C'est
  // précisément la fenêtre que le ticket décrit — la valeur est à l'écran, elle
  // n'est pas en base. Playwright réessaie jusqu'à la voir.
  await expect(page.getByText('Enregistrement…')).toBeVisible({ timeout: 5_000 });

  // Puis la retombée, qui PERSISTE — pas d'effacement après un délai.
  await expect(page.getByText('Enregistré', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Enregistrement…')).toHaveCount(0);
});
