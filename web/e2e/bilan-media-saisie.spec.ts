import { expect, test } from '@playwright/test';

/** L'IMAGE DE DÉMONSTRATION DANS LE BILAN — FRE-99, lot B.
 *
 *  ⚠️ C'EST L'ÉCRAN QUI MANQUAIT, ET SON ABSENCE NE FAISAIT ROUGIR AUCUN TEST.
 *  Le composeur affichait la photo, le bilan non — donc l'image n'existait
 *  nulle part là où quelqu'un exécute le mouvement. La kiné compose une fois ;
 *  l'athlète et le praticien lisent à chaque passage.
 *
 *  Deux états sont gardés ici, et le second est celui qu'on oublie :
 *
 *   · une image rattachée s'affiche, et s'agrandit d'un geste — parce qu'un
 *     bilan porte jusqu'à 32 tests et qu'on ne déroule pas 32 photos ;
 *   · un résultat rattaché SANS URL le DIT. Le jour où la clé Scaleway expirera
 *     (FRE-104), ne rien montrer ferait passer une panne pour « ce test n'a pas
 *     d'image » — et personne ne la signalerait.
 */

async function ouvrirLeBilan(page: import('@playwright/test').Page) {
  await page.goto('/kine');
  await page.getByRole('tab', { name: /Bilans/ }).click();
  await page.getByRole('button', { name: /Bilan complet/ }).first().click();
}

test('le test montre SES images, et chacune s’agrandit', async ({ page }) => {
  await ouvrirLeBilan(page);

  // ⚠️ DEUX VIGNETTES : le mouvement se montre en plusieurs photos, et le bilan
  // porte l'instantané de CE que la kiné avait posé.
  await expect(page.getByRole('button', { name: /Démonstration 2 — Squat overhead/ }))
    .toBeVisible();

  const vignette = page.getByRole('button', { name: /Démonstration 1 — Squat overhead/ });
  await expect(vignette).toBeVisible();

  // ⚠️ REPLIÉE PAR DÉFAUT : c'est ce qui garde la page parcourable. L'assertion
  // porte sur `aria-expanded`, pas sur des classes — la taille est un détail de
  // mise en forme, l'état déplié est ce qui se promet.
  await expect(vignette).toHaveAttribute('aria-expanded', 'false');
  await vignette.click();
  await expect(vignette).toHaveAttribute('aria-expanded', 'true');

  // ⚠️ UNE SEULE À LA FOIS : deux images agrandies côte à côte reprendraient la
  // place qu'on vient d'économiser.
  const autre = page.getByRole('button', { name: /Démonstration 2 — Squat overhead/ });
  await autre.click();
  await expect(vignette).toHaveAttribute('aria-expanded', 'false');
  await expect(autre).toHaveAttribute('aria-expanded', 'true');
});

test('une image rattachée mais injoignable se DIT', async ({ page }) => {
  await ouvrirLeBilan(page);

  await expect(page.getByText(/image de démonstration momentanément indisponible/))
    .toBeVisible();
});

test('un test SANS image n’affiche ni vignette ni excuse', async ({ page }) => {
  /** ⚠️ L'ASSERTION QUI ÉVITE LE BRUIT. La très grande majorité des tests vaut
   *  par son protocole écrit : afficher un cadre vide ou une mention sur chacun
   *  transformerait l'absence — normale — en défaut apparent. */
  await ouvrirLeBilan(page);

  await expect(page.getByRole('button', { name: /Démonstration 1 — Érecteur du rachis/ }))
    .toHaveCount(0);
  // Une seule mention d'indisponibilité en tout : celle du Grip.
  await expect(page.getByText(/momentanément indisponible/)).toHaveCount(1);
});
