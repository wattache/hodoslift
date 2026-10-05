import { expect, test } from '@playwright/test';

/** LE 1er DU MOIS TOMBE DANS LA COLONNE DE SON JOUR.
 *
 *  ⚠️ LE DÉFAUT QUE CETTE SPEC GARDE, ET POURQUOI IL A TENU DEPUIS LE PREMIER
 *  COMMIT. La grille est JUSTE dans le DOM : react-day-picker pose bien cinq
 *  cellules vides avant un 1er août qui tombe un samedi, et le nom accessible du
 *  bouton dit « samedi 1 août 2026 ». Rien de sémantique ne cloche.
 *
 *  C'est le CSS qui mentait. `week` est un `flex`, donc les cellules sont des
 *  éléments flex ; la taille n'était posée que sur le BOUTON (`day_button:
 *  w-8`), et une cellule vide n'a pas de bouton. Elle mesurait 0, la première
 *  ligne se collait à gauche, et le 1er août s'affichait sous « lu » — à la même
 *  abscisse que le 3, qui est un vrai lundi.
 *
 *  ⚠️ SIX MOIS SUR SEPT ÉTAIENT CONCERNÉS : tous ceux qui ne commencent pas un
 *  lundi. Personne ne l'a vu pendant des mois parce qu'un calendrier « à peu
 *  près juste » se lit sans qu'on compte les colonnes.
 *
 *  ⚠️ ET AUCUN TEST DE RENDU N'AURAIT PU L'ATTRAPER. jsdom ne fait pas de mise
 *  en page : les largeurs y valent 0 pour tout le monde. Il faut un vrai moteur,
 *  donc Playwright, et une mesure de POSITION — pas une assertion de classe CSS,
 *  qui ne ferait que recopier l'implémentation.
 */

test('le 1er d’un mois qui ne commence pas un lundi est dans la bonne colonne', async ({ page }) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  // Le champ « Début S1 » de la trame ouvre le calendrier.
  await page.getByRole('button', { name: /Début S1|W1 start/ }).click();

  const grille = page.getByRole('grid');
  await expect(grille).toBeVisible();

  // ⚠️ ON COMPARE AU JOUR SUIVANT DE LA MÊME COLONNE, pas à une abscisse
  // absolue : la position du calendrier dépend de la fenêtre, la RELATION entre
  // les colonnes non. C'est elle qui porte la règle.
  //
  // Le premier jour du mois et le même jour de la semaine, sept jours plus tard,
  // doivent être exactement l'un au-dessus de l'autre.
  const jours = grille.getByRole('button');
  const premier = await jours.first().boundingBox();
  const huitJoursApres = await jours.nth(7).boundingBox();

  expect(premier, 'le calendrier doit porter des jours').not.toBeNull();
  expect(huitJoursApres).not.toBeNull();
  expect(Math.round(premier!.x), 'J et J+7 sont dans la même colonne')
    .toBe(Math.round(huitJoursApres!.x));

  // ⚠️ ET LA CELLULE VIDE GARDE SA PLACE. C'est la cause directe : sans largeur,
  // elle disparaissait et décalait toute la ligne. Une cellule sans bouton doit
  // mesurer autant qu'une cellule qui en porte un.
  const cellules = grille.locator('[role="gridcell"]');
  const vide = await cellules.first().boundingBox();
  const pleine = await cellules.nth(7).boundingBox();
  expect(vide!.width, 'une cellule vide occupe sa colonne').toBe(pleine!.width);
});
