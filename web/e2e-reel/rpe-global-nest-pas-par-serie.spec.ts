import { expect, test } from '@playwright/test';

import { ATHLETE, arbre, colonne, nettoyer, poserUnMacro, seConnecter } from './aides';

/** NOTER UN RESSENTI NE DOIT PAS OUVRIR LE DÉTAIL PAR SÉRIE (10/09).
 *
 *  ⚠️ POURQUOI CETTE SPEC EXISTE, ET POURQUOI ELLE PASSE PAR L'ÉCRAN. Les
 *  boutons de RPE de la carte appelaient `onUpdateSetRPE(i, serieActive, v)`
 *  SANS jamais regarder si le pli était ouvert — la série active valant 1 par
 *  défaut. Taper « 8 » sur une ligne à quatre séries, sans avoir vu une seule
 *  pastille, écrivait `felt_rpe_by_set = {'8'}`.
 *
 *  Rien ne le montrait : le serveur dérive `felt_rpe` du tableau, et la moyenne
 *  d'un élément vaut cet élément. Les deux colonnes disaient la même chose, et
 *  tous les écrans lisent le scalaire. Le badge « n/N » de FRE-156 a révélé le
 *  mensonge en lisant ce tableau comme un pli ouvert : « 1/4 ». 7 255 lignes
 *  sur les 13 475 à plusieurs séries en portaient un.
 *
 *  ⚠️ AUCUNE SPEC UNITAIRE NE POUVAIT L'ATTRAPER. Le défaut n'est ni dans le
 *  calcul du badge — `seriesRenseignees` fait exactement ce qu'elle annonce —
 *  ni dans le serveur pris seul. Il est dans le CHEMIN : quel geste de l'écran
 *  écrit quelle colonne. C'est la définition de ce que le harnais réel garde.
 *
 *  ⚠️ ET ON LIT LA COLONNE, PAS L'API. `GET /training` rend `feltRPEBySet: []`
 *  pour un tableau NULL comme pour un tableau vide : c'est `colonne()` qui voit
 *  la différence entre « il n'y a pas de détail » et « il y en a un, d'un
 *  élément ».
 */

test.afterEach(nettoyer);

const detail = () => colonne(
  "SELECT coalesce(array_to_string(e.felt_rpe_by_set, ','), '<NULL>') "
  + "FROM training_exercises e "
  + "JOIN training_sessions s ON s.id = e.session_id "
  + "JOIN training_weeks w ON w.id = s.week_id "
  + "JOIN training_blocks b ON b.id = w.block_id "
  + "JOIN training_macros m ON m.id = b.macro_id "
  + "WHERE m.program_id = 'e2e-program' AND e.name = 'SQUAT'");

test('un ressenti noté PLI FERMÉ ne laisse aucun détail par série', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '4', reps: '3', weight: '100' }]);

  await seConnecter(page, ATHLETE);
  await page.goto('/training');
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran (le bandeau la choisit quand il y en a plusieurs), et la replier ne
  // laissait qu'un titre au-dessus du vide. Le nom n'est plus un bouton : on
  // attend qu'il soit là, on ne le clique plus.
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByTitle('Ajouter une note').first().click();

  // Le pli par série n'est PAS ouvert : aucune pastille de série n'est à l'écran.
  await expect(page.getByTitle('Série 1')).toHaveCount(0);

  // Le geste de tous les jours : on tape son ressenti pour la ligne.
  await page.getByRole('combobox', { name: 'RPE réel' }).first().selectOption('8');

  // Le scalaire est écrit…
  await expect.poll(async () =>
    (await arbre()).macros[0]?.blocks[0]?.weeks[0]?.sessions?.[0]?.exercises?.[0]?.feltRPE,
    { timeout: 10_000 }).toBe('8');

  // …et la colonne de détail est restée VIDE. C'est l'assertion qui rougissait
  // avant le correctif, avec « 8 » au lieu de « <NULL> ».
  expect(detail()).toBe('<NULL>');
});
