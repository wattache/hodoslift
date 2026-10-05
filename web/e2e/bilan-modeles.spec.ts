import { expect, test } from '@playwright/test';

/** LE CATALOGUE DES MODÈLES DE BILAN — `/bilan-modeles`.
 *
 *  ⚠️ LE COMPOSEUR N'EST PLUS HORS DE PORTÉE — cet en-tête disait le contraire
 *  jusqu'au 25/08, et il avait tort pour une raison qu'il ne soupçonnait pas.
 *  Ce n'était pas « le dev-mock n'a pas de serveur » : c'était `useBilanModele`
 *  qui portait `enabled: … && !isMock`, donc une requête DÉSACTIVÉE plutôt
 *  qu'une fixture absente. Cliquer un modèle ouvrait une page blanche, et
 *  l'écran où la kiné compose ses tests échappait au seul harnais qui traverse
 *  l'interface. Une fixture (`mockBilanModele`) a suffi.
 *
 *  Ce qui reste vrai : les ÉCRITURES du mock sont des no-op. On garde donc ce
 *  que l'écran AFFICHE, pas ce qu'il enregistre — la persistance relève du
 *  harnais réel (`e2e-reel/bilan.spec.ts`).
 *
 *  Ce qui est gardé quand même compte : que la page existe, qu'elle liste les
 *  modèles avec leur nombre de tests, et surtout que DUPLIQUER soit offert LÀ OÙ
 *  L'ON CRÉE. C'est la voie normale de composition (spec §6) — personne ne
 *  recompose 32 tests à la main.
 *
 *  ⚠️ CETTE SPEC A CHANGÉ D'AVIS LE 25/08, ET IL FAUT DIRE POURQUOI. Elle
 *  gardait l'inverse : une icône « dupliquer » sur CHAQUE ligne, au nom de
 *  l'argument « la cacher dans un menu suffirait à ce que personne ne
 *  l'utilise ». L'usage a tranché contre cet argument — Thomas (kiné) a cherché
 *  à repartir d'un modèle existant, a cliqué « + Modèle vide », n'a rien vu, et
 *  a conclu que la fonctionnalité avait DISPARU. Elle était à deux centimètres.
 *
 *  Ce que le cas apprend : on ne cherche pas « dupliquer » sur la ligne de
 *  l'objet source, mais au bouton de CRÉATION — puisque c'est un objet neuf
 *  qu'on veut. D'où le menu, et d'où la même mécanique que « + Bloc » côté
 *  entraînement (`AjouterAvecMenu`, partagé).
 */

test('le catalogue liste les modèles avec leur nombre de tests', async ({ page }) => {
  await page.goto('/bilan-modeles');

  await expect(page.getByRole('heading', { name: 'Modèles de bilan' })).toBeVisible();

  const complet = page.getByRole('button', { name: /Bilan complet Tests généraux/ });
  await expect(complet).toBeVisible();
  await expect(complet).toContainText('32 tests');

  // Un second modèle : c'est la preuve que la page en gère PLUSIEURS, ce qui est
  // toute la raison du chantier — le bilan du cycliste n'est pas celui du
  // streetlifteur.
  await expect(page.getByRole('button', { name: /Cycliste Bilan court/ }))
    .toContainText('8 tests');
});

test('« + Modèle » propose de partir de zéro OU de dupliquer', async ({ page }) => {
  await page.goto('/bilan-modeles');

  // ⚠️ RIEN NE DOIT ÊTRE VISIBLE AVANT LE CLIC, sinon la spec passerait aussi
  // bien avec deux boutons côte à côte qu'avec un menu — elle ne garderait plus
  // le geste, seulement la présence des mots.
  await expect(page.getByRole('menuitem', { name: 'Modèle vide' })).toBeHidden();

  await page.getByRole('button', { name: 'Modèle', exact: true }).click();

  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Modèle vide' })).toBeVisible();

  // ⚠️ ET LES DEUX MODÈLES Y SONT, chacun duplicable. C'est l'assertion qui
  // porte le correctif : la duplication n'est plus une icône posée ailleurs,
  // elle est dans le menu de création, à côté de la page blanche.
  await expect(menu.getByText('Dupliquer un modèle')).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Bilan complet/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Cycliste/ })).toBeVisible();
});

test('archiver est proposé, et se dit comme un retrait réversible', async ({ page }) => {
  await page.goto('/bilan-modeles');

  // ⚠️ ARCHIVER EST LE GESTE PRINCIPAL, la suppression l'exception : un modèle
  // utilisé par des bilans ne se supprime pas (le serveur refuse), sans quoi le
  // lien qui relie ces bilans entre eux disparaîtrait en silence. L'infobulle
  // doit donc dire que les bilans sont conservés — c'est ce qui permet d'oser.
  const archiver = page.getByTitle(/Archiver/).first();
  await expect(archiver).toBeVisible();
  await expect(archiver).toHaveAttribute('title', /bilans conservés/);
});


test('ouvrir un modèle montre ses rubriques et ses tests', async ({ page }) => {
  /** ⚠️ LA SPEC QUI MANQUAIT, et son absence se voyait à l'écran : cliquer un
   *  modèle n'affichait RIEN en dev-mock, sans que rien ne le signale.
   *
   *  Ce qu'elle garde au-delà du contenu : le bandeau qui dit que modifier un
   *  modèle n'atteint que les PROCHAINS bilans. Sans cette phrase, on n'ose pas
   *  corriger une charge de peur d'abîmer l'historique — et le modèle se fige
   *  par prudence plutôt que par choix (§3.1). */
  await page.goto('/bilan-modeles');
  await page.getByRole('button', { name: /Bilan complet/ }).first().click();

  // ⚠️ APOSTROPHE DROITE : la source écrit `n'affecte`, pas `n’affecte`. Les
  // deux se ressemblent à l'œil et jamais au sélecteur.
  await expect(page.getByText(/n'affecte que les/)).toBeVisible();
  // ⚠️ LE LIBELLÉ D'UNE RUBRIQUE EST UN CHAMP ÉDITABLE — sa valeur ne figure
  // donc pas dans le texte du DOM, et `getByText` ne la trouve pas. Deux autres
  // pièges se cumulaient au même endroit : la capitale de « TESTS GÉNÉRAUX »
  // vient d'un `text-transform` CSS que Playwright ne voit pas (comme « Lesté »
  // dans `variantes.spec.ts`), et le champ n'avait AUCUN nom accessible — il a
  // fallu lui en donner un pour pouvoir le désigner, ce qui répare au passage
  // ce qu'un lecteur d'écran en entendait : « zone de texte », rien de plus.
  await expect(page.getByRole('textbox', { name: /Libellé de la rubrique/ }).first())
    .toHaveValue('Tests généraux');
  await expect(page.getByText('Squat overhead')).toBeVisible();
  await expect(page.getByText('Grip')).toBeVisible();

  // ⚠️ UN TEST RETIRÉ RESTE VISIBLE, EN GRISÉ. Il ne part plus dans les nouveaux
  // bilans mais doit rester retrouvable et réactivable : le faire disparaître
  // transformerait un retrait en suppression, ce que le serveur refuse justement.
  await expect(page.getByText(/Gainage latéral/)).toBeVisible();
});
