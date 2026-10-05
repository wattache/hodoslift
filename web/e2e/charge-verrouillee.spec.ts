import { expect, test, type Page } from '@playwright/test';

/** Verrou de charge (`weightLocked`) — la moitié VISIBLE du défaut du 15/08.
 *
 *  Le champ est un booléen depuis Postgres (`boolean NOT NULL DEFAULT false`),
 *  mais tout le front le comparait encore à la chaîne `'true'`. Conséquence :
 *  aucune ligne ne paraissait verrouillée, le cadenas restait ouvert, et le
 *  bouton ne pouvait plus déverrouiller. TypeScript interdit désormais la
 *  comparaison — ce test garde la contrepartie qu'il ne voit pas : ce que le
 *  coach a sous les yeux.
 *
 *  Fixture : bloc « Intensification », semaine 1, séance 1 — le MUSCLE UP y est
 *  verrouillé à 9 kg. Les écritures du mock sont des no-op (cf. FRE-35) : ce
 *  test couvre l'affichage et la bascule locale, pas la persistance.
 */

const ouvrirLaLigneVerrouillee = async (page: Page) => {
  await page.goto('/training');
  // Le cadenas n'existe QUE dans la vue d'édition du coach : côté athlète, la
  // charge est une consigne à lire, pas à verrouiller.
  await page.getByRole('button', { name: 'Coach' }).click();
  // Pas de clic sur le bloc, la semaine ni la séance : la fixture les ouvre
  // DÉJÀ (dernier bloc, semaine 1, séance 1), et chacun de ces boutons est une
  // bascule — les cliquer REFERMAIT le panneau au lieu de l'ouvrir. On vérifie
  // plutôt qu'on a bien la ligne attendue sous les yeux : si la sélection par
  // défaut change un jour, l'échec dira lequel des deux a bougé.
  await expect(page.getByText('MUSCLE UP').first()).toBeVisible();
};

/** ⚠️ CE SÉLECTEUR ÉTAIT `page.locator('button[aria-pressed]').first()` — « le
 *  premier bouton pressable DE LA PAGE ». Il a volé sa cible trois fois : aux
 *  jours de la semaine, aux boutons de forme du jour, puis à la bascule
 *  Aperçu/Éditer des objectifs de bloc. À chaque fois la spec tombait en
 *  dénonçant un composant qui n'avait rien fait — un sélecteur positionnel sur
 *  la page entière casse dès qu'une bascule apparaît AILLEURS, et ne dit jamais
 *  pourquoi.
 *
 *  L'intention d'origine reste juste : ne pas dépendre d'un libellé traduit. Elle
 *  est tenue autrement — les deux états partagent une racine dans les deux
 *  langues (« verrouiller » / « déverrouiller », « lock » / « unlock »), donc le
 *  motif désigne le cadenas et lui seul, dans n'importe quelle locale.
 *  `.first()` prend celui du premier exercice, qui est le MUSCLE UP de la
 *  fixture. */
const cadenas = (page: Page) =>
  page.getByRole('button', { name: /verrouill|lock/i }).first();

test('une charge verrouillée s’affiche comme telle', async ({ page }) => {
  await ouvrirLaLigneVerrouillee(page);
  await expect(cadenas(page)).toHaveAttribute('aria-pressed', 'true');
});

test('le cadenas se déverrouille et se reverrouille', async ({ page }) => {
  await ouvrirLaLigneVerrouillee(page);
  const bouton = cadenas(page);

  await bouton.click();
  await expect(bouton).toHaveAttribute('aria-pressed', 'false');

  await bouton.click();
  await expect(bouton).toHaveAttribute('aria-pressed', 'true');
});
