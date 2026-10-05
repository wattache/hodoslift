import { expect, test, type Page } from '@playwright/test';

/** Nature d'une ligne : entraînement / échauffement / kiné (FRE-10).
 *
 *  Le point qui mérite d'être verrouillé n'est pas l'affichage mais le TONNAGE :
 *  brokkr exclut déjà les lignes non-`training` de ses agrégats, donc si l'app
 *  les comptait encore, elle afficherait un chiffre que le Tracking contredit —
 *  exactement ce que FRE-20 a coûté à réparer une couche plus bas.
 *
 *  Fixture : la séance du jour contient un MUSCLE UP 4×2 @ 9 kg = 72 kg. */

const passerEnCoach = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
};

/** Le contrôle de nature est un BOUTON qui cycle, plus une liste déroulante :
 *  celle-ci mangeait 90 px de large pour une information que 96 % des lignes
 *  n'ont pas, et tronquait le nom de l'exercice à « P… ». Son état se lit donc
 *  dans son libellé accessible, pas dans une `value`. */
const boutonNature = (page: Page) => page.getByRole('button', { name: /^Nature de/ }).first();

const natureAffichee = async (page: Page): Promise<string> => {
  const label = await boutonNature(page).getAttribute('aria-label') ?? '';
  return label.split(' : ')[1]?.split('.')[0] ?? '';
};

test('une ligne est « entraînement » par défaut', async ({ page }) => {
  await passerEnCoach(page);

  // Absent = entraînement : les lignes existantes n'ont pas le champ.
  expect(await natureAffichee(page)).toBe('Entraînement');
});

test('passer une ligne en échauffement la sort du tonnage', async ({ page }) => {
  await passerEnCoach(page);
  await expect(page.getByText('72').first()).toBeVisible();

  // Un clic fait passer au suivant du cycle : entraînement → échauffement.
  await boutonNature(page).click();

  // 72 kg de MUSCLE UP ne comptent plus : c'est de l'échauffement.
  await expect(page.getByText('72')).toHaveCount(0);
  expect(await natureAffichee(page)).toBe('Échauffement');
});

test('le bouton bascule toute la séance, et sait revenir', async ({ page }) => {
  await passerEnCoach(page);

  // Le coach voit toute la semaine depuis FRE-180 : le bouton de la PREMIÈRE séance.
  await page.getByRole('button', { name: 'Toute la séance en échauffement' }).first().click();
  expect(await natureAffichee(page)).toBe('Échauffement');

  // Le même bouton sert de retour arrière — pas de second contrôle à trouver.
  await page.getByRole('button', { name: 'Repasser la séance en entraînement' }).first().click();
  expect(await natureAffichee(page)).toBe('Entraînement');
  await expect(page.getByText('72').first()).toBeVisible();
});

test('l’athlète voit une pastille sur les lignes qui ne sont pas de l’entraînement', async ({ page }) => {
  await passerEnCoach(page);
  await boutonNature(page).click();   // → échauffement

  // Côté athlète, pas de contrôle : une pastille suffit à dire ce que c'est.
  await page.getByRole('button', { name: /^Athlète$/ }).click();
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran, et la replier ne laissait qu'un en-tête au-dessus du vide. Le clic
  // n'a plus de cible : l'en-tête est redevenu un simple titre.
  await expect(page.getByText('ÉCHAUF.', { exact: true })).toBeVisible();
});

test('aucune pastille sur une ligne d’entraînement', async ({ page }) => {
  await page.goto('/training');

  // Le cas courant ne se signale pas : ce serait du bruit sur chaque ligne.
  await expect(page.getByText('ÉCHAUF.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('KINÉ', { exact: true })).toHaveCount(0);
});

/* --- La NATURE dans la BASE, et son report dans la semaine générée --------- */

/** Ouvre l'éditeur de BASE du bloc Accumulation, qui a déjà un principe
 *  MUSCLE UP avec son tier — donc un aperçu de semaine non vide. */
const ouvrirLaBase = async (page: Page) => {
  await passerEnCoach(page);
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
};

const natureDuPrincipe = (page: Page) => page.getByLabel('Nature de MUSCLE UP');

test('un principe de la BASE porte une nature, « entraînement » par défaut', async ({ page }) => {
  await ouvrirLaBase(page);

  await expect(natureDuPrincipe(page)).toHaveValue('training');
});

/** ⚠️ DEUX SPECS ONT QUITTÉ CE FICHIER LE 26/08, et il faut dire où elles sont.
 *  Elles vérifiaient que la nature posée sur un principe se RETROUVE dans la
 *  semaine générée — par l'aperçu, tant que la génération vivait dans le front.
 *  Elle est passée côté serveur : le dev-mock n'a plus personne à interroger.
 *
 *  La garantie tient toujours, ailleurs :
 *  `brokkr/tests/test_generation_semaine.py::test_la_NATURE_d_un_principe_se_reporte_dans_la_semaine`,
 *  qui garde en plus ce que l'écran ne montrait pas — que « entraînement » reste
 *  `null` et jamais `''`, lequel ferait tomber la semaine entière en 422. */

test('revenir à « entraînement » se voit dans le MODÈLE', async ({ page }) => {
  await ouvrirLaBase(page);
  await natureDuPrincipe(page).selectOption('warmup');
  await expect(natureDuPrincipe(page)).toHaveValue('warmup');

  await natureDuPrincipe(page).selectOption('training');

  await expect(natureDuPrincipe(page)).toHaveValue('training');
});

test('un accessoire de renforcement porte lui aussi une nature', async ({ page }) => {
  await ouvrirLaBase(page);
  await page.getByRole('button', { name: 'Accessoire' }).click();

  // Le renfo est le gisement naturel des lignes de kiné.
  await expect(page.getByLabel('Nature de cet accessoire')).toHaveValue('training');
});
