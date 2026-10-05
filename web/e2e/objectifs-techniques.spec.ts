import { expect, test, type Page } from '@playwright/test';

/** LES OBJECTIFS TECHNIQUES PAR MOUVEMENT (FRE-122).
 *
 *  ⚠️ CE QUE CES SPECS GARDENT, ET CE N'EST PAS « la pastille s'affiche ». Trois
 *  décisions qui se sont révélées fragiles en construisant l'écran :
 *
 *    1. la pastille existe DANS LES DEUX MODES. Posée d'abord dans la seule
 *       branche d'édition, elle ne s'affichait qu'en mode coach — c'est-à-dire
 *       jamais pour son destinataire. Trois branches rendent une ligne ;
 *    2. elle ne compte que les objectifs OUVERTS. Un signal qui ne s'éteint
 *       jamais cesse d'en être un ;
 *    3. les gestes d'écriture suivent la BASCULE D'APERÇU, pas seulement la
 *       permission : en « Athlete », le coach prévisualise l'écran de son
 *       athlète, et un formulaire y ferait mentir l'aperçu.
 *
 *  Le mock porte les trois cas nécessaires : MUSCLE UP avec DEUX ouverts, SQUAT
 *  avec un ouvert et un CLOS, et le reste sans aucun.
 */

async function ouvrirLaSeance(page: Page) {
  await page.goto('/training');
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran, et la replier ne laissait qu'un en-tête au-dessus du vide. Le clic
  // n'a plus de cible : l'en-tête est redevenu un simple titre.
  await expect(page.getByText('MUSCLE UP').first()).toBeVisible();
}

const pastille = (page: Page) => page.getByRole('button', { name: /objectifs? techniques? sur/i });

test('la pastille dit COMBIEN d’objectifs sont ouverts, pas seulement qu’il y en a', async ({ page }) => {
  await ouvrirLaSeance(page);

  // ⚠️ « 2 » ET NON « au moins un » : « il y a des objectifs » et « il y en a
  // deux » ne demandent pas le même geste — le premier se lit, le second se
  // déplie. Et c'est le compte des OUVERTS : SQUAT en a un clos qui ne doit
  // jamais grossir un total.
  await expect(pastille(page)).toHaveAccessibleName('2 objectifs techniques sur MUSCLE UP');
});

test('la pastille est là POUR L’ATHLÈTE, pas seulement pour le coach', async ({ page }) => {
  /** ⚠️ LA SPEC QUI A ATTRAPÉ LE VRAI DÉFAUT. Le tableau rend une ligne par
   *  trois branches — l'athlète (dense, pensée pour le téléphone posé sur un
   *  banc), le coach en édition, et la lecture seule. La pastille posée dans une
   *  seule les laisse muettes.
   *
   *  Le mode « Athlete » est celui par défaut : c'est donc l'écran que voit
   *  d'abord le destinataire de la correction. */
  await ouvrirLaSeance(page);
  // ⚠️ « Athlète » AVEC L'ACCENT : le harnais tourne en français, la langue par
  // défaut — pas celle du navigateur du développeur.
  await expect(page.getByRole('button', { name: 'Athlète', exact: true })).toBeVisible();

  await expect(pastille(page)).toBeVisible();
});

test('un mouvement SANS objectif n’a pas de pastille', async ({ page }) => {
  /** ⚠️ LE CONTRE-EXEMPLE, ET IL PORTE PLUS QUE LE CAS PASSANT. Une pastille
   *  présente partout, éteinte la plupart du temps, coûterait sa place sur chaque
   *  ligne du tableau pour l'information « non ». */
  await ouvrirLaSeance(page);

  // La séance porte plusieurs exercices ; un seul a des objectifs.
  await expect(pastille(page)).toHaveCount(1);
});

test('la pastille déplie les objectifs du mouvement', async ({ page }) => {
  await ouvrirLaSeance(page);
  await pastille(page).click();

  const popup = page.getByRole('dialog', { name: /MUSCLE UP/ });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Garde les coudes hauts à la transition.');
  await expect(popup).toContainText('Ne casse pas les poignets en fin de tirage.');
});

test('le journal groupe par mouvement et GARDE les objectifs clos', async ({ page }) => {
  /** ⚠️ CLORE N'EFFACE PAS — c'est ce qui distingue un journal d'un bloc-notes.
   *  « On a réglé les talons au sol en juillet » est une information, et
   *  l'effacer la perd. Le clos reste donc lisible ici, alors qu'il ne compte
   *  pas dans la pastille. */
  await page.goto('/training');
  await page.getByRole('button', { name: /Objectifs techniques/ }).click();

  await expect(page.getByText('Garde les talons au sol.')).toBeVisible();
  await expect(page.getByText('Descends sous la parallèle, même chargé.')).toBeVisible();
});

test('un objectif clos porte SA DATE, et un ouvert dit depuis quand', async ({ page }) => {
  /** ⚠️ LE DÉFAUT CENTRAL DE L'ÉCRAN (FRE-122, deuxième passe). Le serveur avait
   *  construit un journal — son schéma dit « `closLe` EST UNE DATE, PAS UN
   *  BOOLÉEN » — et le front en avait fait une liste à cocher : il lisait
   *  `closLe !== null` pour choisir une opacité, et jetait la date. « On a réglé
   *  ça » sans savoir quand ne raconte rien.
   *
   *  MUTATION QUI ROUGIT : rendre `closLe` en booléen (le code d'avant) supprime
   *  les deux libellés. */
  await page.goto('/training');
  await page.getByRole('button', { name: /Objectifs techniques/ }).click();

  // ⚠️ `toBeVisible`, PAS `toContainText`. Première version de cette spec :
  // `toContainText` lit `textContent`, qui voit le contenu MASQUÉ — la mutation
  // (les dates en `hidden`) la laissait verte. Une spec qui ne peut pas rougir
  // est fausse, et celle-ci l'était.
  const clos = page.locator('li', { hasText: 'Garde les talons au sol.' }).last();
  await expect(clos.getByText(/Réglé le \d+/)).toBeVisible();
  const ouvert = page.locator('li', { hasText: 'Descends sous la parallèle' }).last();
  await expect(ouvert.getByText(/Posé le \d+/)).toBeVisible();
});

test('en aperçu ATHLÈTE, le coach ne voit aucun geste d’écriture', async ({ page }) => {
  /** ⚠️ LA RÈGLE D'AFFORDANCE, APPLIQUÉE À L'APERÇU. Le serveur accepterait
   *  l'écriture (c'est bien le coach), mais le mode « Athlete » sert à voir
   *  l'écran de l'athlète : y laisser le formulaire ferait mentir la seule chose
   *  que cette bascule promet. */
  await page.goto('/training');
  await page.getByRole('button', { name: /Objectifs techniques/ }).click();

  await expect(page.getByRole('button', { name: 'Poser' })).toHaveCount(0);
  await expect(page.getByLabel("Texte de l'objectif")).toHaveCount(0);
});

test('en mode COACH, le journal propose de poser et de clore', async ({ page }) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: /Objectifs techniques/ }).click();

  // ⚠️ LE FORMULAIRE NE S'OUVRE PLUS D'OFFICE. Il occupait le haut du panneau dès
  // qu'on avait le droit d'écrire ; on pose un objectif deux fois par bloc et on
  // lit le journal tous les jours. C'est « Poser » qui l'ouvre maintenant — et ce
  // bouton reste le signal que le geste existe, ce que cette spec garde.
  await expect(page.getByLabel('Texte de l’objectif')).toHaveCount(0);
  await page.getByRole('button', { name: 'Poser' }).click();
  await expect(page.getByLabel('Texte de l’objectif')).toBeVisible();
  // Clore est le geste COURANT — il doit être à portée de main, contrairement à
  // la suppression, réservée aux fautes.
  await expect(page.getByRole('button', { name: /^Clore/ }).first()).toBeVisible();
});
