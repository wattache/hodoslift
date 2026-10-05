import { expect, test } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserDuRealise, poserUnMacro, seConnecter } from './aides';

/** DUPLIQUER UNE LIGNE (Passe 3, constat 05).
 *
 *  La copie se fait côté brokkr, qui tient la liste de ce qui se recopie ; sa
 *  suite (`test_training_lines.py`) garde le réalisé et le groupe. Ce que cette
 *  spec garde, et qu'aucune spec serveur ne peut voir :
 *
 *    1. la charge TAPÉE juste avant le clic est dans la copie — elle dormait
 *       encore dans le debounce de 400 ms quand le serveur lisait la ligne ;
 *    2. la copie apparaît JUSTE DESSOUS, et le curseur est dans son nom.
 *
 *  MUTATION QUI ROUGIT : retirer `await envoyerMaintenant(...)` de
 *  `duplicateExercise` → la copie porte 100, pas 102.5.
 */
test.afterEach(nettoyer);

test('la copie porte la frappe d’avant le clic, sans le réalisé, et reçoit le curseur', async ({ page }) => {
  await poserUnMacro([
    { name: 'SQUAT', sets: '5', reps: '3', weight: '100' },
    { name: 'DIPS', sets: '4', reps: '6' },
  ]);
  await poserDuRealise({ SQUAT: { feltRPE: '8' } });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: 'Semaine 1' }).first().click();

  const charge = page.getByRole('textbox', { name: 'Charge' }).first();
  await expect(charge).toBeVisible({ timeout: 15_000 });
  await charge.fill('102.5');
  await charge.blur();
  // Aussitôt : la frappe n'est pas encore partie. « Dupliquer » vit dans le
  // dépli de la ligne (brief coach, 27/09).
  await page.locator('[data-ligne="0"]').first().getByRole('button', { name: /^Déplier la ligne/ }).click();
  await page.getByRole('button', { name: 'Dupliquer la ligne SQUAT' }).click();

  await expect.poll(async () => {
    const lignes = (await arbre()).macros[0].blocks[0].weeks[0].sessions?.[0].exercises ?? [];
    return lignes.map(l => [l.name, l.weight, l.feltRPE || '']);
  }, { timeout: 10_000, message: 'la copie n’est pas celle attendue' }).toEqual([
    ['SQUAT', '102.5', '8'],
    ['SQUAT', '102.5', ''],
    ['DIPS', null, ''],     // jamais écrite : NULL, pas ''
  ]);

  // À l'écran, juste dessous, et le curseur dans la recherche de son nom.
  await expect(page.locator('[data-ligne="1"] [data-nom-exercice]')).toContainText('SQUAT');
  await expect(page.getByPlaceholder('Rechercher…')).toBeFocused();
});
