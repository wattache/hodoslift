import { expect, test, type Page } from '@playwright/test';

/** RECOPIER UNE COLONNE VERS LE BAS (Passe 3, constat 05).
 *
 *  La poignée d'une case de prescription, tirée à la souris, écrit sa valeur dans
 *  les lignes traversées. Ce que ces specs gardent :
 *
 *    1. la valeur TAPÉE est celle qui part, même sans avoir quitté la case ;
 *    2. la recopie ne franchit pas une ligne d'une autre nature ;
 *    3. le réalisé n'a pas de poignée ;
 *    4. au doigt, pas de poignée du tout.
 *
 *  Fixture : Accumulation, semaine 1, séance 1 — MUSCLE UP, PULL UP (RPE réel 7),
 *  ROWING (3×10), FACE PULL (3×15), CHINESE PLANK (3×60 s), puis FENTES BULGARE
 *  (3×12), la seule ligne KINÉ. */

const ouvrirLaSeance = async (page: Page) => {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
  await page.getByRole('button', { name: /Semaine 1/ }).click();
  await expect(ligne(page, 5)).toBeVisible();
};

/** ⚠️ DANS LA PREMIÈRE SÉANCE : le coach voit toute la semaine depuis FRE-180,
 *  et chaque séance numérote ses lignes à partir de 0. */
const seance = (page: Page) => page.locator('[data-seance-id]').first();
const ligne = (page: Page, i: number) => seance(page).locator(`[data-ligne="${i}"]`);

/** Tire la poignée de la case active jusqu'au milieu de la ligne `jusqua`, et
 *  rend la main AVANT de relâcher : l'appelant lit l'aperçu, puis relâche. */
async function tirer(page: Page, champ: string, jusqua: number) {
  const poignee = seance(page).locator(`[data-poignee-recopie="${champ}"]:visible`);
  await expect(poignee).toHaveCount(1);
  // ⚠️ LA POIGNÉE ET LA LIGNE D'ARRIVÉE DOIVENT ÊTRE À L'ÉCRAN. La grille défile
  // dans les deux sens, et hors de la zone visible elle ne sait pas ce qui est
  // sous le pointeur : le glisser partait de rien, et la spec en concluait des
  // choses fausses (vu le 14/09).
  await ligne(page, jusqua).scrollIntoViewIfNeeded();
  await poignee.scrollIntoViewIfNeeded();
  const depart = (await poignee.boundingBox())!;
  const arrivee = (await ligne(page, jusqua).boundingBox())!;
  const x = depart.x + depart.width / 2;
  const y = depart.y + depart.height / 2;
  expect(await page.evaluate(([px, py]) =>
    document.elementFromPoint(px, py)?.hasAttribute('data-poignee-recopie'), [x, y])).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, arrivee.y + arrivee.height / 2, { steps: 8 });
}

test('la valeur tapée descend, et ne franchit pas une ligne d’une autre nature', async ({ page }) => {
  /** MUTATIONS QUI ROUGISSENT :
   *  - retirer le `blur()` de `debuterRecopie` → ROWING reçoit 5, pas 8 ;
   *  - `continue` au lieu de `break` sur la nature → CHINESE PLANK reçoit 8.
   *
   *  ⚠️ LA LIGNE D'UNE AUTRE NATURE EST AU MILIEU, pas en dernier. La ligne KINÉ
   *  de la fixture ferme la séance : s'arrêter devant elle ou la sauter donnent
   *  le même écran, et la première version de cette spec passait au vert avec la
   *  mutation. On passe donc FACE PULL en échauffement, par son bouton. */
  await ouvrirLaSeance(page);
  await ligne(page, 3).getByRole('button', { name: /^Nature de/ }).click();
  await expect(ligne(page, 3).getByRole('button', { name: /Échauffement\./ })).toBeVisible();

  const reps = ligne(page, 1).getByLabel('Reps', { exact: true });
  await reps.click();
  await reps.fill('8');

  // Le pointeur va jusqu'à CHINESE PLANK ; la recopie s'arrête avant FACE PULL.
  await tirer(page, 'reps', 4);
  await expect(page.getByText('8 → 1 ligne', { exact: true })).toBeVisible();
  await expect(page.locator('[data-recopie-cible="reps"]')).toHaveCount(1);
  await page.mouse.up();

  await expect(ligne(page, 2).getByLabel('Reps', { exact: true })).toHaveValue('8');
  await expect(ligne(page, 3).getByLabel('Reps', { exact: true })).toHaveValue('15');
  await expect(ligne(page, 4).getByLabel('Reps', { exact: true })).toHaveValue('60');
  await expect(page.locator('[data-recopie-cible]')).toHaveCount(0);
});

test('le RPE cible se recopie, le RPE réel reste où il est', async ({ page }) => {
  /** MUTATION QUI ROUGIT : poser la poignée sur la colonne du RPE réel. */
  await ouvrirLaSeance(page);
  await ligne(page, 0).getByLabel('RPE cible').focus();
  await tirer(page, 'aimedRPE', 1);
  await page.mouse.up();

  await expect(ligne(page, 1).getByLabel('RPE cible')).toHaveValue('8');
  // Le réalisé n'est plus dans le tableau du coach (30/09 : « quand on programme,
  // on n'a pas besoin du réel ») — seules les cases de prescription portent une
  // poignée, le repos compris, qui est dans la rangée.
  const champs = await seance(page).locator('[data-poignee-recopie]').evaluateAll(
    (els) => [...new Set(els.map((e) => e.getAttribute('data-poignee-recopie')))]);
  expect(champs.sort()).toEqual(['aimedRPE', 'reps', 'rest', 'sets', 'weight']);
});

test.describe('au doigt', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } });

  test('la poignée n’existe pas', async ({ page }) => {
    /** MUTATION QUI ROUGIT : `block` au lieu de `pointer-fine:…:block`. */
    await ouvrirLaSeance(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await ligne(page, 2).getByLabel('Reps', { exact: true }).focus();
    await expect(page.locator('[data-poignee-recopie="reps"]:visible')).toHaveCount(0);
  });
});
