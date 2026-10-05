import { expect, test } from '@playwright/test';

/** LA POPUP DES OBJECTIFS TECHNIQUES SE LIT EN ENTIER AU TÉLÉPHONE (14/09).
 *
 *  Quint voyait son conseil coupé — « Prise mu, explosif et dos ne » — et la date
 *  à moitié : la popup était posée DANS la carte de l'exercice, qui la rognait à
 *  droite et en bas. On ne mesure pas une capture : on vérifie que le coin
 *  inférieur droit du texte est bien la popup qu'on voit, pas ce qui la recouvre
 *  ou la coupe.
 *
 *  MUTATION QUI ROUGIT : l'ancienne popup (`absolute left-0 top-6 w-64`, sans
 *  portail).
 */
test.use({ viewport: { width: 390, height: 844 } });

test('la popup tient dans l’écran et rien ne la rogne', async ({ page }) => {
  await page.goto('/training');
  const pastille = page.getByRole('button', { name: /objectifs? techniques? sur MUSCLE UP/ }).first();
  await pastille.scrollIntoViewIfNeeded();
  await pastille.click();

  const popup = page.getByRole('dialog', { name: /Objectifs techniques sur MUSCLE UP/ });
  await expect(popup).toBeVisible();
  const derniereDate = popup.getByText(/Depuis le/).last();
  await expect(derniereDate).toBeVisible();

  const boite = (await popup.boundingBox())!;
  expect(boite.x).toBeGreaterThanOrEqual(0);
  expect(boite.x + boite.width).toBeLessThanOrEqual(390);

  // Chaque texte, jusqu'à son coin bas-droit, est réellement à l'écran DANS la popup.
  for (const el of [popup.getByText('Garde les coudes hauts à la transition.'), derniereDate]) {
    await el.scrollIntoViewIfNeeded();
    const b = (await el.boundingBox())!;
    const dedans = await page.evaluate(([x, y]) => {
      const cible = document.elementFromPoint(x, y);
      return !!cible?.closest('[role="dialog"]');
    }, [b.x + b.width - 2, b.y + b.height - 2]);
    expect(dedans).toBe(true);
  }
});
