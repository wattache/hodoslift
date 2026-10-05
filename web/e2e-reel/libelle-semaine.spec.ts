import { expect, test } from '@playwright/test';
import { arbre, modeCoach, nettoyer, S1_DATEE, poserUnMacro, seConnecter } from './aides';

/** UNE SEMAINE SANS NOM DOIT S'APPELER « Semaine N », PAS RIEN.
 *
 *  Signalé par William sur une capture : une ligne de l'arbre portait son badge
 *  « S2 » et AUCUN libellé. `buildNextWeek` laisse le nom vide — c'est voulu, le
 *  coach le remplit s'il veut — et le repli `week.name ?? …` ne se déclenchait
 *  jamais : brokkr normalise `NULL → ''` (`_txt`), et `??` ne réagit qu'à
 *  `null`. Le bloc juste au-dessus, dans le même composant, utilisait `||` et
 *  s'affichait correctement.
 *
 *  Le cas se fabrique tout seul : toute semaine ajoutée naît sans nom.
 */
test.afterEach(nettoyer);

test('une semaine sans nom porte son numéro dans l’arbre', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }], { datesDeS1: S1_DATEE });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await expect.poll(async () => (await arbre()).macros[0].blocks[0].weeks.length,
                    { timeout: 10_000 }).toBe(2);

  // Le nom est bien VIDE côté serveur — sinon le test ne prouverait rien.
  const semaines = (await arbre()).macros[0].blocks[0].weeks;
  expect(semaines[1].name ?? '').toBe('');

  // …et l'arbre l'identifie quand même.
  //
  // ⚠️ ON VISE L'ARBRE, PAS LE TEXTE « Semaine 2 » n'importe où. Une première
  // version cherchait `getByText('Semaine 2')` : elle est restée VERTE avec le
  // défaut réintroduit, parce qu'elle attrapait l'EN-TÊTE de la semaine — une
  // autre surface, corrigée au même moment. `getByRole('button')` l'exclut :
  // l'en-tête n'est pas un bouton.
  //
  // ⚠️ LA CIBLE A CHANGÉ LE 24/08, PAS L'INVARIANT. Les semaines ne sont plus
  // des rangées « S2 Semaine 2 5 » mais une BANDE de numéros sous leur bloc :
  // la pastille affiche « 2 » et porte « Semaine 2 » en nom ACCESSIBLE. Le
  // défaut d'origine — un badge « S2 » suivi d'un libellé vide — ne peut
  // d'ailleurs plus se produire par construction : aucune semaine n'affiche de
  // libellé dans l'arbre, elles affichent toutes leur numéro. Ce qui reste à
  // garantir, et que cette spec garantit, c'est que la semaine sans nom est
  // JOIGNABLE et NOMMÉE pour qui ne voit pas l'écran.
  await expect(page.getByRole('button', { name: 'Semaine 2', exact: true }))
    .toBeVisible({ timeout: 10_000 });
});
