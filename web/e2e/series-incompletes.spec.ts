import { expect, test, type Page } from '@playwright/test';

/** LE REPÈRE DES SÉRIES LAISSÉES VIDES (FRE-156).
 *
 *  ⚠️ CE QUI SE VÉRIFIE ICI N'EST PAS LA RÈGLE, C'EST QU'ELLE SE VOIE.
 *  `seriesRenseignees` a ses sept specs unitaires ; ce fichier garde l'autre
 *  moitié, celle qui manquait au moment de livrer : le repère est-il RENDU, et
 *  au bon endroit ? Il a d'abord été posé à côté de la bascule « par série »,
 *  donc invisible tant que l'exercice n'était pas déplié — c'est-à-dire
 *  précisément quand on parcourt une séance pour voir ce qui reste à faire.
 *
 *  Fixture : bloc Accumulation, semaine 1, séance « Squat ». Les DIPS y portent
 *  quatre séries prescrites et deux ressentis notés — la forme exacte de sept
 *  lignes de production.
 *
 *  ⚠️ ET LES DEUX RESSENTIS SONT ÉGAUX DANS LA MAQUETTE, à dessein : le mode par
 *  série ne s'ouvre alors pas tout seul. C'est l'état où le repère doit se voir
 *  QUAND MÊME — ligne repliée, bascule fermée, donnée incomplète. */

const ouvrirLaSeanceSquat = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation' }).click();
  await page.getByRole('button', { name: /Semaine 1/ }).first().click();
  // ⚠️ `.first()` DEPUIS LE BANDEAU DE SÉANCES (refonte des écrans, 09/2026). La semaine porte
  // désormais un bandeau qui liste ses séances et permet d'en choisir une : deux
  // boutons portent donc le nom « Squat », celui du bandeau et celui de la
  // rangée. Les deux ouvrent la même séance — c'est le premier, le raccourci,
  // qu'on prend ici, comme le ferait quelqu'un qui arrive sur la semaine.
  await page.getByRole('button', { name: /Squat/ }).first().click();
};

test('une ligne à moitié notée par série le dit SANS être dépliée', async ({ page }) => {
  await ouvrirLaSeanceSquat(page);
  // Rien n'est déplié : c'est tout le sujet.
  await expect(page.getByText('2/4', { exact: true }).first()).toBeVisible();
});

test('le repère porte ce qu’il veut dire, pour qui s’y arrête', async ({ page }) => {
  await ouvrirLaSeanceSquat(page);
  const repere = page.getByTitle(/2 série\(s\) notée\(s\) sur 4/).first();
  await expect(repere).toBeVisible();
});

test('⚠️ UNE LIGNE COMPLÈTE NE PORTE AUCUN REPÈRE, et c’est la moitié qui le rend crédible', async ({ page }) => {
  // Le SQUAT de la même séance n'a aucun tableau par série : cinq séries
  // prescrites, rien de noté série par série. Ce n'est PAS un trou — un « 0/5 »
  // ici accuserait quelqu'un qui n'a rien commencé, et un repère qui parle tout
  // le temps cesse d'être lu en une semaine.
  await ouvrirLaSeanceSquat(page);
  await expect(page.getByText('0/5', { exact: true })).toHaveCount(0);
  // Et aucun repère ne s'affiche pour les quatre séries du SQUAT non plus.
  await expect(page.getByText('5/5', { exact: true })).toHaveCount(0);
});
