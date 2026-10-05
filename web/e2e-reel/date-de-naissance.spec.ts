import { expect, test } from '@playwright/test';
import { BROKKR, COACH, colonne, jeton, seConnecter } from './aides';

/** UNE DATE DE NAISSANCE, DONT L'ÂGE SE CALCULE — FRE-168.
 *
 *  `athletes.age` était un entier saisi à la main, faux dès l'anniversaire
 *  suivant. Le coach saisit désormais une DATE, et l'en-tête affiche l'âge que
 *  BROKKR en déduit — le navigateur ne calcule rien.
 *
 *  ⚠️ POURQUOI CONTRE LA VRAIE PILE. Le dev-mock ne persiste rien : « le champ
 *  accepte une date » et « la date arrive en base et revient en âge » y sont
 *  indiscernables. La promesse est l'ALLER-RETOUR : `birth_date` en colonne,
 *  puis l'âge calculé par Postgres, affiché. `colonne()` lit la base, là où une
 *  lecture par l'API ne verrait qu'une réponse.
 *
 *  ⚠️ LA DATE EST CHOISIE POUR QUE L'ÂGE NE PUISSE PAS SE DEVINER : née il y a
 *  30 ans DEMAIN, l'athlète a 29 ans aujourd'hui. Une soustraction d'années
 *  (l'erreur la plus probable) afficherait 30.
 */

const ATHLETE_ID = 'e2e-athlete';

const ilYATrenteAnsDemain = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 30);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function effacerLaDate() {
  await fetch(`${BROKKR}/athletes/${ATHLETE_ID}/profile`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${await jeton(COACH)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ birthDate: '' }),
  });
}

const enBase = () => colonne(`SELECT coalesce(birth_date::text, 'NULL') FROM athletes WHERE legacy_id = '${ATHLETE_ID}'`);

test.beforeEach(effacerLaDate);
test.afterEach(effacerLaDate);

test('le coach saisit une date, la base la garde, et l’en-tête affiche l’âge calculé', async ({ page }) => {
  expect(enBase()).toBe('NULL');
  const date = ilYATrenteAnsDemain();

  await seConnecter(page);
  // La fiche a son onglet (27/09) : on y va, plus de fenêtre à ouvrir.
  await page.goto('/profil');

  // ⚠️ LE SÉLECTEUR DE L'APP, PAS UN CHAMP NATIF : l'icône du calendrier natif
  // était invisible sur le fond sombre (William, 18/09). On traverse le geste
  // réel — ouvrir, choisir l'année et le mois dans les listes, cliquer le jour.
  const [annee, mois] = date.split('-').map(Number);
  await page.getByTitle(/date de naissance|date of birth/i).click();
  await page.getByRole('combobox', { name: /année|year/i }).selectOption(String(annee));
  await page.getByRole('combobox', { name: /mois|month/i }).selectOption(String(mois - 1));
  await page.locator(`[role="gridcell"][data-day="${date}"] button`).click();

  await expect.poll(enBase).toBe(date);
  // L'âge, calculé par brokkr, s'affiche à côté de la date sur la fiche.
  await expect(page.getByText(/^29 (ans|yrs)$/)).toBeVisible();

  // « Effacer » EFFACE — et non « ne change rien » : le patch écarte les
  // `null`, c'est `''` qui porte l'effacement. Le calendrier se referme d'abord.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^(effacer|clear)$/i }).click();
  await expect.poll(enBase).toBe('NULL');
});
