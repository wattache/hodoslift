import { expect, test } from '@playwright/test';

/** LE TABLEAU DES SIGNALEMENTS — la réponse au « je voudrais une notification ».
 *
 *  Ce qui se joue ici est un travail de TRIAGE : ouvrir l'écran, repérer d'un
 *  coup d'œil qui va mal, et l'ouvrir. Les specs visent donc ces trois gestes —
 *  pas les libellés du questionnaire, qui n'est pas arrêté.
 *
 *  Fixture : Théo signale des lombaires à 8/10, Léa un genou à 2/10 le même jour
 *  puis 5/10 trois jours plus tôt. */

/** ⚠️ ATTENDRE LA DONNÉE, pas la page. Le mock répond en 150 ms et la vue affiche
 *  « aucun signalement » entre-temps : compter à cet instant rend zéro, donc un
 *  échec qui ressemble à une régression alors que rien n'est cassé. */
const ouvrirLeTableau = async (page: import('@playwright/test').Page) => {
  await page.goto('/signalements');
  await expect(page.getByRole('listitem').filter({ hasText: '/10' }).first()).toBeVisible();
};

test('l’entrée est dans la barre latérale et mène au tableau', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('link', { name: /Signalements|Reports/ }).click();

  await expect(page).toHaveURL(/\/signalements$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('une intensité FORTE se distingue d’une faible', async ({ page }) => {
  await ouvrirLeTableau(page);

  // Le point de l'écran : repérer sans lire. Les deux valeurs sont là, et elles
  // n'ont pas la même couleur — sinon la liste ne vaut pas mieux qu'un journal.
  const fort = page.getByText('8/10');
  const faible = page.getByText('2/10');
  await expect(fort).toBeVisible();
  await expect(faible).toBeVisible();
  expect(await fort.evaluate(e => getComputedStyle(e).color))
    .not.toBe(await faible.evaluate(e => getComputedStyle(e).color));
});

test('les jours sont groupés, du plus récent au plus ancien', async ({ page }) => {
  await ouvrirLeTableau(page);

  const jours = await page.getByRole('heading', { level: 2 }).allTextContents();
  expect(jours.length).toBeGreaterThan(1);
  expect([...jours].sort().reverse()).toEqual(jours);
});

test('changer de fenêtre relance la lecture sans vider l’écran', async ({ page }) => {
  await ouvrirLeTableau(page);

  // ⚠️ CE QUE CETTE SPEC NE PROUVE PAS, et il faut le dire : que le paramètre
  // `jours` parte au serveur. Le mock rend la MÊME liste quelle que soit la
  // fenêtre, donc trois boutons qui n'enverraient rien passeraient au vert.
  // L'effet réel est prouvé côté brokkr
  // (`test_le_plus_RECENT_en_premier_et_la_fenetre_se_regle`).
  //
  // Ce qui se vérifie ICI : le sélecteur change d'état, et la liste REVIENT —
  // une clé de requête mal formée la laisserait vide, ce qui se lirait comme
  // « plus personne ne signale rien ».
  for (const fenetre of ['90 j', '7 j'] as const) {
    await page.getByRole('button', { name: fenetre }).click();
    await expect(page.getByRole('button', { name: fenetre })).toHaveClass(/bg-gold/);
    await expect(page.getByRole('listitem').filter({ hasText: '/10' }).first())
      .toBeVisible();
  }
});

test('cliquer un athlète l’OUVRE, et mène à son suivi', async ({ page }) => {
  await ouvrirLeTableau(page);
  await page.getByRole('link', { name: 'Théo Bernard' }).first().click();

  await expect(page).toHaveURL(/\/kine$/);
  // ⚠️ LE PIÈGE que ce test garde : naviguer sans SÉLECTIONNER afficherait le
  // suivi de l'athlète précédemment choisi. L'écran répondrait à côté, et c'est
  // le genre de décalage qu'on ne remarque qu'en production.
  await expect(page.getByRole('heading', { name: /Théo Bernard/ })).toBeVisible();
});
