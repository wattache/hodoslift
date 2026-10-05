import { expect, test } from '@playwright/test';

/** LA PAGE ADMIN RANGÉE PAR PERSONNE (19/09) — la NAVIGATION, sur le dev-mock.
 *
 *  Ce que le mock peut prouver : une liste, une fiche, et le passage de l'une à
 *  l'autre — deux écrans sur téléphone, deux colonnes à partir de 1024 px. Les
 *  écritures (rôles, réaffectation) se prouvent dans `e2e-reel/admin-par-personne`,
 *  le mock ne persistant rien. */

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la liste puis la fiche, deux écrans, et le retour « Équipe »', async ({ page }) => {
    await page.goto('/admin');
    const filtre = page.getByRole('tab', { name: /Équipe/ });
    await expect(filtre).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);

    await page.getByRole('list', { name: 'Personnes' }).getByRole('button', { name: /^Coach Démo/ }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Coach Démo' })).toBeVisible();
    // La liste a cédé la place : ses filtres ne sont plus là.
    await expect(filtre).toBeHidden();
    await expect(page.getByText(/Compte admin, non retirable/)).toBeVisible();

    await page.getByRole('button', { name: /Équipe/ }).click();
    await expect(filtre).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
  });

  test('« Sans rôle » liste ceux à qui il reste un rôle à donner', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('tab', { name: /Sans rôle/ }).click();
    // Le mock n'en a aucun : la liste est vide, et le dit.
    await expect(page.getByText(/Personne ici/)).toBeVisible();
  });
});

test('ordinateur : la liste à gauche, la fiche à droite', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByText(/Choisis une personne/)).toBeVisible();
  // ⚠️ DANS LA LISTE, ET AU DÉBUT DU NOM : le sélecteur d'athlète de l'en-tête
  // s'appelle aussi « Léa Martin », et « Suivi par Coach Démo » est sur d'autres lignes.
  await page.getByRole('list', { name: 'Personnes' }).getByRole('button', { name: /^Léa Martin/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Léa Martin' })).toBeVisible();
  // Les deux en même temps.
  await expect(page.getByRole('tab', { name: /Équipe/ })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /Coach qui le suit/ })).toHaveValue('mock-coach');
});

test('ordinateur : la liste défile CHEZ ELLE, la fiche reste à l’écran', async ({ page }) => {
  /** ⚠️ CLIQUER QUELQU'UN EN BAS DE LISTE NE SEMBLAIT RIEN FAIRE. Avec 71
   *  personnes en production, la page entière défilait : la fiche changeait
   *  bien, mais tout en haut, hors champ — « j'avais l'impression que rien ne
   *  se passait » (William, 23/09). Un écran qui répond ailleurs qu'où l'on
   *  regarde ne répond pas.
   *
   *  MUTATION QUI ROUGIT : retirer `lg:h-[…]` de la grille — la liste reprend
   *  sa hauteur naturelle, plus rien ne défile chez soi, et la fiche repart
   *  au-dessus du champ de vision.
   *
   *  ⚠️ FENÊTRE COURTE À DESSEIN : le jeu de démonstration n'a que treize
   *  personnes, contre soixante et onze en production. Sans cette contrainte,
   *  la liste tiendrait à l'écran et la spec serait verte sans rien prouver. */
  await page.setViewportSize({ width: 1400, height: 620 });
  await page.goto('/admin');
  // ⚠️ ON ATTEND LES PERSONNES, PAS LE PANNEAU VIDE : « Choisis une personne »
  // s'affiche avant que la liste soit chargée, et on mesurerait alors une boîte
  // d'une seule ligne — qui ne déborde de rien.
  const rangees = page.getByRole('list', { name: 'Personnes' }).getByRole('listitem');
  await expect(rangees.nth(3)).toBeVisible();

  const etat = await page.evaluate(() => {
    const liste = [...document.querySelectorAll('ul')]
      .find(u => u.className.includes('overflow-y-auto'))!;
    return {
      listeDefile: liste.scrollHeight > liste.clientHeight + 1,
      pageDefile: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  });
  expect(etat.listeDefile, 'la liste doit défiler dans sa propre boîte').toBe(true);
  expect(etat.pageDefile, 'la page entière ne doit pas défiler').toBe(false);

  // On va au bout de la liste et on ouvre la DERNIÈRE personne : c'est le cas
  // où la fiche partait hors champ.
  const nom = await page.evaluate(() => {
    const liste = [...document.querySelectorAll('ul')]
      .find(u => u.className.includes('overflow-y-auto'))!;
    liste.scrollTop = liste.scrollHeight;
    const boutons = [...liste.querySelectorAll('li button')];
    const dernier = boutons[boutons.length - 1] as HTMLButtonElement;
    dernier.click();
    return dernier.textContent ?? '';
  });
  expect(nom.length).toBeGreaterThan(0);

  const fiche = page.getByRole('heading', { level: 2 });
  await expect(fiche).toBeVisible();
  // ⚠️ VISIBLE NE SUFFIT PAS : Playwright la dirait visible même posée à 2 000
  // pixels du haut. On mesure qu'elle est DANS l'écran.
  const boite = await fiche.boundingBox();
  expect(boite!.y, `fiche à ${Math.round(boite!.y)}px du haut`).toBeLessThan(620);
  expect(boite!.y).toBeGreaterThanOrEqual(0);
});
