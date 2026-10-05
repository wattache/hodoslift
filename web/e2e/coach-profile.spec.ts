import { expect, test } from '@playwright/test';

/** « Ma page publique » — le coach édite ce que sert le site vitrine (FRE-30).
 *
 *  Ce qui mérite d'être verrouillé n'est pas la mise en page mais la FRONTIÈRE
 *  d'écriture : trois champs éditables, et deux affichages qui ne doivent PAS
 *  l'être. Proposer un champ que brokkr refuse, c'est promettre une écriture qui
 *  n'aura pas lieu — le coach corrigerait un chiffre qui redeviendrait faux à la
 *  projection suivante. */

test('le formulaire arrive pré-rempli avec le profil existant', async ({ page }) => {
  await page.goto('/ma-page');

  await expect(page.getByLabel('Accroche')).toHaveValue('Coach street & force');
  await expect(page.getByLabel('Bio')).toHaveValue('Accompagne des compétiteurs depuis 2019.');
  await expect(page.getByLabel('Instagram')).toHaveValue('https://www.instagram.com/frenchforge/');
});

test('l’adresse de la page est un lien, pas un champ, une fois créée', async ({ page }) => {
  await page.goto('/ma-page');

  // Le slug est IMMUABLE côté serveur (409) : un champ éditable inviterait à un
  // geste qui échoue. On montre le lien, qui sert aussi à aller voir le résultat.
  await expect(page.getByRole('link', { name: /coachs\/coach-demo/ })).toBeVisible();
  await expect(page.getByLabel('Adresse de la page')).toHaveCount(0);
});

test('les records sont affichés mais pas éditables', async ({ page }) => {
  await page.goto('/ma-page');

  // Projection de la Table RM, rafraîchie chaque nuit — éditable ici, ce serait
  // promettre une correction que la projection écraserait le lendemain.
  await expect(page.getByText('200 kg')).toBeVisible();
  const section = page.locator('section', { hasText: 'Records affichés' });
  await expect(section.locator('input')).toHaveCount(0);
});

test('un record à 0 ne s’affiche pas comme un chiffre', async ({ page }) => {
  await page.goto('/ma-page');

  // 0 n'est pas un record, c'est un chiffre non communiqué : l'afficher dirait
  // le contraire de la vérité sur le coach. Le mock a 4 mouvements renseignés,
  // `chinUp` à 0 — et depuis FRE-147 le bench et le deadlift, que ce coach n'a
  // pas encore saisis. On vérifie le PARTAGE exact, pas juste l'absence d'un
  // texte : 4 chiffres, 3 tirets sur sept places.
  const valeurs = page.locator('section', { hasText: 'Records affichés' }).locator('dd');
  await expect(valeurs.filter({ hasText: /kg$/ })).toHaveCount(4);
  await expect(valeurs.filter({ hasText: /^—$/ })).toHaveCount(3);
});

test('la vue dit que le contenu est public', async ({ page }) => {
  await page.goto('/ma-page');

  // Un coach saisit une bio en croyant remplir son profil applicatif : la page
  // doit dire, avant la saisie, que ça part sur le web ouvert.
  await expect(page.getByText(/visible par tout le monde/)).toBeVisible();
});

/* --- Langues parlées (FRE-30) ------------------------------------------- */

test('les langues du profil s’affichent en puces', async ({ page }) => {
  await page.goto('/ma-page');

  await expect(page.getByRole('button', { name: 'Retirer Français' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retirer Anglais' })).toBeVisible();
});

test('ajouter une langue la retire des choix proposés', async ({ page }) => {
  await page.goto('/ma-page');
  const menu = page.getByLabel('Ajouter une langue');

  await menu.selectOption('pl');

  // Une langue déjà déclarée ne doit plus être proposée : sinon un coach peut la
  // choisir deux fois et se retrouver avec un doublon sur sa page publique.
  await expect(page.getByRole('button', { name: 'Retirer Polonais' })).toBeVisible();
  await expect(menu.locator('option[value="pl"]')).toHaveCount(0);
});

test('retirer une langue la remet dans les choix', async ({ page }) => {
  await page.goto('/ma-page');

  await page.getByRole('button', { name: 'Retirer Anglais' }).click();

  await expect(page.getByRole('button', { name: 'Retirer Anglais' })).toHaveCount(0);
  await expect(page.getByLabel('Ajouter une langue').locator('option[value="en"]')).toHaveCount(1);
});
