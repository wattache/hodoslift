import { expect, test } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserUnMacro, seConnecter } from './aides';

/** UNE LIGNE QU'ON VIENT D'AJOUTER NE S'ÉVAPORE PAS.
 *
 *  ⚠️ LE DÉFAUT, MESURÉ LE 08/09. Le `PUT /base` répondait 200 et la base
 *  restait à ZÉRO accessoire : `inserer_ligne` ÉCARTE une ligne sans nom, ce qui
 *  est sa règle. Une ligne neuve n'a par définition pas encore de nom. Tant que
 *  personne ne relisait, le brouillon local la gardait et le coach la nommait ;
 *  depuis que l'écriture invalidait `block-content` (FRE-144), la relecture
 *  rendait une trame sans elle, `dejaSeme` resemait le brouillon, et la LIGNE
 *  DISPARAISSAIT SOUS LE CURSEUR — avant même qu'on puisse la nommer.
 *
 *  Ajouter un accessoire dans la BASE était donc devenu impossible.
 *
 *  ⚠️ POURQUOI IL A FALLU UNE SONDE POUR LE VOIR. Le harnais le SIGNALAIT déjà
 *  (`base-sans-dates` rouge), mais son message parle de `selectOption` sur un
 *  élément « détaché du DOM » — la conséquence, pas la cause. Le tour a été de
 *  compter, à la même seconde, ce que la BASE contient et ce que l'écran
 *  montre : `base=0 écran=1` puis `base=0 écran=0`, et la question devenait
 *  « pourquoi zéro côté serveur ? », qui a une réponse.
 *
 *  ⚠️ LE « 200 SILENCIEUX » EST FERMÉ AUSSI, et c'est la seconde assertion. Le
 *  serveur garde désormais une ligne de BASE sans nom (`SANS_NOM_ACCEPTE`,
 *  stockée à NULL) : l'écran et la base disent la même chose, au lieu de se
 *  contredire le temps d'une composition. Les lignes de SÉANCE, elles, gardent
 *  la règle inverse — elles arrivent en masse, où une ligne nue est un résidu.
 */
test.afterEach(nettoyer);

test('l’accessoire qu’on vient d’ajouter est encore là après l’aller-retour', async ({ page }) => {
  await poserUnMacro();                      // un bloc, SANS base

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  const lignes = page.getByLabel('Mouvement');
  // Le brouillon (30/09) : on choisit le mouvement, puis on VALIDE — c'est la
  // validation qui pose la ligne dans la trame et l'envoie à brokkr.
  await page.getByRole('button', { name: 'Accessoire' }).click();
  const brouillon = page.locator('[data-accessoire-brouillon]');
  await brouillon.getByLabel('Mouvement').selectOption({ index: 1 });
  await brouillon.getByRole('button', { name: /^Ajouter à/ }).click();
  await expect(brouillon).toHaveCount(0);
  await expect(lignes).toHaveCount(1);

  // ⚠️ L'ASSERTION QUI PORTE LA SPEC EST CELLE D'APRÈS L'ATTENTE. La ligne
  // apparaît toujours — c'est de l'état local. Ce qui la tuait, c'est le retour
  // du serveur, qui arrive une fraction de seconde plus tard. Une spec qui
  // vérifie tout de suite est verte quoi qu'il arrive.
  await page.waitForTimeout(2_000);
  await expect(lignes, 'la ligne neuve a disparu au retour du serveur').toHaveCount(1);

  // ⚠️ ET ELLE EST VRAIMENT EN BASE. Sans ça, la spec ne prouverait que la
  // survie à l'écran — ce qu'un simple « ne relis pas » suffirait à obtenir,
  // en laissant le 200 mentir.
  //
  // ⚠️ ON ATTEND LA BASE, ON NE LA LIT PAS UNE FOIS. Cette assertion héritait
  // du `waitForTimeout` ci-dessus : deux secondes suffisent en isolé, pas
  // toujours sous une campagne complète. Elle rendait alors zéro et accusait le
  // serveur d'un « 200 silencieux » qui n'avait pas eu lieu — un rouge qui
  // désigne le mauvais coupable coûte plus cher qu'un rouge franc. Vu le 10/09.
  //
  // Le `waitForTimeout` RESTE pour l'assertion d'écran : elle, doit laisser au
  // serveur le temps de répondre POUR VOIR s'il efface la ligne. Attendre qu'un
  // état apparaisse et vérifier qu'un état ne disparaît pas sont deux gestes
  // opposés — le premier tolère la lenteur, le second en a besoin.
  await expect.poll(
    async () => ((await arbre()).macros[0]?.blocks[0]?.base?.accessories ?? []).length,
    { timeout: 10_000, message: 'le PUT a répondu 200 sans écrire la ligne' },
  ).toBe(1);

  // Et elle reste MODIFIABLE après l'aller-retour — un autre mouvement se choisit.
  const autre = await lignes.first().locator('option').nth(2).getAttribute('value');
  await lignes.first().selectOption({ index: 2 });
  await expect(lignes.first()).toHaveValue(autre!);
});
