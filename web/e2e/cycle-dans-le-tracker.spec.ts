import { expect, test, type Page } from '@playwright/test';
import { choisirAthlete } from './aides-athlete';

/** LE CYCLE MENSTRUEL QUITTE LE CALENDRIER POUR LE TRACKER (FRE-173).
 *
 *  Une phase de cycle est un FAIT DU JOUR, comme une pesée — pas un événement
 *  daté de… à… La seule entrée jamais saisie dans le calendrier couvrait 117
 *  jours : c'était le patron qui était faux.
 *
 *  Ce que ces specs gardent :
 *    1. l'athlète déclare sa phase depuis la carte de saisie du Tracker, et un
 *       jour sans déclaration ne vaut pas « menstruation » ;
 *    2. la phase se lit EN FOND du graphe journalier, une bande par jour déclaré,
 *       et la légende ne nomme que les phases présentes ;
 *    3. qui n'est pas l'athlète ne voit pas la saisie (l'écriture est `owner`
 *       côté serveur — `test_daily_logs.py` garde le 403) ;
 *    4. le calendrier ne propose plus le type « cycle ».
 *
 *  Le mock déclare menstruation sur quatre jours et ovulation sur deux, avec
 *  des jours sans rien entre les deux.
 */

const saisie = (page: Page) => page.getByRole('group', { name: 'Cycle' });

test('l’athlète déclare sa phase du jour, et rien n’est présumé sans déclaration', async ({ page }) => {
  // Léa est l'athlète choisie d'office dans le mock, et c'est « Mon profil » :
  // la saisie lui est ouverte. (La recliquer dans la barre la DÉSÉLECTIONNE.)
  await page.goto('/tracker');
  await expect(saisie(page)).toBeVisible();
  for (const phase of ['Menstruation', 'Folliculaire', 'Ovulation', 'Lutéale']) {
    await expect(saisie(page).getByRole('button', { name: phase })).toBeVisible();
  }
  // Aujourd'hui n'a pas de phase dans le mock : aucune enfoncée, et c'est dit.
  await expect(saisie(page).locator('button[aria-pressed="true"]')).toHaveCount(0);
  await expect(saisie(page).getByText('Non déclaré')).toBeVisible();
});

test('la phase se lit en fond du graphe, et la légende ne nomme que ce qui est là', async ({ page }) => {
  await page.goto('/tracker');
  const graphe = page.locator('section', { has: page.getByRole('button', { name: 'Poids', pressed: true }) });
  // Quatre jours de menstruation, deux d'ovulation : six bandes, pas trente.
  await expect(graphe.locator('svg rect')).toHaveCount(6);
  // `ul[aria-label]` et non `getByRole('list')` : une liste sans puces perd son
  // rôle dans Chromium, et le sélecteur par rôle ne la trouve plus.
  const legende = graphe.locator('ul[aria-label="Cycle"]');
  await expect(legende.getByText('Menstruation')).toBeVisible();
  await expect(legende.getByText('Ovulation')).toBeVisible();
  await expect(legende.getByText('Lutéale')).toHaveCount(0);
});

test('qui n’est pas l’athlète lit le fond, mais ne déclare rien', async ({ page }) => {
  await page.goto('/tracker');
  await choisirAthlete(page, /Théo Bernard/);
  await expect(saisie(page)).toHaveCount(0);
});

test('le calendrier ne propose plus le type « cycle »', async ({ page }) => {
  await page.goto('/calendar');
  // Le calendrier n'a plus qu'une vue, la frise, et le formulaire vit dessous (16/09).
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  // La tuile des vacances prouve que le formulaire est ouvert — plus celle de la
  // compétition, qui ne se saisit plus ici.
  await expect(page.getByTitle('Vacances', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '♀' })).toHaveCount(0);
  await expect(page.getByText('Menstruation')).toHaveCount(0);
});
