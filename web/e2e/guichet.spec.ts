import { expect, test, type Page } from '@playwright/test';

/** LE GUICHET DU COACH — la file de travail qui se vide (brief du 12/09).
 *
 *  ⚠️ CE QUE CES SPECS GARDENT, ET CE N'EST PAS « l'écran s'affiche » :
 *
 *    1. l'écran NE DÉCIDE PAS DE L'ORDRE — la douleur vient en tête parce que
 *       le serveur (ici le mock) la met en tête ;
 *    2. « Vu · suivant » fait AVANCER la file, jusqu'à l'écran vide, qui est
 *       affirmatif et non un chargement raté ;
 *    3. « Plus tard » ne marque RIEN : le dossier passe en queue, le compte ne
 *       bouge pas ;
 *    4. « Ouvrir la séance » mène à la BONNE séance, sans marquer vu ;
 *    5. sur 390 px, l'action principale fait 50 px et rien ne déborde.
 *
 *  Le mock porte les trois types de dossier ; la file vide s'atteint par le
 *  raccourci documenté dans `mock.ts` (la semaine part avec la dernière séance).
 */

const vu = (page: Page) => page.getByRole('button', { name: /Vu · suivant/ });
const plusTard = (page: Page) => page.getByRole('button', { name: 'Plus tard' });
/** La CARTE courante — pas la sidebar, qui porte aussi les noms. */
const carte = (page: Page) => page.locator('main section').first();

test('sur grand écran, un coach atterrit sur le guichet', async ({ page }) => {
  // Le mock est coach ET athlète : sur grand écran, `/` mène à la file. Les
  // autres cases de la table d'`Accueil` : ci-dessous au téléphone, et le harnais
  // réel pour l'athlète seul (`accueil.spec.ts`).
  await page.goto('/');
  await expect(page).toHaveURL(/\/guichet$/);
  await expect(page.getByRole('heading', { name: /Ce qui t’attend/ })).toBeVisible();
});

test.describe('au téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('le coach qui est aussi athlète arrive sur SA semaine, pas sur le guichet', async ({ page }) => {
    /** William, 14/09 : au téléphone on ouvre l'app pour s'entraîner. Le mock
     *  est coach ET Léa. La dernière sélection est Théo — un athlète ouvert
     *  depuis le guichet — et c'est la semaine de Léa qui doit s'ouvrir.
     *  MUTATIONS QUI ROUGISSENT : retirer la branche téléphone (URL /guichet) ;
     *  retirer `setSelectedId` (Théo reste affiché). */
    await page.addInitScript(() => localStorage.setItem('eitri-selected-athlete:mock-coach', 'mock-theo'));
    await page.goto('/');
    await expect(page).toHaveURL(/\/training$/);
    await expect(page.getByRole('button', { name: /Léa Martin/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Théo/i })).toHaveCount(0);
  });
});

test('la douleur vient EN TÊTE, et l’en-tête compte par type', async ({ page }) => {
  await page.goto('/guichet');
  await expect(carte(page)).toContainText('Signalement ·');
  // ⚠️ LA DOULEUR A UN NOM ET UNE ZONE DEPUIS FRE-195, là où le questionnaire
  // rendait du texte libre. Ce que le coach lit d'abord : combien, et sur quoi.
  await expect(carte(page)).toContainText('Genou droit');
  await expect(carte(page)).toContainText('/10');
  // Et « ça revient », qui change la lecture : une gêne d'un jour ne se traite
  // pas comme une douleur qui s'installe.
  await expect(carte(page)).toContainText(/notée 2 fois|logged 2 times/);
  // Les pilules de l'en-tête : le libellé, puis le compte.
  await expect(page.getByText(/douleur\s+1/)).toBeVisible();
  await expect(page.getByText(/séances\s+2/)).toBeVisible();
  await expect(page.getByText(/semaine\s+1/)).toBeVisible();
  await expect(carte(page).getByText('1 / 4')).toBeVisible();
});

test('« Vu · suivant » fait avancer la file jusqu’à l’écran vide', async ({ page }) => {
  await page.goto('/guichet');
  await vu(page).click();
  // La plus ANCIENNE des deux séances d'abord — l'ordre du serveur, pas celui
  // de l'écran. Et le nom est normalisé à l'affichage.
  await expect(carte(page)).toContainText('Théo Bernard');
  await expect(carte(page)).toContainText('Accumulation · S1');
  // Le RPE moyen DÉPASSE le visé : le cadre ambre de la vue semaine.
  await expect(carte(page).getByText('pour 7 visé')).toBeVisible();
  // 4 210 kg se lisent en tonnes.
  await expect(carte(page).getByText('4.2')).toBeVisible();
  // « restants » compte les SUIVANTS, pas le dossier ouvert : Léa et la semaine.
  await expect(page.getByText(/2 restants/)).toBeVisible();

  await vu(page).click();
  await expect(carte(page)).toContainText('Léa Martin');
  await vu(page).click();
  // Affirmatif — ni squelette, ni « aucun élément ».
  await expect(page.getByText('Rien ne t’attend.')).toBeVisible();
  // Les SIENS (les deux du mock), pas l'annuaire entier — le compte vient du serveur.
  await expect(page.getByText('Tes 2 athlètes sont à jour.')).toBeVisible();
  // Et le bandeau reste, à zéro partout : il dit qu'il n'y a rien de chaque sorte.
  await expect(page.getByText(/douleur\s+0/)).toBeVisible();
  await expect(page.getByText(/séance\s+0/)).toBeVisible();
  await expect(page.getByText(/semaine\s+0/)).toBeVisible();
});

test('« Plus tard » ne marque RIEN : en queue, et le compte ne bouge pas', async ({ page }) => {
  await page.goto('/guichet');
  await plusTard(page).click();
  await expect(carte(page)).toContainText('Théo Bernard');
  // ⚠️ LE COMPTE EST INTACT : reporter n'est pas cocher — et le rang avance.
  await expect(page.getByText(/douleur\s+1/)).toBeVisible();
  await expect(carte(page).getByText('2 / 4')).toBeVisible();
  // Trois « Plus tard » plus loin, la semaine — le dossier sans coche.
  await plusTard(page).click();
  await plusTard(page).click();
  await expect(carte(page)).toContainText('Accumulation · S2 à écrire');
  // Plus d'aperçu du bloc (13/09) : ni pastilles, ni charges de la réalisée.
  await expect(carte(page)).not.toContainText('où il en est');
  await expect(carte(page).getByRole('button', { name: 'Écrire la S2' })).toBeVisible();
  await expect(vu(page)).toHaveCount(0);
  // Et la douleur, reportée en premier, revient en tête de la queue.
  await plusTard(page).click();
  await expect(carte(page)).toContainText('Signalement ·');
});

test('« Ouvrir la séance » mène à la bonne séance, SANS marquer vu', async ({ page }) => {
  await page.goto('/guichet');
  await plusTard(page).click();   // la douleur
  await plusTard(page).click();   // Théo
  await expect(carte(page)).toContainText('Léa Martin');
  await page.getByRole('button', { name: 'Ouvrir la séance' }).click();
  await expect(page).toHaveURL(/\/training\?week=week-3&session=s1$/);
  await expect(page.getByText('Séance 1').first()).toBeVisible();
  // Retour par la navigation (l'état du mock survit) : rien n'a été coché.
  await page.getByRole('link', { name: 'Guichet' }).click();
  await expect(page.getByText(/séances\s+2/)).toBeVisible();
});

test('sur 390 px, l’action principale fait 50 px et rien ne déborde', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/guichet');
  const principale = vu(page);
  await expect(principale).toBeVisible();
  const boite = await principale.boundingBox();
  expect(boite?.height).toBeGreaterThanOrEqual(50);
  expect(boite?.width).toBeGreaterThanOrEqual(300);
  const secondaire = await plusTard(page).boundingBox();
  expect(secondaire?.height).toBeGreaterThanOrEqual(44);
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(deborde).toBe(0);
});
