import { expect, test, type Page } from '@playwright/test';
import { COACH_ATHLETE, colonne, seConnecter } from './aides';

/** LA PAGE ADMIN, RANGÉE PAR PERSONNE (19/09) — par le vrai chemin.
 *
 *  Le harnais n'a pas d'admin : le coach-athlète le devient le temps de la spec
 *  (`users.is_admin`). Trois gestes, chacun lu dans la BASE après coup, parce
 *  que le dev-mock ne persiste rien :
 *    · donner puis retirer le rôle Kiné à l'athlète E2E (`kines`) ;
 *    · réaffecter l'athlète E2E au coach-athlète, puis le rendre (`athletes.coach_uid`) ;
 *    · le rôle Coach du compte admin n'a pas d'interrupteur.
 *
 *  ⚠️ TOUT EST REMIS EN `afterEach`, même en échec : les autres specs veulent
 *  l'athlète E2E coaché par `e2e-coach`, sans rôle kiné, et le coach-athlète
 *  sans `is_admin` (`ajouter-un-athlete` le veut coach NON admin). */

const admin = (oui: boolean) =>
  colonne(`UPDATE users SET is_admin = ${oui} WHERE uid = 'e2e-coach-athlete' RETURNING is_admin`);

test.beforeEach(() => { admin(true); });
test.afterEach(() => {
  admin(false);
  colonne(`DELETE FROM kines WHERE uid = 'e2e-athlete-user'`);
  colonne(`UPDATE athletes SET coach_uid = 'e2e-coach', structure = 'french-forge' WHERE legacy_id = 'e2e-athlete'`);
  colonne(`UPDATE programs SET coach_uid = 'e2e-coach' WHERE id = 'e2e-program'`);
});

/** Chercher une personne, ouvrir sa fiche. */
async function ouvrir(page: Page, nom: string) {
  await seConnecter(page, COACH_ATHLETE);
  await page.goto('/admin');
  await page.getByRole('textbox', { name: /Chercher une personne/ }).fill(nom);
  // ⚠️ DANS LA LISTE, ET AU DÉBUT DU NOM : le sélecteur d'athlète de l'en-tête
  // porte aussi un nom, et « Suivi par … » est sur d'autres lignes.
  await page.getByRole('list', { name: 'Personnes' }).getByRole('button', { name: new RegExp('^' + nom) }).click();
  await expect(page.getByRole('heading', { level: 2, name: nom })).toBeVisible();
}

test('un rôle Kiné se donne et se retire depuis la fiche', async ({ page }) => {
  await ouvrir(page, 'Athlète E2E');
  const kine = page.getByRole('switch', { name: 'Kiné' });
  await expect(kine).toHaveAttribute('aria-checked', 'false');

  await kine.click();
  await expect(kine).toHaveAttribute('aria-checked', 'true');
  // Dans la structure sélectionnée — celle où le coach-athlète coache.
  await expect.poll(() => colonne(`SELECT structure FROM kines WHERE uid = 'e2e-athlete-user'`)).toBe('french-forge');

  await kine.click();
  await expect(kine).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => colonne(`SELECT count(*) FROM kines WHERE uid = 'e2e-athlete-user'`)).toBe('0');
});

test("un athlète se réaffecte à un autre coach, et se rend", async ({ page }) => {
  await ouvrir(page, 'Athlète E2E');
  const coach = page.getByRole('combobox', { name: /Coach qui le suit/ });
  await expect(coach).toHaveValue('e2e-coach');

  await coach.selectOption('e2e-coach-athlete');
  await expect.poll(() => colonne(`SELECT coach_uid FROM athletes WHERE legacy_id = 'e2e-athlete'`)).toBe('e2e-coach-athlete');
  // Le programme suit (l'autorisation d'un programme se lit sur le programme).
  expect(colonne(`SELECT coach_uid FROM programs WHERE id = 'e2e-program'`)).toBe('e2e-coach-athlete');

  await coach.selectOption('e2e-coach');
  await expect.poll(() => colonne(`SELECT coach_uid FROM athletes WHERE legacy_id = 'e2e-athlete'`)).toBe('e2e-coach');
});

test("le rôle Coach du compte admin n'a pas d'interrupteur", async ({ page }) => {
  await ouvrir(page, 'Coach-athlète E2E');
  await expect(page.getByText(/Compte admin, non retirable/)).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Coach' })).toHaveCount(0);
  // Les deux autres rôles restent réglables.
  await expect(page.getByRole('switch', { name: 'Kiné' })).toBeEnabled();
});

test("un athlète d'une AUTRE structure n'est pas « sans rôle » ici", async ({ page }) => {
  // ⚠️ « SANS RÔLE » VEUT DIRE NULLE PART (William, 19/09). Vu depuis French
  // Forge, un athlète SCAPPULIFT n'a aucun rôle ICI — mais ce n'est pas
  // quelqu'un à qui il reste un rôle à donner. C'est `athleteStructures`
  // (`GET /users`) qui le dit ; sans lui, il tombait dans la liste.
  colonne(`UPDATE athletes SET structure = 'scappulift' WHERE legacy_id = 'e2e-athlete'`);
  await seConnecter(page, COACH_ATHLETE);
  await page.goto('/admin');

  const liste = page.getByRole('list', { name: 'Personnes' });
  await page.getByRole('tab', { name: /Sans rôle/ }).click();
  await expect(liste.getByRole('button', { name: /^Athlète E2E/ })).toHaveCount(0);

  // Il reste trouvable, et l'écran dit où il s'entraîne.
  await page.getByRole('textbox', { name: /Chercher une personne/ }).fill('Athlète E2E');
  await expect(liste.getByText(/Athlète chez SCAPPULIFT/)).toBeVisible();
});
