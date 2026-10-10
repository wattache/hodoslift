import { expect, test } from '@playwright/test';

/** LE PLATEAU AU CLAVIER, sur le dev-mock (FRE-204, FRE-225).
 *
 *  Chaque geste du plateau est un vrai bouton : choisir un groupe et un athlète,
 *  toucher un essai, annoncer, juger — sans souris, et tout sur la carte de
 *  l'athlète. Le mock porte « comp-2 » sous le règlement FinalRep : le groupe A
 *  a fini son muscle up, le B en est au deuxième essai. */

test('au clavier : un groupe, un athlète, une case, une annonce, un verdict, un motif FinalRep', async ({ page }) => {
  await page.goto('/competitions/comp-2');
  const bloc = page.getByRole('region', { name: 'Groupes et athlètes' });
  const presser = async (cible: import('@playwright/test').Locator) => { await cible.focus(); await page.keyboard.press('Enter'); };

  await presser(bloc.getByRole('button', { name: 'Groupe B', exact: true }));
  await presser(bloc.getByRole('button', { name: /^Karim Belhadj/ }).first());

  // La case du deuxième muscle up de Karim : elle ouvre la saisie sous sa carte.
  const caseDeKarim = page.getByRole('button', { name: /^Karim Belhadj — MUSCLE UP essai 2/ });
  await presser(caseDeKarim);
  await expect(caseDeKarim).toHaveAttribute('aria-pressed', 'true');
  const saisie = page.getByRole('region', { name: 'MUSCLE UP · essai 2' });
  await expect(saisie).toBeVisible();
  // Pas d'encart qui suit la séquence : c'est la carte qui saisit.
  await expect(page.getByRole('region', { name: 'En barre' })).toHaveCount(0);

  // Annoncer son R : la case ne montre plus que l'annonce.
  const tierR = saisie.getByRole('group', { name: /Charges du plan/ }).getByRole('button', { name: /^22.5/ });
  await presser(tierR);
  await expect(tierR).toHaveAttribute('aria-pressed', 'true');
  await expect(caseDeKarim).toHaveText('22.5R');

  await presser(saisie.getByRole('button', { name: 'REP', exact: true }));
  await expect(page.locator('li').filter({ hasText: 'Karim Belhadj' }).filter({ hasText: '22.5 kg' })).toHaveCount(1);
  // La carte n'a pas bougé : c'est toujours Karim.
  await expect(bloc.getByRole('heading', { level: 3, name: 'Karim Belhadj' })).toBeVisible();

  // Un no rep demande son motif, dans la liste FinalRep de la compétition.
  await presser(saisie.getByRole('button', { name: 'NO REP', exact: true }));
  const motifs = saisie.getByRole('combobox', { name: 'Motif du no rep' });
  await expect(motifs.locator('option[value="fr_chicken_wing"]')).toHaveCount(1);
  await expect(motifs.locator('option[value="mu_kipping"]')).toHaveCount(0);
});
