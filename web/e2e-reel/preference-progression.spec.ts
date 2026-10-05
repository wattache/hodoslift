import { expect, test } from '@playwright/test';
import { COACH, colonne, modeCoach, nettoyer, poserUnMacro, seConnecter } from './aides';

/** LA PRÉFÉRENCE D'AFFICHAGE SUIT LA PERSONNE (brief progression, 27/09).
 *
 *  ⚠️ POURQUOI CONTRE LA VRAIE PILE. Le dev-mock n'écrit rien : « le rendu
 *  change » et « le rendu est ENREGISTRÉ » y sont indiscernables — le repli
 *  `localStorage` rend le premier vrai à lui seul. La promesse est l'ALLER-RETOUR
 *  par brokkr : `users.preferences` en colonne, puis le même rendu sur un AUTRE
 *  navigateur, où aucun `localStorage` ne peut l'avoir gardé — dans le profil,
 *  et dans la carte du programme. `colonne()` lit la base, là où une lecture
 *  par l'API ne verrait qu'une réponse. */

const UID = 'e2e-coach';
const enBase = () => colonne(`SELECT coalesce(preferences ->> 'progression', 'NULL') FROM users WHERE uid = '${UID}'`);
const effacer = () => { colonne(`UPDATE users SET preferences = '{}'::jsonb WHERE uid = '${UID}'`); };

test.beforeEach(effacer);
test.afterEach(async () => { effacer(); await nettoyer(); });

test('le rendu choisi arrive en base, et revient sur un autre appareil — profil et carte', async ({ page, browser }) => {
  expect(enBase()).toBe('NULL');
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3', weight: '100' }]);

  await seConnecter(page, COACH);
  await page.goto('/profil');
  await expect(page.getByRole('radio', { name: 'Courbe' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Chiffres' }).click();
  await expect(page.getByRole('radio', { name: 'Chiffres' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-enregistrement]')).toHaveAttribute('data-enregistrement', 'enregistre');
  await expect.poll(enBase).toBe('chiffres');

  // ⚠️ UN AUTRE NAVIGATEUR : contexte neuf, disque vide. Ce qui revient vient de brokkr.
  const autre = await browser.newContext();
  const autrePage = await autre.newPage();
  try {
    await seConnecter(autrePage, COACH);
    await autrePage.goto('/profil');
    await expect(autrePage.getByRole('radio', { name: 'Chiffres' })).toHaveAttribute('aria-checked', 'true');

    // Et la carte du programme dessine les chiffres, sans rien avoir choisi ici.
    await autrePage.goto('/training');
    await modeCoach(autrePage);
    await autrePage.getByRole('button', { name: 'Semaine 1' }).first().click();
    await autrePage.locator('[data-ligne="0"]').first().getByRole('button', { name: /^Déplier la ligne/ }).click();
    await expect(autrePage.locator('[data-rendu]').first()).toHaveAttribute('data-rendu', 'chiffres');
  } finally {
    await autre.close();
  }
});
