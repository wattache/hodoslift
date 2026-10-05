import { expect, test } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** L'APERÇU DE LA SEMAINE QUE LA BASE PRODUIRAIT — FRE-29, déplacé le 26/08.
 *
 *  ⚠️ CETTE SPEC EXISTE PARCE QUE L'APERÇU EST DEVENU INVISIBLE AUX AUTRES
 *  HARNAIS. Il se calculait dans le navigateur ; le dev-mock le montrait donc,
 *  et six specs s'appuyaient dessus pour éprouver les règles de génération.
 *  Depuis que le calcul vit chez brokkr, la maquette n'a plus personne à
 *  interroger : elle n'affiche plus rien, et ces specs ont changé d'adresse.
 *
 *  Restait un trou que les compteurs ne montraient pas — les RÈGLES sont
 *  gardées côté serveur (`test_generation_semaine.py`), mais que le PANNEAU
 *  affiche bien quelque chose, plus personne ne le regardait. C'est le genre
 *  d'angle mort qui se découvre en production, sur l'écran où la kiné compose.
 *
 *  ⚠️ ET SEUL LE HARNAIS RÉEL PEUT LE VOIR : l'aperçu est un aller-retour HTTP
 *  vers `/base/preview-week`, débouncé à 400 ms. Sans serveur, il n'y a rien à
 *  attendre.
 */
test.afterEach(nettoyer);

const SQUAT = {
  name: 'SQUAT', tier: 1, variant: [], sets: '5', reps: '5',
  repsUnit: 'count', weight: '100',
};

test('l’aperçu affiche la semaine que la BASE enregistrée produirait', async ({ page }) => {
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    daySplit: [{ day: 'J1', tiers: { SQUAT: 1 } }],
    selectedPrincipaux: ['SQUAT'],
    principles: [SQUAT],
    accessories: [],
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  // ⚠️ `toContainText` SUR LE PANNEAU, et pas une assertion de comptage : ce
  // qu'on garde ici est que l'aperçu ARRIVE et qu'il montre la bonne ligne.
  // L'ordre, les bi-sets et la nature sont éprouvés côté serveur, où ils se
  // testent sans navigateur.
  await expect(page.locator('article[aria-label^="Aperçu"]'))
    .toContainText('SQUAT', { timeout: 10_000 });
});

test('l’aperçu SUIT la frappe, sur un brouillon non enregistré', async ({ page }) => {
  /** ⚠️ L'ASSERTION QUI PORTE VRAIMENT. La première montre que la route répond ;
   *  celle-ci montre que l'aperçu porte sur le BROUILLON — ce qui est toute la
   *  raison d'avoir une route dédiée plutôt que de relire la BASE enregistrée.
   *
   *  On pose un tier dans la grille SANS rien enregistrer, et la ligne doit
   *  apparaître dans l'aperçu. Si la route lisait la base de données, elle
   *  rendrait une semaine vide. */
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    daySplit: [], selectedPrincipaux: ['SQUAT'], principles: [SQUAT], accessories: [],
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  // La grille est vide : aucun jour ne porte de tier, donc aucune séance — et
  // le panneau ne rend RIEN plutôt qu'un cadre vide. C'est ce qu'il faut
  // affirmer : `not.toContainText` sur un élément absent passe pour la mauvaise
  // raison (« introuvable » vaut « ne contient pas »), et le test resterait vert
  // même si l'aperçu ne s'affichait jamais.
  await expect(page.locator('article[aria-label^="Aperçu"]')).toHaveCount(0);

  // On pose un tier — geste local, rien n'est encore enregistré.
  //
  // ⚠️ LA CASE EST UN BOUTON QUI TOURNE DEPUIS LE 20/09 (– → 1 → 2 → 3 → –),
  // et son nom dit le jour et le mouvement : plus besoin de la désigner « par ce
  // qu'elle contient » faute de mieux, comme du temps des listes déroulantes.
  const caseDeLaGrille = page.getByRole('button', { name: /^J1, SQUAT\s*:/ });
  await caseDeLaGrille.click();

  await expect(page.locator('article[aria-label^="Aperçu"]'))
    .toContainText('SQUAT', { timeout: 10_000 });
});
