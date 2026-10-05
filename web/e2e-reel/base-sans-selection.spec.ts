import { expect, test } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** UNE BASE SANS `selectedPrincipaux` DOIT QUAND MÊME MONTRER SES PRINCIPES.
 *
 *  L'état d'Alix Davy (bloc 3, 14 principes, signalé par William le 17/08) —
 *  et de 48 BASE réelles sur 111 : la sélection de mouvements n'a jamais été
 *  stockée, le champ est NULL.
 *
 *  brokkr normalise `NULL → []` à la lecture de l'arbre, et le repli de
 *  l'éditeur s'écrivait `draft.selectedPrincipaux ?? orderedPrincipaux(…)` :
 *  `??` ne se déclenche jamais sur `[]`, donc `movements` restait vide et les
 *  CINQ sections groupées par mouvement ne rendaient rien — « 14 principes »
 *  comptés dans le bandeau, zéro affiché. Régression de la bascule FRE-12 :
 *  le chemin Firestore OMETTAIT le champ absent, et `??` fonctionnait.
 *
 *  Même famille que la ligne vide de l'arbre du matin même (`''` vs NULL en
 *  `??`) — la frontière normalise l'absence, le repli ne la reconnaît plus.
 *
 *  ⚠️ La spec sème la BASE par l'API en OMETTANT le champ : c'est le décor
 *  exact du bug. Lui donner `selectedPrincipaux: []` ou le laisser absent
 *  doit rendre pareil — brokkr confond déjà les deux.
 */
test.afterEach(nettoyer);

test('les principes s’affichent même sans sélection de mouvements stockée', async ({ page }) => {
  await poserUnMacro([], { sessions: [] });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    daySplit: [{ day: 'J1', tiers: { SQUAT: 1 } }],
    // PAS de selectedPrincipaux — tout le sujet de la spec.
    principles: [{ name: 'SQUAT', tier: 1, variant: [], sets: '5', reps: '5',
                   repsUnit: 'count', weight: '100' }],
    accessories: [],
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  // La BASE est bien OUVERTE avant d'inspecter son contenu : le bouton bascule
  // son libellé. Sans cette étape, un échec plus bas ne dirait pas si l'éditeur
  // n'a rien rendu ou s'il ne s'est jamais ouvert — deux causes sans rapport.
  await expect(page.getByRole('button', { name: /Voir la semaine|View the week/ }))
    .toBeVisible({ timeout: 10_000 });

  // Les sections par mouvement existent : chacune porte son bouton « + Principe ».
  // Avec le bug, `movements` est vide → AUCUN bouton, aucune section.
  await expect(page.getByRole('button', { name: 'Principe', exact: true }).first())
    .toBeVisible({ timeout: 10_000 });

  // …et le principe semé est bien rattaché à sa section : SQUAT en compte UN
  // (les autres mouvements du repli affichent « 0 principe »).
  await expect(page.getByText('1 principe', { exact: true })).toBeVisible();
});
