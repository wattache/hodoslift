import { expect, test } from '@playwright/test';
import { ATHLETE, BROKKR, colonne, jeton, seConnecter } from './aides';

/** LE POIDS PAR SEMAINE, CONTRE LA VRAIE PILE (29/09).
 *
 *  ⚠️ POURQUOI ICI. Le dev-mock fige le tableau : « la moyenne est juste » et
 *  « la moyenne est CALCULÉE par brokkr depuis les pesées » y sont
 *  indiscernables. La promesse est le chemin entier — des pesées écrites par
 *  l'athlète, un départ posé à l'écran, et un tableau qui en découle : moyenne
 *  de la semaine, écart depuis le départ. `colonne()` lit le départ en base. */

const ATHLETE_ID = 'e2e-athlete';
const enBase = () => colonne(`SELECT coalesce(poids_depart_kg::text, 'NULL') FROM athletes WHERE legacy_id = '${ATHLETE_ID}'`);
const nettoyer = () => {
  colonne(`DELETE FROM daily_logs WHERE athlete_id = (SELECT id FROM athletes WHERE legacy_id = '${ATHLETE_ID}')`);
  colonne(`UPDATE athletes SET poids_depart_kg = NULL, poids_depart_le = NULL WHERE legacy_id = '${ATHLETE_ID}'`);
};

const jourIl_y_a = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

async function peser(date: string, weight: number) {
  const r = await fetch(`${BROKKR}/athletes/${ATHLETE_ID}/daily-logs/${date}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${await jeton(ATHLETE)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ weight }),
  });
  if (!r.ok) throw new Error(`pesée refusée : ${r.status} ${await r.text()}`);
}

test.beforeEach(nettoyer);
test.afterEach(nettoyer);

test('des pesées, un départ posé à l’écran, et le tableau qui en découle', async ({ page }) => {
  // Trois pesées la semaine dernière (jours 8, 9, 10 en arrière), une aujourd'hui.
  await peser(jourIl_y_a(10), 100);
  await peser(jourIl_y_a(9), 99);
  await peser(jourIl_y_a(8), 98);
  await peser(jourIl_y_a(0), 96);

  await seConnecter(page, ATHLETE);
  await page.goto('/tracker');
  await page.getByRole('tab', { name: 'Poids par semaine' }).click();

  // Sans départ : les écarts partent de la première semaine pesée, et l'écran le dit.
  await expect(page.locator('[data-depart]')).toContainText('Pas de poids de départ');
  await expect(page.locator('[data-semaine="1"] [data-moyenne]')).toHaveText('99,0');

  // Le départ : 102 kg il y a dix jours → deux semaines, écarts depuis 102.
  await page.getByRole('button', { name: 'Poser le départ' }).click();
  // La date d'abord : elle reprend la pesée du jour (100), qu'on corrige ensuite.
  await page.getByTitle('Date du départ').click();
  // ⚠️ IL Y A DIX JOURS PEUT ÊTRE LE MOIS D'AVANT : le calendrier s'ouvre sur le
  // mois courant. Écrite le 29/09, la spec a rougi le 05/10 — le 25/09 n'était
  // plus à l'écran. On recule d'un mois tant que le jour n'y est pas.
  const jour = page.locator(`[role="gridcell"][data-day="${jourIl_y_a(10)}"] button`);
  for (let mois = 0; mois < 2 && !(await jour.isVisible()); mois++) {
    await page.getByRole('button', { name: 'Aller au mois précédent' }).click();
  }
  await jour.click();
  await page.keyboard.press('Escape');
  const kg = page.getByRole('spinbutton', { name: 'Poids de départ' });
  await expect(kg).toHaveValue('100');
  await kg.fill('102');
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  await expect.poll(enBase).toBe('102');
  await expect(page.locator('[data-depart]')).toContainText('102,0 kg');
  await expect(page.locator('[data-poids-semaines] tbody tr')).toHaveCount(2);
  await expect(page.locator('[data-semaine="1"] [data-moyenne]')).toHaveText('99,0');
  await expect(page.locator('[data-semaine="1"] [data-ecart]')).toHaveText('−3,0 kg');
  await expect(page.locator('[data-semaine="2"] [data-ecart]')).toHaveText('−6,0 kg');

  await page.getByRole('button', { name: 'Effacer' }).click();
  await expect.poll(enBase).toBe('NULL');
});
