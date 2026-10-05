import { expect, test, type Page } from '@playwright/test';

/** LES REPS ET LA CHARGE SE SAISISSENT PAR SÉRIE (demande du 06/09).
 *
 *  ⚠️ LE BESOIN ÉTAIT DÉJÀ ÉCRIT À LA MAIN. 73 lignes de production portent
 *  « 10/11/12 » dans le champ unique `repsDone`, et la projection du suivi n'en
 *  lit que la PREMIÈRE valeur : 3 × 10 × 8 = 240 kg au lieu de 264. Ce n'est
 *  donc pas un confort, ça répare un sous-comptage silencieux.
 *
 *  ⚠️ LA MOYENNE RESTE CE QUE TOUT LE MONDE LIT. `repsDone` et `weightDone`
 *  reçoivent la moyenne des séries : le tableau du coach, l'Aperçu et les images
 *  de partage continuent d'afficher un chiffre unique, sans qu'un seul écran de
 *  lecture ait changé. Le TONNAGE, lui, se calcule côté serveur comme une somme
 *  de produits — `test_etl_training_sets.py` le tient, et c'est là que ça
 *  compte.
 *
 *  ⚠️ ET LES TROIS TABLEAUX SUIVENT LA MÊME SÉRIE ACTIVE. Donner un sélecteur à
 *  chacun aurait laissé noter le RPE de la série 3 en saisissant les reps de la
 *  1 — trois curseurs pour une seule réalité.
 */

async function ouvrirLaSeance(page: Page) {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: 'Semaine 1' }).first().click();
  await page.getByRole('button', { name: 'Détail' }).click();
  await page.getByRole('button', { name: /Haut du corps/ }).first().click();
}

/** Rangs : 0 MUSCLE UP · 1 PULL UP · 2 ROWING (3 × 10) · 3 FACE PULL ·
 *  4 CHINESE PLANK. On vise ROWING : plusieurs séries, en répétitions. */
const deplier = (page: Page, rang: number) =>
  page.getByTitle(/Voir notes|Ajouter une note/).nth(rang).click();

const basculeParSerie = (page: Page) =>
  page.getByRole('button', { name: /^(PAR SÉRIE|PER SET)$/i });

const champReps = (page: Page) => page.getByRole('textbox', { name: /Rép\. réelles|Actual reps/ });
const champCharge = (page: Page) => page.getByRole('textbox', { name: /Charge réelle|Actual load/ });

test('hors « par série », les champs restent ceux de la LIGNE', async ({ page }) => {
  await ouvrirLaSeance(page);
  await deplier(page, 2);

  // ⚠️ LE CHEMIN COURANT NE DOIT RIEN COÛTER. 86 % des lignes n'ont pas besoin
  // du détail ; si la bascule était ouverte d'office, tout le monde paierait un
  // sélecteur pour servir la minorité.
  await expect(champReps(page)).toBeVisible();
  await expect(basculeParSerie(page)).toHaveAttribute('aria-pressed', 'false');
});

test('« par série » fait porter les DEUX champs sur la série active', async ({ page }) => {
  await ouvrirLaSeance(page);
  await deplier(page, 2);
  await basculeParSerie(page).click();

  // Le libellé dit sur quelle série on écrit — sinon on saisit à l'aveugle.
  // Titres courts depuis le 13/09 — l'étape dit déjà « réellement fait ».
  await expect(page.getByText(/Répétitions — série 1|Reps — set 1/)).toBeVisible();
  await expect(page.getByText(/Charge \(kg\) — série 1|Load \(kg\) — set 1/)).toBeVisible();
  await expect(champReps(page)).toBeVisible();
  await expect(champCharge(page)).toBeVisible();
});

test('la saisie série par série remonte sa MOYENNE dans la ligne', async ({ page }) => {
  await ouvrirLaSeance(page);
  await deplier(page, 2);
  await basculeParSerie(page).click();

  // Série 1 : 12 répétitions.
  await champReps(page).fill('12');
  await champReps(page).blur();

  // Série 2 : 10. La moyenne de la ligne doit alors valoir 11.
  // ⚠️ PAR LE `title` : le nom accessible d'une pastille est son CONTENU
  // (« 2· », le rang suivi de la valeur saisie), pas son infobulle.
  await page.getByTitle(/Série 2|Set 2/).click();
  await champReps(page).fill('10');
  await champReps(page).blur();

  // ⚠️ C'EST LA MOYENNE QUI S'AFFICHE, ET ELLE RESTE SOUS LES YEUX PENDANT LA
  // SAISIE. Sans elle, ouvrir « par série » faisait disparaître le chiffre que
  // l'athlète venait de lire, et il ne savait plus si sa saisie tenait.
  await expect(page.getByText(/moy\. 11|avg\. 11/)).toBeVisible();
});

test('la charge suit la même série que les reps et le RPE', async ({ page }) => {
  await ouvrirLaSeance(page);
  await deplier(page, 2);
  await basculeParSerie(page).click();

  await page.getByTitle(/Série 3|Set 3/).click();
  await champCharge(page).fill('60');
  await champCharge(page).blur();

  // ⚠️ UN SEUL CURSEUR POUR LES TROIS TABLEAUX : après avoir écrit la charge de
  // la série 3, le champ des reps doit encore parler de la série 3. Deux
  // sélecteurs indépendants auraient laissé les deux valeurs sur des séries
  // différentes sans que rien ne le signale.
  await expect(page.getByText(/Répétitions — série 3|Reps — set 3/)).toBeVisible();
  await expect(champCharge(page)).toHaveValue('60');
});
