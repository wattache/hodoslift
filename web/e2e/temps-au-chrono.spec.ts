import { expect, test, type Page } from '@playwright/test';

/** UN EXERCICE TENU AU CHRONO DEMANDE UN TEMPS, PAS DES RÉPÉTITIONS (FRE-42).
 *
 *  ⚠️ LE CHAMP EXISTAIT DÉJÀ, ET IL A SERVI UNE FOIS. Mesuré le 14/08 : 253
 *  lignes prescrites en secondes, UNE SEULE portant un temps réalisé. Ce n'était
 *  pas un manque de modèle — la durée vit dans `reps`/`repsDone` avec
 *  `repsUnit = 'sec'`, exactement comme `weight`/`weightDone`, et l'athlète
 *  pouvait déjà écrire dedans.
 *
 *  Ce qui manquait : la case s'annonçait « Rép. réelles » et proposait « ex: 12 ».
 *  On demandait une durée en montrant un compteur de répétitions.
 *
 *  ⚠️ ET SURTOUT PAS UNE COLONNE « TEMPS ». Ce serait le réflexe. La durée occupe
 *  déjà trois champs de la ligne — `reps` en secondes, `clusterMode` pour la
 *  fenêtre d'un AMRAP, `clusterRest` pour le repos intra-série — plus `rest`
 *  entre les séries. Une cinquième notation rendrait l'ensemble illisible.
 *
 *  ⚠️ CE QUE CES SPECS NE PROUVENT PAS : que le champ se remplira. L'hypothèse
 *  est que l'athlète ne comprenait pas ce qu'on lui demandait ; il se peut aussi
 *  qu'on ne chronomètre simplement pas une planche. C'est la donnée qui
 *  tranchera. L'objet du ticket est que ce soit DISPONIBLE et lisible — on ne
 *  force pas un suivi.
 */

/** La séance qui porte les DEUX unités : ROWING en répétitions, CHINESE PLANK
 *  en secondes. C'est leur cohabitation qui rend ces specs probantes — si
 *  l'étiquette ne suivait pas l'unité, un seul libellé existerait à l'écran. */
async function ouvrirLaSeance(page: Page) {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: 'Semaine 1' }).first().click();
  await page.getByRole('button', { name: 'Détail' }).click();
  await page.getByRole('button', { name: /Haut du corps/ }).first().click();
}

/** Déplie un exercice par son RANG dans la séance — c'est le bouton de notes qui
 *  ouvre le panneau où vit la saisie du réalisé.
 *  Rangs : 0 MUSCLE UP · 1 PULL UP · 2 ROWING (repos prescrit) ·
 *  3 FACE PULL (repos LIBRE) · 4 CHINESE PLANK (prescrit en secondes). */
const deplier = (page: Page, rang: number) =>
  page.getByTitle(/Voir notes|Ajouter une note/).nth(rang).click();

test('la saisie du réalisé demande un TEMPS sur une ligne en secondes', async ({ page }) => {
  await ouvrirLaSeance(page);
  await deplier(page, 4); // CHINESE PLANK, 3 × 60 s

  await expect(page.getByRole('textbox', { name: 'Temps réel' })).toBeVisible();
});

test('le clavier du téléphone est numérique — la saisie est en secondes', async ({ page }) => {
  await ouvrirLaSeance(page);
  await deplier(page, 4);

  await expect(page.getByRole('textbox', { name: 'Temps réel' }))
    .toHaveAttribute('inputmode', 'numeric');
});

test('une ligne en RÉPÉTITIONS garde son libellé', async ({ page }) => {
  await ouvrirLaSeance(page);
  await deplier(page, 2); // ROWING, 3 × 10

  // ⚠️ LE CONTRE-EXEMPLE, ET IL EST NÉCESSAIRE. Une spec qui ne vérifierait que
  // le cas « secondes » resterait VERTE si l'étiquette devenait « Temps réel »
  // partout — c'est-à-dire si on avait cassé les 9 000 lignes prescrites en
  // répétitions pour réparer les 253 autres.
  await expect(page.getByRole('textbox', { name: /Rép\. réelles/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Temps réel' })).toHaveCount(0);
});

/* ------------------------------------------------------------------------- */
/* LE REPOS RÉEL — TROISIÈME AXE DU RÉALISÉ (FRE-42)                          */
/* ------------------------------------------------------------------------- */

/** ⚠️ LE CHAMP N'EXISTAIT QUE SUR UN REPOS LIBRE. Mesuré : 4 395 lignes de
 *  production portent un repos PRESCRIT et AUCUNE ne porte de réel — faute de
 *  case. Sur repos libre, où la case existait, 877 sur 7 299 sont remplies (12 %).
 *  Le zéro ne disait pas un désintérêt, il disait une impossibilité.
 *
 *  C'est le défaut de FRE-19 sur les répétitions, à l'identique : un champ offert
 *  dans un seul cas rend le réel invisible dans l'autre. */

test('le repos réel se saisit AUSSI quand le repos est prescrit', async ({ page }) => {
  await ouvrirLaSeance(page);
  await deplier(page, 2); // ROWING, repos prescrit à 90 s

  const champ = page.getByRole('textbox', { name: 'Repos réel' });
  await expect(champ).toBeVisible();
  // La consigne en repère : vide veut dire « pris comme prévu ». En SECONDES
  // (13/09) : la tuile s'intitule « Repos (s) », et le champ attend un nombre.
  await expect(champ).toHaveAttribute('placeholder', '90');
});

test('le repos réel reste saisissable sur un repos LIBRE', async ({ page }) => {
  await ouvrirLaSeance(page);
  await deplier(page, 3); // FACE PULL, repos LIBRE

  // ⚠️ LE CONTRE-EXEMPLE DE L'OUVERTURE : en ouvrant le champ partout, on ne
  // devait pas le retirer du cas qui marchait déjà — celui des 877 saisies.
  await expect(page.getByRole('textbox', { name: 'Repos réel' })).toBeVisible();
});

test('la progression du bloc montre « prescrit → réel » sur le REPOS aussi', async ({ page }) => {
  /** ⚠️ LA LIGNE « REPOS » DU TABLEAU DE PROGRESSION NE MONTRAIT QUE LE RÉEL.
   *  Signalé par William sur une capture : `2'` prescrites, `1'45"` prises, et
   *  la case n'affichait que `1'45"` — l'écart, qui est l'information, n'était
   *  nulle part.
   *
   *  Les lignes Reps et Charge appliquaient déjà « prescrit → réel » ; celle-ci
   *  était la seule à ne pas le faire, parce que le point de progression ne
   *  transportait tout simplement pas le repos prescrit.
   *
   *  ⚠️ ELLE S'APPELAIT « TEMPS », ce qui prêtait à confusion depuis que le
   *  réalisé d'une ligne en secondes s'appelle « Temps réel ». Cette ligne porte
   *  le REPOS entre séries, jamais la durée d'un exercice tenu. */
  await ouvrirLaSeance(page);
  await deplier(page, 2); // ROWING, repos prescrit à 90 s

  const repos = page.getByRole('textbox', { name: 'Repos réel' });
  await repos.fill('105');
  await repos.blur();

  // 90 s prescrites, 105 s prises : les deux coexistent dans la cellule.
  await expect(page.getByText("1'30\" → 1'45\"", { exact: true })).toBeVisible();
});
