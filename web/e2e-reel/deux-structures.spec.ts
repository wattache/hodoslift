import { expect, test } from '@playwright/test';
import { BROKKR, COACH_ATHLETE, colonne, jeton, seConnecter } from './aides';

/** DEUX STRUCTURES, UN COMPTE — FRE-13, par le vrai chemin.
 *
 *  Le cas de Nico : coach chez SCAPPULIFT, athlète chez French Forge. On le
 *  fabrique avec le coach-athlète du harnais, le temps de la spec — sa ligne
 *  `coaches` passe SCAPPULIFT, sa fiche (« Double E2E ») reste French Forge.
 *
 *  ⚠️ CE QUE LE DEV-MOCK NE PEUT PAS PROUVER : que le front ENVOIE la structure,
 *  et que brokkr BORNE la liste avec. Le mock filtre lui-même ; ici, si le
 *  `?structure=` se perdait en route, sa fiche French Forge apparaîtrait chez
 *  SCAPPULIFT.
 *
 *  ⚠️ LA LIGNE EST REMISE, MÊME EN ÉCHEC (`afterEach`) : les autres specs du
 *  coach-athlète le veulent coach French Forge, et `fiche_dans_la_structure_de_
 *  son_coach` (make invariants) le veut aussi. */

const coacheDans = (structure: string) =>
  colonne(`UPDATE coaches SET structure = '${structure}' WHERE uid = 'e2e-coach-athlete' RETURNING structure`);

const ENTREE = 'E2E LEVER SCAPPULIFT';

test.beforeEach(() => { coacheDans('scappulift'); });
test.afterEach(() => {
  coacheDans('french-forge');
  // Aucune route ne supprime une entrée de bibliothèque : le ménage passe par la base.
  colonne(`DELETE FROM library_entries WHERE name = '${ENTREE}'`);
});

/** Le sélecteur de structure : une ligne dans la barre latérale, qui ouvre la
 *  liste des structures (logo, nom, rôles). */
const declencheur = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /Changer de structure|Switch organisation/ });

/** Change de structure par le geste réel : ouvrir la liste, cliquer la carte. */
const allerDans = async (page: import('@playwright/test').Page, nom: RegExp) => {
  await declencheur(page).click();
  await page.getByRole('listbox', { name: /Changer de structure|Switch organisation/ })
    .getByRole('option', { name: nom }).click();
};

/** La structure courante, telle que la ligne l'affiche. */
const courante = (page: import('@playwright/test').Page) => declencheur(page);

/** Sa fiche, par le bouton de l'en-tête qui ouvre SON espace d'athlète.
 *  ⚠️ PAS PAR UN TITRE DE TABLEAU DE BORD : on arrive sur le guichet, où il n'y
 *  en a pas — « aucun titre Double » y était vrai quelle que soit la liste, et
 *  la première version de cette spec ne prouvait donc rien côté SCAPPULIFT. */
const saFiche = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /Double E2e/i });

test('coach chez SCAPPULIFT, athlète chez French Forge : chaque structure montre la sienne', async ({ page }) => {
  const demandes: string[] = [];
  page.on('request', r => { if (r.url().includes('/athletes/mine')) demandes.push(r.url()); });

  await seConnecter(page, COACH_ATHLETE);
  // Premier lancement : là où il est STAFF.
  await expect(courante(page)).toContainText('SCAPPULIFT');
  // Il n'y coache personne encore : sa fiche French Forge n'a rien à faire ici.
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(saFiche(page)).toHaveCount(0);
  expect(demandes.some(u => u.includes('structure=scappulift'))).toBe(true);

  await allerDans(page, /French Forge/);
  await expect(saFiche(page)).toBeVisible();
  expect(demandes.some(u => u.includes('structure=french-forge'))).toBe(true);
});


test('la bibliothèque est celle de la structure : une entrée SCAPPULIFT ne se voit pas chez French Forge', async ({ page }) => {
  // Créée par l'API, comme le ferait l'écran Bibliothèque, SANS structure : c'est
  // brokkr qui la range dans celle où il coache.
  const r = await fetch(`${BROKKR}/library/entries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await jeton(COACH_ATHLETE)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'exercices', name: ENTREE }),
  });
  expect(r.status).toBe(200);
  expect(colonne(`SELECT structure FROM library_entries WHERE name = '${ENTREE}'`)).toBe('scappulift');

  // ⚠️ PAR L'ONGLET « RENFORCEMENT » DANS LES DEUX STRUCTURES : la page s'ouvre
  // sur « Compétition », où l'entrée n'est pas — y constater son absence chez
  // French Forge serait vrai pour une mauvaise raison.
  const renforcement = () => page.getByRole('button', { name: /^(Renforcement|Accessories)\b/ }).click();
  await seConnecter(page, COACH_ATHLETE);
  await page.goto('/library');
  await renforcement();
  await expect(page.getByText(ENTREE)).toBeVisible();
  await allerDans(page, /French Forge/);
  await renforcement();
  await expect(page.getByText('BACK EXTENSION', { exact: true })).toBeVisible();
  await expect(page.getByText(ENTREE)).toHaveCount(0);
});


/** L'ADMIN ÉCRIT DANS LA STRUCTURE QU'IL REGARDE (19/09).
 *
 *  Le cas de William : coach chez ElGustoLift, admin de la plateforme, et
 *  organisateur des meets French Forge (trois des huit). Fabriqué ici avec le
 *  coach-athlète, rendu admin le temps de la spec : coach SCAPPULIFT, il va chez
 *  French Forge, où il n'est qu'athlète — et y crée une compétition.
 *
 *  ⚠️ CE QUE LE DEV-MOCK NE PEUT PAS PROUVER : que le front ENVOIE `?structure=`
 *  sur le PUT. Sans lui, brokkr la rangeait là où il coache (SCAPPULIFT), et elle
 *  disparaissait de la liste où il venait de la créer. La colonne `structure`
 *  est le seul œil qui le voit. */
const MEET = 'E2E MEET ADMIN FF';
const admin = (oui: boolean) =>
  colonne(`UPDATE users SET is_admin = ${oui} WHERE uid = 'e2e-coach-athlete' RETURNING is_admin`);

test.afterEach(() => {
  admin(false);
  colonne(`DELETE FROM competitions WHERE name = '${MEET}'`);
});

test("l'admin crée, depuis French Forge où il ne coache pas, une compétition French Forge", async ({ page }) => {
  admin(true);
  await seConnecter(page, COACH_ATHLETE);
  await allerDans(page, /French Forge/);
  // Pas de section Coach ici — la Bibliothèque lui reste ouverte, sous Admin.
  await expect(page.getByRole('link', { name: /^(Bibliothèque|Library)$/ })).toBeVisible();

  await page.goto('/competitions');
  await page.getByRole('button', { name: /Nouvelle compétition|New competition/ }).click();
  await page.getByPlaceholder(/Nom de la compétition|Competition name/).fill(MEET);
  await page.getByRole('button', { name: /^(Créer|Create)$/ }).click();
  await expect(page.getByText(MEET)).toBeVisible();
  expect(colonne(`SELECT structure FROM competitions WHERE name = '${MEET}'`)).toBe('french-forge');
});
