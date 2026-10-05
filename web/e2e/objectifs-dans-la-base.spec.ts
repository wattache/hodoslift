import { expect, test, type Page } from '@playwright/test';

/** LES OBJECTIFS DU BLOC S'ÉDITENT DEPUIS LA BASE (FRE-11 · demande du 05/09).
 *
 *  ⚠️ CE N'EST PAS UN DÉPLACEMENT DE DONNÉE, C'EST UNE QUESTION DE MOMENT.
 *  `block_objectives` était déjà accroché au bloc, exactement comme la trame —
 *  les deux sont frères en base. Mais l'éditeur ne vivait que dans la vue
 *  SEMAINE, c'est-à-dire APRÈS avoir quitté l'écran où on décide du bloc.
 *  William : « les objectifs on les a en tête quand on fait le bloc, donc quand
 *  on regarde la BASE ».
 *
 *  ⚠️ LA SPEC PART DE LA BARRE DE NAVIGATION, jamais d'une URL tapée. Un
 *  composant rendu dans une branche qu'aucun clic n'atteint passerait au vert
 *  sans être joignable — c'est ce qui avait coûté FRE-127, où le bouton
 *  d'archivage vivait sur une page que plus aucun lien ne desservait.
 *
 *  ⚠️ ET ELLE VISE LE BLOC QUI PORTE DES OBJECTIFS. « Accumulation » en a deux
 *  dans la maquette, dont un atteint ; « Intensification » n'en a aucun. Vérifier
 *  sur le second seul aurait montré l'état VIDE et rien d'autre — le cas où
 *  l'éditeur doit afficher quelque chose ne serait jamais traversé.
 */

const ouvrirLaBaseDu = async (page: Page, bloc: string) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: bloc, exact: true }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  // Repliés par défaut depuis le 13/09 : on déplie avant de lire.
  await page.getByRole('button', { name: /^(Objectifs du bloc|Block objectives)$/ }).click();
};

const objectifs = (page: Page) =>
  page.getByRole('heading', { name: /Objectifs du bloc|Block objectives/ });

test('la BASE porte les objectifs du bloc, avec leur contenu', async ({ page }) => {
  await ouvrirLaBaseDu(page, 'Accumulation');

  // L'éditeur est là, sur l'écran où le coach compose le bloc.
  await expect(objectifs(page)).toBeVisible();

  // Et il porte VRAIMENT les objectifs du bloc courant : le MUSCLE UP de la
  // maquette, pas une coquille vide.
  //
  // ⚠️ PAS `getByRole('cell')` : l'éditeur n'est plus un tableau (refonte des écrans, 09/2026). Neuf
  // colonnes à `min-w-[720px]` pour une donnée qu'on lit dix fois plus qu'on ne
  // l'écrit — c'est une liste de cartes, et le mouvement y est un titre.
  await expect(page.getByRole('listitem').filter({ hasText: 'MUSCLE UP' }).first()).toBeVisible();

  // ⚠️ LA TRAME EST TOUJOURS LÀ, EN DESSOUS. Poser les objectifs au-dessus ne
  // devait pas prendre la place de ce qu'on vient éditer dans cet écran.
  await expect(page.getByRole('heading', { name: /Répartition du cycle|Cycle split/ })).toBeVisible();
});

test('sur un bloc SANS objectif, la base invite quand même à en poser un', async ({ page }) => {
  await ouvrirLaBaseDu(page, 'Intensification');

  // ⚠️ C'EST L'ÉTAT LE PLUS FRÉQUENT : 10 blocs sur 167 portent un objectif en
  // production. Si l'éditeur ne s'affichait que lorsqu'il y a déjà quelque
  // chose, la fonction resterait invisible à 94 % des ouvertures — et le geste
  // qu'on vient d'ajouter n'existerait pas là où il sert.
  await expect(objectifs(page)).toBeVisible();
  await expect(page.getByText(/Aucun objectif pour ce bloc|No objectives for this block/)).toBeVisible();
  // ⚠️ LE GESTE D'AJOUT VIT DERRIÈRE « ÉDITER » (refonte des écrans, 09/2026) : la carte s'ouvre en
  // APERÇU, parce qu'on vient presque toujours y lire. Ce que cette spec garde
  // reste le même — sur un bloc vide, poser un objectif doit être JOIGNABLE — et
  // elle traverse maintenant le chemin réel pour y arriver.
  await page.getByRole('button', { name: /^(Éditer|Edit)$/ }).click();
  await expect(page.getByRole('button', { name: /^(Objectif|Objective)$/ })).toBeVisible();
});

test('la vue SEMAINE garde les siens — rien n’a été déplacé', async ({ page }) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Accumulation', exact: true }).click();

  // Sans passer par la BASE : l'éditeur historique est toujours à sa place.
  await expect(objectifs(page)).toBeVisible();
});

/** ⚠️ LES OBJECTIFS TECHNIQUES NE SONT PAS CEUX DU BLOC, ET LEUR PLACE LE DIT.
 *  Ils suivent l'ATHLÈTE, indépendamment du bloc (William, 05/09) — d'où leur
 *  panneau AU-DESSUS de la barre de programme, hors de la zone qui bascule
 *  entre semaine et base. Ils restent donc éditables dans les deux écrans sans
 *  qu'on ait rien à faire.
 *
 *  Cette spec ne garde pas un ajout : elle garde une propriété STRUCTURELLE que
 *  le premier remaniement de cet écran casserait sans bruit — glisser le
 *  panneau dans la branche `showBase` le ferait disparaître de la vue semaine,
 *  et l'inverse le ferait disparaître de la base. Rien n'échouerait. */
test('les objectifs TECHNIQUES restent éditables dans les deux écrans', async ({ page }) => {
  const panneau = page.getByRole('button', { name: /Objectifs techniques|Technical goals/ });
  // ⚠️ « POSER » PLUTÔT QUE LE CHAMP LUI-MÊME (FRE-122, deuxième passe) : le
  // formulaire ne s'ouvre plus d'office, il se demande. Le bouton reste le signe
  // que le geste d'écriture existe DANS CET ÉCRAN, et c'est ce que garde la spec.
  const gesteDEcriture = page.getByRole('button', { name: /^(Poser|Set a goal)$/ });

  // Vue SEMAINE, en mode coach.
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
  await panneau.click();
  await expect(gesteDEcriture).toBeVisible();

  // Puis la BASE : le panneau ne bouge pas, il est hors de la bascule — et il
  // reste déplié, puisque c'est la même instance qui traverse les deux écrans.
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await expect(gesteDEcriture).toBeVisible();
});
