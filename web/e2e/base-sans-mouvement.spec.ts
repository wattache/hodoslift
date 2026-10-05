import { expect, test, type Page } from '@playwright/test';

/** LA SECTION « PRINCIPES » QUAND PLUS AUCUN MOUVEMENT N'EST SÉLECTIONNÉ (FRE-106).
 *
 *  ⚠️ L'ÉTAT SE FABRIQUE AU CLAVIER, PAS DANS LA FIXTURE. `selectedPrincipaux`
 *  vaut `[]` sur ZÉRO bloc des 148 en production — le seul chemin qui y mène est
 *  le geste reproduit ici : retirer les pastilles une par une. Le semer dans la
 *  maquette aurait décrit un état que personne n'atteint ; le jouer vérifie AUSSI
 *  que ce chemin existe encore.
 *
 *  ⚠️ ET `[]` N'EST PAS `null`. La maquette part de `selectedPrincipaux: null`
 *  (« jamais configuré », 72 blocs réels sur 148), où l'éditeur replie sur
 *  l'ordre canonique et affiche ses sections. C'est le geste du coach qui
 *  produit la liste vide, et elle seule doit vider l'écran — la confusion des
 *  deux états est ce qui a coûté FRE-62 le 17/08, puis FRE-111 le 26/08.
 */
const ouvrirLaBase = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Intensification' }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
};

const messageDeVide = (page: Page) => page.getByText(/Aucun mouvement sélectionné/);

test('vider la sélection dit où en rajouter un', async ({ page }) => {
  await ouvrirLaBase(page);

  // Le décor : des mouvements, donc des sections, donc pas de message.
  const pastilles = page.getByRole('button', { name: '×' });
  expect(await pastilles.count()).toBeGreaterThan(0);
  await expect(messageDeVide(page)).toHaveCount(0);

  // Retirer les pastilles UNE PAR UNE — le geste exact que décrit le ticket.
  // Toujours la première : la liste se recompose à chaque clic, un index figé
  // désignerait une autre pastille au tour suivant.
  for (let reste = await pastilles.count(); reste > 0; reste--) {
    await pastilles.first().click();
    // ⚠️ CE « × » SE CONFIRME DEPUIS FRE-32/85. Il emporte aussi les LIGNES de
    // principe portant ce mouvement et son rang dans la répartition des jours —
    // ce que rien ne disait à l'écran.
    await page.getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect(pastilles).toHaveCount(reste - 1);
  }

  // ⚠️ CE QUE LA SECTION DISAIT AVANT : rien. Son titre, son compteur à zéro, et
  // un rectangle vide — d'où le ticket.
  await expect(messageDeVide(page)).toBeVisible();

  // Et la sortie qu'il nomme est bien là, deux sections plus haut. Sans cette
  // ligne, le message pourrait désigner un geste qui n'existe plus.
  await expect(page.getByRole('combobox').filter({ hasText: /Ajouter un principal|Add a main lift/ }))
    .toHaveCount(1);
});
