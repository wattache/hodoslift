import { expect, test } from '@playwright/test';

/** DÉPLIER UN EXERCICE L'AMÈNE À L'ÉCRAN, EN ENTIER (16/09, remonté par les athlètes).
 *
 *  Choisir une séance remontait déjà son bandeau ; déplier un exercice en bas de
 *  page laissait le pli sous la ligne de flottaison, et il fallait faire défiler
 *  à la main pour trouver le RPE. Le bas du pli se cale maintenant au-dessus de la
 *  barre basse du téléphone.
 *
 *  ⚠️ PAS D'ANIMATION ICI : `reducedMotion` rend le défilement immédiat, donc la
 *  mesure ne dépend pas de la durée d'un glissé. */
test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

const pliDuBas = (page: import('@playwright/test').Page) => page.locator('[data-pli]').last();
const bornes = (page: import('@playwright/test').Page) => page.evaluate(() => ({
  bas: window.innerHeight
    - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--barre-basse')) || 0),
}));

test('le dernier exercice, déplié en bas de l’écran, remonte jusqu’à se voir en entier', async ({ page }) => {
  /** MUTATION QUI ROUGIT : `basculerLePli` sans `pliAAmener.current = carte`. */
  await page.goto('/training');
  await page.getByRole('button', { name: 'Détail' }).click();
  const pli = pliDuBas(page);
  // Le titre de l'exercice juste au-dessus de la barre basse : c'est là qu'on le déplie.
  await pli.evaluate(el => window.scrollBy(0, el.getBoundingClientRect().top - (window.innerHeight - 200)));
  await pli.getByTitle(/Voir notes|Ajouter une note/).click();
  await expect(pli.getByTitle(/Voir notes|Ajouter une note/)).toHaveAttribute('aria-expanded', 'true');

  const { bas } = await bornes(page);
  await expect.poll(async () => (await pli.boundingBox())!.y + (await pli.boundingBox())!.height,
    { message: 'le bas du pli est resté sous la barre basse' }).toBeLessThanOrEqual(bas);
});

test.describe('sur un écran assez haut pour le pli', () => {
  // Le décor du dev-mock est court : sur 844 px, aucune position de page ne laisse
  // le premier pli tenir en entier. Un écran haut le permet sans tricher.
  test.use({ viewport: { width: 390, height: 1600 } });

  test('un pli qui tient déjà dans l’écran ne fait pas bouger la page', async ({ page }) => {
    /** Faire sauter la page sous le doigt pour un pli qui se voyait serait pire que
     *  le défaut corrigé. MUTATION QUI ROUGIT : retirer le `return` quand le pli
     *  est déjà entier (la page se recale quand même sur son bas). */
    // On compte les appels à `scrollBy` plutôt que de lire `scrollY` : en haut de
    // page, un recalage VERS LE HAUT serait bridé à 0 et passerait inaperçu.
    await page.addInitScript(() => {
      const w = window as unknown as { __defilements: number };
      w.__defilements = 0;
      const original = window.scrollBy.bind(window);
      window.scrollBy = ((...args: Parameters<typeof window.scrollBy>) => { w.__defilements++; return original(...args); }) as typeof window.scrollBy;
    });
    await page.goto('/training');
    await page.getByRole('button', { name: 'Détail' }).click();
    const pli = page.locator('[data-pli]').first();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => { (window as unknown as { __defilements: number }).__defilements = 0; });
    await pli.getByTitle(/Voir notes|Ajouter une note/).click();
    await expect(pli.getByTitle(/Voir notes|Ajouter une note/)).toHaveAttribute('aria-expanded', 'true');
    const r = (await pli.boundingBox())!;
    const { bas } = await bornes(page);
    expect(r.y + r.height, 'le décor ne met pas le pli en entier à l’écran').toBeLessThanOrEqual(bas);
    expect(await page.evaluate(() => (window as unknown as { __defilements: number }).__defilements)).toBe(0);
  });
});
