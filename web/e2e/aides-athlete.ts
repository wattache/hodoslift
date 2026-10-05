import type { Page } from '@playwright/test';

/** CHOISIR UN ATHLÈTE — par le sélecteur de l'en-tête (Passe 3, constat 07, 14/09).
 *
 *  ⚠️ LA LISTE LATÉRALE A DISPARU. Les specs cliquaient le nom dans la barre de
 *  gauche ; le choix se fait maintenant par le déclencheur de l'en-tête, qui
 *  ouvre un panneau où chaque athlète est une `option`. Un seul endroit décrit ce
 *  geste : le jour où il change encore, une fonction bouge, pas dix specs. */
export async function choisirAthlete(page: Page, nom: RegExp | string): Promise<void> {
  await page.getByRole('button', { name: /Changer d'athlète|Switch athlete/ }).click();
  await page.getByRole('option', { name: nom }).click();
}
