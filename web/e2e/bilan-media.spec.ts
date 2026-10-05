import { expect, test } from '@playwright/test';

/** L'IMAGE DE DÉMONSTRATION D'UN TEST — FRE-99, lot B.
 *
 *  ⚠️ CE QUI EST GARDÉ ICI EST L'AFFICHAGE, PAS L'ENVOI. Les écritures du
 *  dev-mock sont des no-op : téléverser pour de vrai relève du harnais réel, et
 *  surtout du serveur, où les tests qui comptent existent déjà (reconnaissance
 *  du format aux octets, chemin fabriqué côté serveur — `test_bilan_medias.py`).
 *
 *  Restent deux choses que seul un passage par l'interface peut garder, et la
 *  seconde est celle qui a justifié la fixture :
 *
 *   · le choix se fait DEPUIS le composeur, à côté du protocole — pas dans un
 *     écran séparé où il faudrait aller chercher l'image avant d'écrire ;
 *   · une vignette INDISPONIBLE (`url: null`) s'affiche proprement. Le seau est
 *     privé, les URL sont signées et expirent : le jour où la clé expire
 *     (FRE-104), la kiné doit continuer à composer sans vignettes. Un `<img>`
 *     sans source afficherait une image cassée — ce qui se lit comme une panne
 *     alors que c'est un état connu.
 */

async function ouvrirLeTest(page: import('@playwright/test').Page) {
  await page.goto('/bilan-modeles');
  await page.getByRole('button', { name: /Bilan complet/ }).first().click();
  await page.getByRole('button', { name: 'Squat overhead' }).click();
}

test('le test montre SES images, et le retrait est offert sans les supprimer', async ({ page }) => {
  await ouvrirLeTest(page);

  await expect(page.getByText('Images de démonstration')).toBeVisible();
  // ⚠️ DEUX, PAS UNE. Un mouvement se montre en plusieurs photos — départ,
  // arrivée — et c'est ce que le formulaire papier faisait déjà.
  await expect(page.getByRole('img', { name: /Démonstration 1 — Squat overhead/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Démonstration 2 — Squat overhead/ })).toBeVisible();

  // ⚠️ « RETIRER », PAS « SUPPRIMER », et l'intitulé le dit. Détacher laisse le
  // média dans la médiathèque — il n'existe d'ailleurs AUCUNE route de
  // suppression côté serveur, la clé Scaleway ne portant pas ce droit.
  await expect(page.getByRole('button', { name: /Retirer l’image 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Retirer l’image 2/ })).toBeVisible();
});

test('la médiathèque montre le RANG de chaque image posée', async ({ page }) => {
  /** ⚠️ LE NUMÉRO EST LA FONCTIONNALITÉ, pas la sélection. Trois photos posées
   *  dans le désordre racontent une autre histoire : sans le rang affiché, rien
   *  à l'écran ne dit dans quel ordre elles partiront. */
  await ouvrirLeTest(page);
  await page.getByRole('button', { name: 'Modifier' }).click();

  const premiere = page.getByRole('button', { name: 'Départ, vue de face' });
  await expect(premiere).toHaveAttribute('aria-pressed', 'true');
  await expect(premiere).toContainText('1');
  await expect(page.getByRole('button', { name: 'Image sans légende' })).toContainText('2');

  // Non posée : ni rang, ni état pressé.
  await expect(page.getByRole('button', { name: /Vignette indisponible/ }))
    .toHaveAttribute('aria-pressed', 'false');
});

test('la médiathèque s’ouvre depuis le composeur et propose de téléverser', async ({ page }) => {
  await ouvrirLeTest(page);

  // Rien avant le clic : sinon la spec passerait avec un catalogue toujours
  // déplié, et ne garderait plus le geste.
  await expect(page.getByText('Médiathèque')).toBeHidden();

  await page.getByRole('button', { name: 'Modifier' }).click();
  await expect(page.getByText('Médiathèque')).toBeVisible();

  // ⚠️ L'ENVOI EST DANS LE MÊME PANNEAU QUE LE CHOIX : le geste réel est « je
  // n'ai pas cette image, je l'ajoute », pas « je vais la déposer ailleurs puis
  // revenir la chercher ».
  await expect(page.getByRole('button', { name: 'Téléverser' })).toBeVisible();

  // Les trois entrées de la fixture, dont celle du test courant, désignée.
  await expect(page.getByRole('button', { name: 'Départ, vue de face' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Image sans légende' })).toBeVisible();
});

test('une vignette indisponible se dit, au lieu de casser', async ({ page }) => {
  await ouvrirLeTest(page);
  await page.getByRole('button', { name: 'Modifier' }).click();

  const sansUrl = page.getByRole('button', { name: /Vignette indisponible/ });
  await expect(sansUrl).toBeVisible();

  // ⚠️ L'ASSERTION QUI PORTE : aucune image cassée. La tuile existe, elle est
  // cliquable, et elle ne contient PAS de `<img>` — c'est exactement la
  // différence entre « je vois que l'image manque » et « le site est cassé ».
  await expect(sansUrl.locator('img')).toHaveCount(0);
  await expect(sansUrl.locator('[title*="indisponible"]')).toBeVisible();
});
