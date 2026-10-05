import { expect, test } from '@playwright/test';

/** Disponibilité des coachs sur une compétition (FRE-22).
 *
 *  Le point qui compte : `pending` est un ÉTAT AFFICHÉ, pas une case vide.
 *  C'est lui qui montre combien de réponses manquent. */

async function openCompetition(page: import('@playwright/test').Page) {
  await page.goto('/competitions');
  await page.getByRole('button').filter({ hasText: /FNSL Inter-Région/ }).first().click();
}

test('la matrice coach × jour est complète dès l’ouverture', async ({ page }) => {
  await openCompetition(page);
  await expect(page.getByText('Coachs au plateau')).toBeVisible();

  // Compétition sur 2 jours × 2 coachs : 4 cases, toutes « pas encore répondu ».
  const cells = page.getByRole('button', { name: /Pas encore répondu/ });
  await expect(cells).toHaveCount(4);
  await expect(page.getByText(/4 réponses attendues/)).toBeVisible();
});

test('chaque case nomme le coach, le jour et l’état', async ({ page }) => {
  await openCompetition(page);
  // Nom accessible complet : une grille d'icônes serait muette sans ça.
  await expect(page.getByRole('button', { name: /Aubin — .* : Pas encore répondu/ })).toHaveCount(2);
});
