import { expect, test, type Page } from '@playwright/test';

/** Variantes cumulées sur une ligne d'exercice (FRE-33).
 *
 *  Fixture : bloc Accumulation, semaine 1, séance « Squat ». Le SQUAT y porte
 *  DEUX variantes en liste (`['HIGH BAR', 'PAUSE']`) et les DIPS une seule en
 *  CHAÎNE — la forme historique, que 9 200 lignes portent encore. Les deux
 *  doivent s'afficher pareil : c'est tout l'intérêt de normaliser à la lecture.
 *
 *  Ce que ces tests NE couvrent pas : la persistance. Les écritures du mock sont
 *  des no-op (cf. FRE-35). */

const ouvrirLaSeanceSquat = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: /Semaine 1/ }).first().click();
  // ⚠️ `.first()` DEPUIS LE BANDEAU DE SÉANCES (refonte des écrans, 09/2026). La semaine porte
  // désormais un bandeau qui liste ses séances et permet d'en choisir une : deux
  // boutons portent donc le nom « Squat », celui du bandeau et celui de la
  // rangée. Les deux ouvrent la même séance — c'est le premier, le raccourci,
  // qu'on prend ici, comme le ferait quelqu'un qui arrive sur la semaine.
  await page.getByRole('button', { name: /Squat/ }).first().click();
};

test('deux variantes s’affichent jointes, dans l’ordre de saisie', async ({ page }) => {
  await ouvrirLaSeanceSquat(page);
  await expect(page.getByText('HIGH BAR + PAUSE', { exact: true }).first()).toBeVisible();
});

test('une variante SEULE s’affiche sans liant', async ({ page }) => {
  // La forme héritée (une chaîne) n'est plus testée ici : elle n'existe plus à
  // la source depuis que la lecture vient de Postgres, où `variant` est une
  // colonne text[]. Ce qui reste à vérifier, c'est qu'une liste d'UN élément ne
  // traîne pas le « + » du cumul.
  await ouvrirLaSeanceSquat(page);
  // « Lesté » et non « LESTÉ » : la majuscule vient d'un `text-transform` CSS,
  // que Playwright ne voit pas — il lit le texte du DOM.
  await expect(page.getByText('Lesté', { exact: true }).first()).toBeVisible();
});

test('un exercice SANS variante n’affiche pas de badge vide', async ({ page }) => {
  // `[]` est TRUTHY en JS : tester la liste au lieu du libellé collait un badge
  // vide — ou un « · » orphelin — sur chaque exercice sans variante.
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: /Semaine 1/ }).first().click();
  await page.getByRole('button', { name: /Haut du corps/ }).first().click();

  const ligne = page.getByText('ROWING').first().locator('..');
  await expect(ligne).not.toContainText('·');
});

test('le coach cumule et retire une variante sans refermer la liste', async ({ page }) => {
  await ouvrirLaSeanceSquat(page);
  await page.getByRole('button', { name: 'Coach', exact: true }).click();

  // ⚠️ VISÉ PAR SON CONTENU, PLUS PAR SON RANG. C'était `.nth(3)`, et ce rang
  // dépendait du nombre d'exercices affichés AVANT lui — donc de fixtures qui
  // n'ont rien à voir avec les variantes. Ajouter une ligne au mock (la ligne
  // « Kiné » de FRE-96, dans une AUTRE séance) a suffi à décaler l'index et à
  // faire rougir cette spec sur « FFE ». Un test qui casse quand on touche
  // ailleurs ne signale plus rien : il crie.
  // Les variantes se saisissent dans le dépli de la ligne (brief coach, 27/09) ;
  // la ligne, elle, les affiche en badge — c'est par lui qu'on la trouve.
  const rangee = page.locator('[data-ligne]').filter({ hasText: 'HIGH BAR + PAUSE' }).first();
  const cellule = rangee.getByRole('button', { name: 'Variantes' });
  await expect(cellule).toContainText('HIGH BAR + PAUSE');

  await cellule.click();
  // Cumuler est le geste : le panneau reste ouvert entre deux choix, sinon il
  // faudrait le rouvrir autant de fois qu'on ajoute de variantes.
  await page.getByRole('button', { name: 'Strict', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lesté', exact: true })).toBeVisible();

  await expect(cellule).toContainText('HIGH BAR + PAUSE + Strict');

  // Le maximum est atteint (3) : les autres options ne sont plus cliquables,
  // mais restent listées — la liste ne change pas sous les yeux du coach.
  await expect(page.getByRole('button', { name: 'Lesté', exact: true })).toBeDisabled();

  // Retirer reste possible à la limite, sinon on serait coincé.
  await page.getByRole('button', { name: 'Strict', exact: true }).click();
  await expect(cellule).toContainText('HIGH BAR + PAUSE');
  await expect(page.getByRole('button', { name: 'Lesté', exact: true })).toBeEnabled();
});

/* --- La BASE, qui REGÉNÈRE les semaines ---------------------------------- */

test('les variantes se cumulent aussi dans la BASE', async ({ page }) => {
  // Ne traiter que la semaine, c'est voir la variante unique revenir à la
  // prochaine génération : la BASE est l'autre arbre, et c'est elle qui gagne.
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  const champ = page.getByRole('button', { name: 'Variantes' }).first();
  await champ.click();
  await page.getByRole('button', { name: 'Tempo', exact: true }).click();
  await expect(champ).toContainText('Strict + Tempo');

  // ⚠️ LE REPORT DANS LA SEMAINE GÉNÉRÉE EST ÉPROUVÉ CÔTÉ SERVEUR depuis le
  // 26/08 — `test_les_VARIANTES_cumulées_suivent_la_génération`, plus une spec
  // que l'aperçu ne pouvait pas tenir : que la semaine ne PARTAGE pas le tableau
  // de la BASE (éditer l'une modifierait l'autre, défaut FRE-33).
  await page.keyboard.press('Escape');
});

test('les variantes retenues sont en tête de la liste, sans faire défiler', async ({ page }) => {
  /** ⚠️ RETOUR DE WILLIAM (20/09) : trois variantes cochées dans une liste de
   *  quarante, il fallait faire défiler pour les retrouver — et pour en retirer
   *  une. À l'ouverture, les retenues montent en tête ; le reste suit dans
   *  l'ordre du catalogue.
   *
   *  ⚠️ SUR LES DIPS, PAS SUR LE SQUAT, et ce n'est pas un hasard : « HIGH BAR »
   *  et « PAUSE » sont ABSENTES du catalogue du mock, donc en tête de toute
   *  façon (une valeur héritée s'affiche toujours). La première version de
   *  cette spec les visait, et restait verte sans le correctif. « Lesté » est
   *  la DEUXIÈME du catalogue : c'est elle qui doit passer devant « Strict ». */
  await ouvrirLaSeanceSquat(page);
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  const rangee = page.locator('[data-ligne]').filter({ hasText: /Lesté/ }).first();
  await rangee.getByRole('button', { name: 'Variantes' }).click();

  // Dans le panneau ouvert : la barre latérale porte aussi des `data-active`.
  const options = page.getByRole('dialog').locator('[data-active]');
  await expect(options.nth(0)).toHaveText('Lesté');
  await expect(options.nth(1)).toHaveText('Strict');

  // ⚠️ ET L'ORDRE NE BOUGE PAS TANT QUE LA LISTE EST OUVERTE : cocher une
  // variante ne la fait pas remonter sous le doigt — elle montera à la prochaine
  // ouverture. La liste entière, avant et après, doit être la même.
  const avant = await options.allTextContents();
  // Dans le panneau : chaque ligne d'exercice porte aussi un champ « Tempo ».
  await page.getByRole('dialog').getByRole('button', { name: 'Tempo', exact: true }).click();
  await expect(options.nth(0)).toHaveText('Lesté');
  expect(await options.allTextContents()).toEqual(avant);
});
