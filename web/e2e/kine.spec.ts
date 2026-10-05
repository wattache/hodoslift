import { expect, test, type Page } from '@playwright/test';

/** SUIVI KINÉ — l'athlète rapporte, son staff lit.
 *
 *  ⚠️ CE QUE CES SPECS NE PROUVENT PAS : la persistance. Les écritures du mock
 *  sont des no-op. Le contrat avec brokkr est couvert par `tests/test_douleurs.py`
 *  et par le harnais réel. Ce qui se joue ICI, c'est la règle d'affordance :
 *  QUI voit un champ de saisie, et qui n'en voit pas.
 *
 *  ⚠️ IL N'Y A PLUS D'ONGLET « AU JOUR LE JOUR » (FRE-195). Il ne portait que le
 *  questionnaire de douleur, en texte libre, à côté d'un onglet Douleurs qui
 *  pose la même question en mieux. Poser deux fois la même chose, c'est la règle
 *  dupliquée que ce dépôt interdit — et le texte libre ne se relisait pas :
 *  sept des huit saisies de production précisaient un côté qu'aucune requête ne
 *  savait retrouver. */

const allerAuSuivi = async (page: Page) => {
  await page.goto('/kine');
  await expect(page.getByRole('heading', { name: 'Mon épaule' })).toBeVisible();
};

test('l’onglet existe et mène au suivi', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('link', { name: /Suivi kiné|Physio/ }).click();

  await expect(page).toHaveURL(/\/kine$/);
});

test('le suivi s’ouvre sur les DOULEURS, pas sur un questionnaire', async ({ page }) => {
  await allerAuSuivi(page);
  // L'onglet par défaut : c'est ce que le staff et l'athlète viennent voir.
  await expect(page.getByRole('tab', { name: /^(Douleurs|Pain)$/ })).toHaveAttribute(
    'aria-selected', 'true');
  // ⚠️ ET PLUS DE « AU JOUR LE JOUR » : sa disparition est le sujet du ticket,
  // pas un effet de bord. Le voir revenir voudrait dire qu'on repose la même
  // question à deux endroits.
  await expect(page.getByRole('tab', { name: /Au jour le jour|Day by day/ })).toHaveCount(0);
});

test('l’athlète lui-même SAISIT', async ({ page }) => {
  await allerAuSuivi(page);
  // ⚠️ IL N'Y A PLUS DE BOUTON « SIGNALER » : la figure est là d'emblée, et
  // c'est elle l'affordance. Ce qui distingue l'athlète du staff n'est donc
  // plus un bouton de plus, mais le fait que les muscles soient des BOUTONS —
  // en lecture seule ils redeviennent des images.
  await expect(page.locator('svg[role="group"]').first().getByRole('button').first())
    .toBeAttached();
  await expect(page.locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Mon épaule', exact: true }) }).last()
    .getByRole('button', { name: /Noter aujourd'hui|Corriger la note|Log today|Edit today/ }))
    .toBeVisible();
});

test('les autres onglets du suivi restent atteignables', async ({ page }) => {
  await allerAuSuivi(page);
  await page.getByRole('tab', { name: /^(Bilans|Assessments)$/ }).click();
  await expect(page).toHaveURL(/vue=bilans/);
});
