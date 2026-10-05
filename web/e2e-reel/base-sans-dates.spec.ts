import { expect, test } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserUnMacro, seConnecter } from './aides';

/** La BASE d'un bloc SANS dates S1 — le bug de la 3e passe de revue, tel quel.
 *
 *  La lecture sert `s1StartDate: ''` quand la date n'est pas posée ; l'éditeur
 *  de trame renvoie la base TELLE QU'IL L'A LUE ; et un motif de date qui
 *  refuse `''` rendait la trame non enregistrable sur **54 blocs sur 125**.
 *  Le PUT répondait 422, le front toastait, et rien n'était écrit.
 *
 *  Le geste testé est celui du coach : ouvrir l'éditeur de BASE d'un bloc sans
 *  dates, ajouter un accessoire, et vérifier EN BASE qu'il y est — dates
 *  toujours vides comprises. Pas de date posée dans ce test, et c'est le point :
 *  en poser une ferait passer le test à côté du bug qu'il garde.
 *
 *  ÉPROUVÉE en réintroduisant le défaut : `BaseContent.s1StartDate` privé de son
 *  `vide_en_none` (brokkr, `app/schemas/training_structure.py`) → le PUT écho
 *  repart en 422 et la spec rougit sur l'assertion d'accessoire. Rétabli.
 */
test.afterEach(nettoyer);

test('la trame d’un bloc sans dates S1 reste enregistrable', async ({ page }) => {
  await poserUnMacro();                      // un bloc, SANS base ni dates S1

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  // Ajouter un accessoire et le nommer : chaque commit de l'éditeur PART en
  // PUT /base — c'est CE payload (la base relue, dates vides comprises) qui
  // échouait en 422.
  await page.getByRole('button', { name: 'Accessoire' }).click();
  // Le brouillon d'abord (30/09) : on choisit, PUIS on valide — c'est la validation qui écrit.
  const brouillon = page.locator('[data-accessoire-brouillon]');
  const mouvement = brouillon.getByLabel('Mouvement');
  const premier = await mouvement.locator('option').nth(1).getAttribute('value');
  await mouvement.selectOption({ index: 1 });
  await brouillon.getByRole('button', { name: /^Ajouter à/ }).click();

  // La vérité du serveur, pas l'écran : l'accessoire est écrit, et les dates
  // S1 sont restées vides — le cas des 54 blocs réels.
  await expect.poll(async () => {
    const base = (await arbre()).macros[0]?.blocks[0]?.base;
    return base?.accessories?.map(a => a.name) ?? [];
  }, { timeout: 10_000 }).toEqual([premier]);

  const base = (await arbre()).macros[0].blocks[0].base;
  expect(base.s1StartDate ?? '').toBe('');
  expect(base.s1EndDate ?? '').toBe('');
});

/** « + SEMAINE » EST FERMÉ SUR UN BLOC SANS DATES DE S1, ET DIT POURQUOI (FRE-138).
 *
 *  brokkr refuse en 409 `base_sans_dates` : une semaine ne naît plus d'une trame
 *  non datée — « + Semaine » la faisait naître nue et contournait le refus de la
 *  génération (4 149 lignes réalisées hors de toute courbe le 15/09). Le front ne
 *  propose l'écriture que là où le serveur l'accepte, et la raison se LIT, avec
 *  le chemin : c'est dans la BASE que les dates se posent.
 *
 *  MUTATION QUI ROUGIT : `raisonPasDeSemaine` toujours `null` (bouton ouvert). */
test('sans dates de S1, « + Semaine » est fermé, dit pourquoi, et mène à la BASE', async ({ page }) => {
  await poserUnMacro();                      // une semaine, une BASE sans dates

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  await expect(page.getByRole('button', { name: 'Semaine', exact: true })).toBeDisabled({ timeout: 15_000 });
  const raison = page.getByRole('status').filter({ hasText: /pose d.abord le début et la fin de la semaine 1/ });
  await expect(raison).toBeVisible();

  await raison.getByRole('button', { name: 'Aller à la BASE' }).click();
  await expect(page.getByRole('button', { name: /Voir la semaine/ })).toBeVisible();
  // Le refus de la ROUTE, lui, est gardé côté serveur :
  // `test_sans_les_DEUX_dates_de_S1_la_route_refuse_et_n_écrit_rien`.
});
