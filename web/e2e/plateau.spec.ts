import { expect, test } from '@playwright/test';

/** LE PLATEAU AU CLAVIER, sur le dev-mock (FRE-204).
 *
 *  Chaque geste du plateau est un vrai bouton : choisir un groupe et un athlète,
 *  mettre un essai en barre, annoncer, juger — sans souris. Le mock porte la
 *  compétition « FNSL » : le groupe A a fini son muscle up, le B en est au
 *  deuxième essai. */

test('au clavier : un groupe, un athlète, une case, une annonce, un verdict', async ({ page }) => {
  await page.goto('/competitions/comp-2');
  const bloc = page.getByRole('region', { name: 'Groupes et athlètes' });
  const enBarre = page.getByRole('region', { name: 'En barre' });
  const presser = async (cible: import('@playwright/test').Locator) => { await cible.focus(); await page.keyboard.press('Enter'); };

  await presser(bloc.getByRole('button', { name: 'Groupe B', exact: true }));
  await presser(bloc.getByRole('button', { name: /^Karim Belhadj/ }).first());

  // La case du deuxième muscle up de Karim : elle le met en barre, et le tour suit.
  const caseDeKarim = page.getByRole('button', { name: /^Karim Belhadj — MUSCLE UP essai 2/ });
  await presser(caseDeKarim);
  await expect(caseDeKarim).toHaveAttribute('aria-pressed', 'true');
  await expect(enBarre.getByRole('heading', { name: 'Karim Belhadj' })).toBeVisible();
  await expect(page.getByText(/Tour 14 \/ 24 · Groupe B/)).toBeVisible();

  // Annoncer son R, puis juger.
  const tierR = enBarre.getByRole('group', { name: /Charges du plan/ }).getByRole('button', { name: /^22.5/ });
  await presser(tierR);
  await expect(tierR).toHaveAttribute('aria-pressed', 'true');
  await expect(enBarre.getByText(/annoncé R/)).toBeVisible();

  await presser(enBarre.getByRole('button', { name: 'REP', exact: true }));
  // Le verdict ramène au plateau — le groupe A n'a pas fini ses tours —, et le total de Karim suit.
  await expect(page.getByText(/Tour 4 \/ 24 · Groupe A/)).toBeVisible();
  await expect(page.locator('li').filter({ hasText: 'Karim Belhadj' }).filter({ hasText: '22.5 kg' })).toHaveCount(1);
});
