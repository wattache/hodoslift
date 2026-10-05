import { expect, test, type Page } from '@playwright/test';

import { arbre, modeCoach, nettoyer, poserDuRealise, poserUnMacro, seConnecter } from './aides';

/** Le dialogue de confirmation, comme `suppression.spec.ts` le fait déjà. */
async function confirmer(page: Page): Promise<void> {
  await dialogue(page).getByRole('button', { name: 'Supprimer', exact: true }).click();
}

/** ⚠️ `dialog` ET NON `alertdialog` : la confirmation est un `Dialog` Radix. */
const dialogue = (page: Page) => page.getByRole('dialog');

/** LE DIALOGUE DE SUPPRESSION DIT CE QU'IL VA DÉTRUIRE (FRE-130).
 *
 *  ⚠️ ON NE BLOQUE PAS, ON DIT. La revue du 06/09 proposait un 409 sur toute
 *  suppression portant du réalisé. Décision de William le 07/09 : « ça m'arrive
 *  de supprimer pour réajuster ». Le geste est légitime — ce qui manquait
 *  n'était pas une barrière mais une PHRASE. Le dialogue disait exactement la
 *  même chose d'une semaine vierge et d'une semaine où l'athlète a saisi douze
 *  séances.
 *
 *  ⚠️ ET LE COMPTE VIENT DU SERVEUR. `estRealise` a été retiré du front exprès
 *  (« la règle n'existe plus qu'une fois, en SQL ») : c'est donc le seul harnais
 *  qui puisse éprouver cette phrase, celui qui a un vrai brokkr derrière.
 */

test.afterEach(nettoyer);

test('une semaine VIERGE se supprime sans phrase de plus', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3', weight: '100' }]);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  // Supprimer vit sous « Gérer » depuis le 24/08 — le rail est devenu une barre.
  await page.getByRole('button', { name: /Gérer|Manage/ }).click();
  await page.getByTitle('Supprimer le semaine').click();   // sic — l'accord est au code

  await expect(dialogue(page)).toBeVisible();
  // Le cas courant : rien de fait, donc aucune friction ajoutée.
  await expect(dialogue(page)).not.toContainText(/déjà réalisée|completed session/i);
});

test('une semaine avec du RÉALISÉ le DIT, et se supprime quand même', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3', weight: '100' }]);
  // La TRACE, et elle seule : un RPE ressenti.
  await poserDuRealise({ SQUAT: { weightDone: '110', feltRPE: '8' } });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  await page.getByRole('button', { name: /Gérer|Manage/ }).click();
  await page.getByTitle('Supprimer le semaine').click();

  await expect(dialogue(page)).toContainText(/1 séance déjà réalisée|1 completed session/i);

  // ⚠️ ET LA SUPPRESSION RESTE POSSIBLE. C'est tout le sujet : on informe, on
  // n'interdit pas — « ça m'arrive de supprimer pour réajuster ».
  await confirmer(page);

  await expect.poll(async () => (await arbre()).macros[0]?.blocks[0]?.weeks?.length ?? 0,
                    { timeout: 10_000 }).toBe(0);
});
