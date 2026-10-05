import { expect, test } from '@playwright/test';

/** Smoke : le dev-mock démarre sans login et chaque route rend son contenu.
 *  Couvre nav/affichage/logique locale — PAS la persistance (mock local). */

test('charge le dev-mock sans login', async ({ page }) => {
  await page.goto('/');
  // Pas d'écran de connexion (bypass en dev-mock).
  await expect(page.getByText(/Se connecter avec Google/i)).toHaveCount(0);
  // Les athlètes mock déterministes sont là (sidebar).
  await expect(page.getByText('Léa Martin').first()).toBeVisible();
});

test('dashboard : Table RM et records', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByText('Table RM').first()).toBeVisible();
  await expect(page.getByText(/Records personnels/i).first()).toBeVisible();
  await expect(page.getByText('Objectifs').first()).toBeVisible();
});

test('training : arbre du programme + semaine', async ({ page }) => {
  await page.goto('/training');
  await expect(page.getByText('Prépa FNSL').first()).toBeVisible();
  // La sélection par date atterrit sur une semaine avec au moins une séance.
  await expect(page.getByText(/Séance 1/).first()).toBeVisible();
});

test('tracker : carte de saisie du jour (athlète mock = soi)', async ({ page }) => {
  await page.goto('/tracker');
  await expect(page.getByText(/Aujourd'hui|Rattrapage/).first()).toBeVisible();
});

test('calendrier : frise de périodisation', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.getByText('Accumulation').first()).toBeVisible();
  await expect(page.getByText('Intensification').first()).toBeVisible();
  // ⚠️ UNE SEULE VUE : l'onglet « Périodisation » a disparu le 16/09, la frise le remplace.
  await expect(page.getByRole('tab')).toHaveCount(0);
});

test('bibliothèque : onglets + entrées', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('button', { name: /Renforcement/ }).first()).toBeVisible();
  await expect(page.getByText('MUSCLE UP').first()).toBeVisible();
});

test('admin : filtres et équipe', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('tab', { name: /Équipe/ })).toBeVisible();
  await expect(page.getByText('Coach Démo').first()).toBeVisible();
});

test('URL inconnue → redirection dashboard', async ({ page }) => {
  await page.goto('/nimporte-quoi');
  await expect(page).toHaveURL(/\/dashboard$/);
});
