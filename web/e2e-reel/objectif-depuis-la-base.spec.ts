import { expect, test } from '@playwright/test';
import { arbre, colonne, modeCoach, nettoyer, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** UN OBJECTIF POSÉ DEPUIS UNE LIGNE DE BASE ARRIVE EN BASE AVEC TOUT CE QU'ELLE
 *  PORTE (FRE-252) — format ET options, tempo compris. Le défaut signalé :
 *  « l'objectif prend FORMAT mais pas ses options ». */
test.afterEach(nettoyer);

const objectifsEnBase = () => colonne(`
  SELECT o.exercise || '|' || coalesce(o.format, '⌀') || '|' || coalesce(o.cluster_mode, '⌀') || '|'
      || coalesce(o.cluster_rest, '⌀') || '|' || coalesce(o.tempo, '⌀') || '|' || coalesce(o.sets, '⌀') || 'x' || coalesce(o.reps, '⌀')
      || '|' || coalesce(o.source, '⌀') || ' ' || coalesce(o.tier::text, '⌀')
  FROM block_objectives o JOIN training_blocks b ON b.id = o.block_id
  JOIN training_macros m ON m.id = b.macro_id WHERE m.program_id = 'e2e-program' ORDER BY o.position`);

test('l’objectif tiré d’une ligne en cluster garde son schéma, son repos et son tempo', async ({ page }) => {
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    daySplit: [{ day: 'J1', tiers: { 'MUSCLE UP': 1 } }], selectedPrincipaux: ['MUSCLE UP'],
    principles: [{ name: 'MUSCLE UP', tier: 1, variant: [], format: 'CLUSTER', clusterMode: '1/1/1',
                   clusterRest: '15s', tempo: 'DS', sets: '4', reps: '3' }],
    accessories: [],
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await page.getByRole('button', { name: 'Poser un objectif depuis la ligne MUSCLE UP' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ajouter', exact: true }).click();

  // MUTATION QUI ROUGIT : `clusterMode` absent de l'écriture (`_COLONNES_OBJECTIF`).
  // Et son LIEN à la ligne : un principe, tier 1 (FRE-254).
  await expect.poll(objectifsEnBase, { timeout: 10_000 }).toBe('MUSCLE UP|CLUSTER|1/1/1|15s|DS|4x3|principe 1');
});
