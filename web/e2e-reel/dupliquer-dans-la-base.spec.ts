import { expect, test } from '@playwright/test';
import { arbre, colonne, modeCoach, nettoyer, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** DUPLIQUER UNE LIGNE DE LA BASE (FRE-246), par le vrai chemin : le geste à
 *  l'écran, la trame enregistrée, et la copie relue EN BASE — avec sa
 *  prescription, et sans le lien de groupe de l'original. */
test.afterEach(nettoyer);

const lignesEnBase = (table: string) => colonne(`
  SELECT l.name || ':' || coalesce(l.sets, '⌀') || 'x' || coalesce(l.reps, '⌀') || ':' || coalesce(nullif(l.group_id, ''), '⌀')
  FROM ${table} l
  JOIN training_blocks b ON b.id = l.block_id
  JOIN training_macros m ON m.id = b.macro_id
  WHERE m.program_id = 'e2e-program'
  ORDER BY l.position`).split('\n').filter(Boolean);

test('dupliquer un accessoire en bi-set : la copie arrive en base, hors du groupe', async ({ page }) => {
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    daySplit: [], selectedPrincipaux: null, principles: [],
    accessories: [
      { name: 'LEG RAISE', day: 'J1', variant: [], sets: '3', reps: '12', groupId: 'g1', groupKind: 'biset' },
      { name: 'CURL BICEPS', day: 'J1', variant: [], sets: '3', reps: '12', groupId: 'g1', groupKind: 'biset' },
    ],
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await page.getByRole('button', { name: 'Dupliquer la ligne LEG RAISE' }).click();

  // MUTATION QUI ROUGIT : garder le `groupId` de l'original — trois lignes dans g1.
  await expect.poll(() => lignesEnBase('training_base_accessories'), { timeout: 10_000 })
    .toEqual(['LEG RAISE:3x12:g1', 'CURL BICEPS:3x12:g1', 'LEG RAISE:3x12:⌀']);
});
