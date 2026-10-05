import { expect, test } from '@playwright/test';
import { COACH_ATHLETE, colonne, seConnecter } from './aides';

/** OUVRIR UN ACCÈS SUPPORT À UN ATHLÈTE (FRE-202) — par le vrai chemin.
 *
 *  L'admin du harnais (le coach-athlète, promu le temps de la spec) ne coache
 *  pas l'athlète E2E : rien ne lui ouvre sa fiche. Il s'ouvre un accès support
 *  depuis l'écran Admin, arrive sur la fiche, et y a les droits du coach et du
 *  kiné — les badges de l'en-tête et l'écriture proposée le disent. Il le ferme,
 *  et le bouton d'ouverture revient.
 *
 *  ⚠️ LE CHEMIN EST LE VRAI : le bouton, la route, `authz`, `/athletes/mine`, la
 *  sélection. La base est lue après chaque geste — le dev-mock ne persiste rien.
 *
 *  ⚠️ TOUT EST REMIS EN `afterEach`, même en échec : les autres specs veulent le
 *  coach-athlète sans `is_admin`, et aucun accès support en cours. */

const admin = (oui: boolean) =>
  colonne(`UPDATE users SET is_admin = ${oui} WHERE uid = 'e2e-coach-athlete' RETURNING is_admin`);
const accesEnCours = () =>
  colonne(`SELECT count(*) FROM acces_support WHERE uid = 'e2e-coach-athlete' AND fin > clock_timestamp()`);

test.beforeEach(() => { admin(true); });
test.afterEach(() => {
  admin(false);
  colonne(`DELETE FROM acces_support WHERE uid = 'e2e-coach-athlete'`);
});

test("l'admin ouvre un accès support à un athlète qu'il ne coache pas, puis le ferme", async ({ page }) => {
  await seConnecter(page, COACH_ATHLETE);
  await page.goto('/admin');
  await page.getByRole('textbox', { name: /Chercher une personne/ }).fill('Athlète E2E');
  await page.getByRole('list', { name: 'Personnes' }).getByRole('button', { name: /^Athlète E2E/ }).click();

  await page.getByRole('button', { name: 'Ouvrir un accès support (24 h)' }).click();
  await expect.poll(accesEnCours).toBe('1');

  // Il arrive sur la fiche avec les droits du coach : l'entraînement lui propose
  // d'écrire — le mode Coach si l'athlète a un programme, sa création sinon. Les
  // deux ne s'affichent qu'avec `canManage`, que seul l'accès support lui donne ici.
  // ⚠️ L'UN OU L'AUTRE, parce que l'état du programme dépend des specs jouées
  // avant : viser le seul bouton « Coach » a rougi sur un athlète sans programme.
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole('link', { name: /Entraînement/ }).first().click();
  await expect(page.getByRole('button', { name: /^(Coach|Créer un macrocycle)$/ }).first()).toBeVisible();
  // …et les deux badges de l'en-tête, qui, eux, suivent les droits : « Coach »
  // (`canManage`) et « Suivi kiné » (`suivisIds`, ce qui ouvre les notes).
  // ⚠️ PAS L'ONGLET « Suivi kiné » : les onglets ne dépendent plus des droits.
  // ⚠️ DANS LE BLOC DU TITRE, pas dans `main` : l'onglet « Suivi kiné » porte le
  // même texte, et une spec qui le lirait passerait au vert sans le badge.
  const entete = page.getByRole('heading', { level: 2, name: 'Athlète E2E' }).locator('..').locator('span');
  await expect(entete.filter({ hasText: /^\s*Coach\s*$/ })).toBeVisible();
  await expect(entete.filter({ hasText: /^\s*Suivi kiné\s*$/ })).toBeVisible();

  // Il ferme : la base le dit, et l'athlète quitte son sélecteur.
  await page.goto('/admin');
  await page.getByRole('textbox', { name: /Chercher une personne/ }).fill('Athlète E2E');
  await page.getByRole('list', { name: 'Personnes' }).getByRole('button', { name: /^Athlète E2E/ }).click();
  await expect(page.getByText(/Accès support ouvert jusqu’à/)).toBeVisible();
  await page.getByRole('button', { name: 'Fermer l’accès support' }).click();
  await expect.poll(accesEnCours).toBe('0');
  await expect(page.getByRole('button', { name: 'Ouvrir un accès support (24 h)' })).toBeVisible();
});
