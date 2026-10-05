import { expect, test, type Page } from '@playwright/test';

/** LE SCORE DE MÉCANOTRANSDUCTION SUR LA LIGNE (FRE-96).
 *
 *  Demandé par Thomas (kiné) : `somme des chiffres du tempo × répétitions`, sur
 *  les seules lignes de nature « Kiné ». Le calcul et ses cas limites sont tenus
 *  par `src/lib/mechano.test.ts` ; ce qui se joue ICI est l'autre moitié, celle
 *  qu'un test unitaire ne voit jamais — que le nombre atteigne vraiment l'écran,
 *  et **qu'il n'atteigne que les bonnes lignes**.
 *
 *  ⚠️ LA FIXTURE A DÛ ÊTRE CRÉÉE POUR CE TEST, et ça dit quelque chose du sujet.
 *  La production ne compte que 4 lignes `rehab`, aucune avec un tempo : le score
 *  n'a donc, à ce jour, aucune ligne réelle où s'afficher. On a ajouté au mock
 *  la ligne qui manquait (« FENTES BULGARE », tempo `3010`, 3×12) — sans quoi la
 *  fonctionnalité serait invérifiable autrement qu'en lisant le code.
 */

/** ⚠️ ON VISE PAR L'INFOBULLE, PAS PAR LE TEXTE, et c'est ce qui rend ces specs
 *  fiables. Viser le nom de l'exercice ramenait DEUX éléments — la ligne, mais
 *  aussi la pastille des « objectifs du bloc » en haut d'écran — et remonter de
 *  là menait à un conteneur si large qu'il englobait les autres lignes. La spec
 *  « pas de score sur l'entraînement » passait alors au rouge en voyant le score
 *  de la ligne kiné, c'est-à-dire en accusant le mauvais coupable.
 *
 *  L'infobulle, elle, n'existe QUE sur le score. On l'épingle donc au passage —
 *  c'est la seule explication que le lecteur ait de ce que « mt » veut dire. */
const scores = (page: Page) => page.getByTitle(/Mécanotransduction/);

const ouvrirLaSeanceDuHaut = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: /Semaine 1/ }).first().click();
  await page.getByRole('button', { name: /Haut du corps/ }).first().click();
};

test('la ligne « Kiné » affiche son score', async ({ page }) => {
  await ouvrirLaSeanceDuHaut(page);

  // 3+0+1+0 = 4, × 12 répétitions = 48.
  await expect(scores(page)).toHaveText(['· mt 48']);

  // Et il est bien SUR la ligne kiné — trois divs au-dessus du score se trouve
  // la ligne d'exercice, qui doit porter son nom et son tempo.
  const ligne = scores(page).locator('xpath=ancestor::div[3]');
  await expect(ligne).toContainText('FENTES BULGARE');
  await expect(ligne).toContainText('tempo 3010');
});

test('les lignes d’ENTRAÎNEMENT n’en portent pas, même avec un tempo', async ({ page }) => {
  /** ⚠️ L'ASSERTION QUI PORTE LA DEMANDE, et la seule que le calcul ne peut pas
   *  garder seul. Cette séance contient « MUSCLE UP » (tempo `30X0`, 3 reps) et
   *  « PULL UP » (tempo `3-0-1-0`) : le premier serait parfaitement calculable
   *  (3+0+0 = 3, × 3 = 9). Il ne doit PAS s'afficher, parce que la métrique
   *  appartient au travail de rééducation.
   *
   *  D'où le compte EXACT plutôt qu'une absence ponctuelle : un seul score dans
   *  toute la séance. Une garde `kind === 'rehab'` retirée par mégarde rougirait
   *  ici, là où la première spec resterait verte. */
  await ouvrirLaSeanceDuHaut(page);

  await expect(scores(page)).toHaveCount(1);
});
