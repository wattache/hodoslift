import { expect, test } from '@playwright/test';

/** Renommer un MACRO, un BLOC ou une SEMAINE — et surtout : le nom réel n'est
 *  pas l'étiquette affichée.
 *
 *  ⚠️ CE QUE CES SPECS PROTÈGENT. Un objet sans nom s'affiche « Macro 1 », dérivé
 *  de son numéro. Le champ d'édition recevait CETTE étiquette et non le nom réel,
 *  si bien que le crayon proposait « Macro 1 » comme texte à modifier : en valider
 *  une variante enregistrait un vrai nom qui ressemble à une étiquette
 *  automatique, et une renumérotation l'aurait laissé figé à « Macro 1 » en étant
 *  le macro 3.
 *
 *  L'autre symptôme était plus déroutant que grave : vider le nom donnait
 *  l'impression que l'ancien revenait, alors que c'était l'étiquette qui
 *  reprenait sa place — le comportement voulu, mais illisible.
 */

async function ouvrirEditeur(page: import('@playwright/test').Page) {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  // ⚠️ RENOMMER ET SUPPRIMER SONT PASSÉS SOUS UN PLI le 24/08, quand l'arbre en
  // rail est devenu une barre d'onglets : le cycle de vie des objets s'ouvre
  // quelques fois par mois, il n'a pas à occuper en permanence la hauteur
  // rendue à la séance. « Éditer la BASE », lui, est resté visible — c'est une
  // bascule de vue, pas un outil de gestion.
  await page.getByRole('button', { name: /Gérer|Manage/ }).click();
  await page.getByTitle('Renommer le macro').first().click();
}

test('sur un objet SANS nom, le champ est vide — pas pré-rempli de l’étiquette', async ({ page }) => {
  // ⚠️ IL FAUT D'ABORD RENDRE LE MACRO ANONYME : celui de la maquette porte un
  // nom, et la spec ne prouverait rien sans ça — c'est justement le cas « sans
  // nom » qui était mal servi.
  await ouvrirEditeur(page);
  const champ = page.getByPlaceholder(/^Macro \d+$/);
  await champ.fill('');
  await champ.press('Enter');
  await expect(page.getByText(/^Macro \d+$/).first()).toBeVisible();

  await page.getByTitle('Renommer le macro').first().click();
  const rouvert = page.getByPlaceholder(/^Macro \d+$/);
  // VIDE, et non « Macro 1 ». Pré-rempli, valider une variante de l'étiquette
  // aurait enregistré un vrai nom qui n'en a que l'apparence.
  await expect(rouvert).toHaveValue('');
});

test('vider le nom fait retomber sur l’étiquette, et rien d’autre', async ({ page }) => {
  await ouvrirEditeur(page);
  const champ = page.getByPlaceholder(/^Macro \d+$/);

  await champ.fill('Préparation générale');
  await champ.press('Enter');
  await expect(page.getByText('Préparation générale').first()).toBeVisible();

  await page.getByTitle('Renommer le macro').first().click();
  const champ2 = page.getByPlaceholder(/^Macro \d+$/);
  // Le nom qu'on vient de poser, lui, EST proposé : c'est un vrai nom.
  await expect(champ2).toHaveValue('Préparation générale');

  await champ2.fill('');
  await champ2.press('Enter');

  await expect(page.getByText('Préparation générale')).toHaveCount(0);
  await expect(page.getByText(/^Macro \d+$/).first()).toBeVisible();
});
