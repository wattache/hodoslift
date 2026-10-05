import { expect, test, type Page } from '@playwright/test';

/** Bi-set : deux lignes reliées par le même `groupId` (FRE-31).
 *
 *  Le lien était visible dans le tableau du coach et dans l'Aperçu, mais PAS
 *  dans la vue « Détail » — celle de l'athlète, à qui l'information sert le
 *  plus. `session-table.tsx` a deux chemins de rendu et seul celui du coach
 *  portait la barre ; la numérotation, elle, groupait déjà correctement, ce qui
 *  rendait l'oubli d'autant plus discret.
 *
 *  Fixture : semaine 2 du bloc Accumulation — CURL BICEPS + EXTENSION TRICEPS
 *  partagent `biset-s1-2-3`. */

const ouvrirLaSemaine2 = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: /Semaine 2/ }).click();
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026) — et cette semaine n'en porte
  // qu'une, donc pas de bandeau pour la choisir : il n'y a plus rien à cliquer.
};

test('le bi-set est signalé dans la vue Détail', async ({ page }) => {
  await ouvrirLaSemaine2(page);

  await expect(page.getByText('CURL BICEPS')).toBeVisible();
  // Une barre par ligne du groupe — et seulement pour elles : la séance porte
  // aussi MUSCLE UP et PULL UP, qui ne sont liés à rien.
  await expect(page.locator('[data-group-marker]')).toHaveCount(2);
});

/* --- Séries et repos partagés (FRE-31) ----------------------------------- */

const passerEnCoach = async (page: Page) => {
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
};

test('un bi-set n’a qu’une case séries et une case repos', async ({ page }) => {
  await ouvrirLaSemaine2(page);
  await passerEnCoach(page);

  // 4 exercices, dont 2 liés → 3 cases seulement. Séries et repos décrivent le
  // TOUR (A puis B, repos, N fois), pas chaque exercice.
  await expect(page.getByLabel('Séries')).toHaveCount(3);
  // Le repos vit dans le dépli (brief coach, 27/09) : une ligne à la fois.
  let repos = 0;
  for (const rangee of await page.locator('[data-ligne]').all()) {
    repos += await rangee.getByLabel('Repos').count();
  }
  expect(repos).toBe(3);
});

test('la valeur saisie se propage aux deux lignes du bi-set', async ({ page }) => {
  await ouvrirLaSemaine2(page);
  await passerEnCoach(page);

  // Le TONNAGE discrimine sans avoir à lire la ligne masquée : à 3 séries la
  // séance pèse 1,4 t ; à 7 sur les DEUX lignes du bi-set elle passe à 2,3 t.
  // Si la propagation manquait, seule la première ligne changerait et on
  // obtiendrait 1,9 t — un test qui sait donc échouer sur le bon défaut.
  await expect(page.getByText('1.4 t').first()).toBeVisible();

  await page.getByLabel('Séries').last().fill('7');
  await page.getByLabel('Séries').last().blur();

  await expect(page.getByText('2.3 t').first()).toBeVisible();
});

test('le bi-set s’affiche comme un BLOC, dans Détail et dans Aperçu', async ({ page }) => {
  await ouvrirLaSemaine2(page);

  // Vue DÉTAIL : un en-tête annonce le bloc, et AUCUNE des deux lignes ne
  // répète les séries ni le repos — ils appartiennent au tour, pas aux exos.
  // Depuis la maquette 2a (FRE-116), l'en-tête écrit ses champs ÉTIQUETÉS :
  // « 3 TOURS · 2' REPOS », et plus une phrase « 3 séries · repos 2' ».
  const entete = page.getByText('BI-SET', { exact: true }).locator('..');
  await expect(entete).toBeVisible();
  await expect(entete).toContainText(/3tours/i);
  await expect(entete).toContainText(/2'repos/i);
  await expect(page.getByText(/^3×12/)).toHaveCount(0);
  // Aucune des deux lignes ne répète le repos du tour (les lignes hors groupe,
  // elles, gardent le leur — d'où la durée dans le motif).
  await expect(page.getByText(/· repos 2'$/)).toHaveCount(0);

  // Vue APERÇU : même bloc, autre rendu — la règle vit dans `lib/groupe`.
  await page.getByRole('button', { name: /Overview|Aperçu/ }).click();
  await expect(page.getByText('BI-SET', { exact: true })).toBeVisible();
  await expect(page.getByText('3 × 12')).toHaveCount(0);
});

/* --- Lier depuis la BASE (FRE-31) ---------------------------------------- */

const ouvrirLaBase = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Intensification' }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
};

test('lier deux accessoires dans la BASE, et le report à la génération', async ({ page }) => {
  await ouvrirLaBase(page);

  // Le geste n'est offert QUE sur les accessoires — aucun principe n'en a.
  await expect(page.getByRole('button', { name: 'Lier au suivant' })).toHaveCount(1);
  // Le libellé compte autant que l'existence : la 1re version était une icône
  // de 12 px à 40 % d'opacité — présente, testée… et introuvable à l'usage.
  await expect(page.getByRole('button', { name: 'Lier au suivant' })).toContainText('Lier en bi-set');
  // La nature d'un groupe se choisit dans une LISTE depuis FRE-116 (six natures
  // ne se basculent plus d'un clic) : c'est elle qui dit qu'un groupe existe.
  const nature = page.getByRole('combobox', { name: 'Nature du groupe' });
  await expect(nature).toHaveCount(0);

  await page.getByRole('button', { name: 'Lier au suivant' }).click();

  // Le bloc apparaît dans la BASE, et il naît bi-set.
  await expect(nature).toHaveCount(1);
  await expect(nature).toHaveValue('biset');
  // ⚠️ LE REPORT DANS LA SEMAINE GÉNÉRÉE NE SE VÉRIFIE PLUS ICI. Il l'était par
  // l'aperçu, tant que la génération vivait dans le front ; elle est passée
  // côté serveur le 26/08, et l'aperçu du dev-mock n'a personne à interroger.
  // La garantie n'est pas perdue, elle a changé d'adresse :
  // `brokkr/tests/test_generation_semaine.py::test_un_bi_set_de_la_BASE_se_refabrique_dans_la_semaine`,
  // qui vérifie en plus ce que l'écran ne montrait pas — que l'identifiant de
  // groupe est NEUF, et non celui de la BASE.
});

test('défaire le bi-set le retire de la BASE et de la génération', async ({ page }) => {
  await ouvrirLaBase(page);
  await page.getByRole('button', { name: 'Lier au suivant' }).click();
  const nature = page.getByRole('combobox', { name: 'Nature du groupe' });
  await expect(nature).toHaveCount(1);

  await page.getByRole('button', { name: 'Défaire le bi-set' }).first().click();

  // Les DEUX lignes sont déliées — pas seulement celle sur laquelle on a cliqué,
  // sinon la seconde resterait avec un groupe orphelin.
  await expect(nature).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Lier au suivant' })).toHaveCount(1);
});
