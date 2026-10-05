import { expect, test, type Page } from '@playwright/test';

/** LA RÉPARTITION DU CYCLE — J1 … Jn (20/09), sur le dev-mock.
 *
 *  Ce que le mock peut prouver : la grille, les gestes et ce qu'ils affichent.
 *  Ce qu'il ne peut PAS (les écritures ne persistent pas) : qu'un cycle de neuf
 *  jours arrive jusqu'à Postgres, et que la fin de S1 suive — c'est
 *  `e2e-reel/cycle-de-neuf-jours` qui s'en charge.
 *
 *  Le bloc « Intensification » du mock porte une grille de cinq jours (J1 … J5,
 *  deux tiers et deux accessoires sur J5). */

async function ouvrirLaBase(page: Page) {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: /Éditer la BASE du bloc|Edit the block template/ }).click();
  await expect(page.getByRole('heading', { name: /Répartition du cycle|Cycle split/ })).toBeVisible();
}

const duree = (page: Page) => page.getByText(/^(\d+ jours?|\d+ days?)$/).first();
const caseDe = (page: Page, jour: string, mouvement: string) =>
  page.getByRole('button', { name: new RegExp(`^${jour}, ${mouvement}\\s*:`) });

test('la grille parle en jours de cycle, et les jours sans tier sont du repos', async ({ page }) => {
  await ouvrirLaBase(page);
  // ⚠️ AUCUN NOM DE SEMAINE DANS LA COLONNE JOUR : c'est tout l'objet du ticket.
  // Un « Lundi » comme IDENTITÉ voudrait dire que la grille n'a pas été migrée.
  // Depuis FRE-187 le coach peut en revanche NOMMER J1 « Lundi » — c'est un
  // libellé, saisi dans un champ à part, et la grille du mock n'en porte aucun.
  await expect(page.getByRole('cell', { name: /Lundi|Monday/ })).toHaveCount(0);
  // ⚠️ LA CELLULE DE JOUR, PAS LES CASES DE LA LIGNE : chacune porte le nom du
  // jour dans son libellé (« J1, MUSCLE UP : … »), et un `^J1` en attrape six.
  await expect(page.getByRole('cell', { name: /^J5$/ })).toBeVisible();
  // J1 ne porte aucun tier : il se dit au repos, sans qu'on ait rien à saisir.
  await expect(page.getByRole('cell', { name: /^J1\s*(repos|rest)$/ })).toBeVisible();
  await expect(page.getByText(/Après J5, le cycle repart à J1|After J5, the cycle restarts at J1/)).toBeVisible();
});

test('toucher une case fait tourner le tier : – → 1 → 2 → 3 → –', async ({ page }) => {
  await ouvrirLaBase(page);
  const cellule = caseDe(page, 'J2', 'MUSCLE UP');
  await expect(cellule).toHaveText('–');
  for (const attendu of ['1', '2', '3', '–']) {
    await cellule.click();
    await expect(cellule).toHaveText(attendu);
  }
  // ⚠️ LE CHIFFRE EST TOUJOURS ÉCRIT : la couleur ne doit jamais être la seule
  // information — c'est la cause du défaut d'origine (jeudi orange, vendredi
  // rouge, deux coachs qui confondent).
  await cellule.click();
  await expect(cellule).toHaveText('1');
});

test('le clavier fait tourner la case comme le doigt', async ({ page }) => {
  await ouvrirLaBase(page);
  const cellule = caseDe(page, 'J3', 'PULL UP');
  await cellule.focus();
  await page.keyboard.press('Enter');
  await expect(cellule).toHaveText('1');
  await page.keyboard.press('Space');
  await expect(cellule).toHaveText('2');
});

test('la ligne « Sur le cycle » compte les placements, et dit « jamais »', async ({ page }) => {
  await ouvrirLaBase(page);
  // SQUAT est placé une fois (tier 1 sur J5) ; CHIN UP nulle part.
  await expect(page.getByLabel(/1 fois en Primaire|1 time as Primary/)).toBeVisible();
  await expect(page.getByText(/jamais|never/).first()).toBeVisible();
});

test('le stepper ajoute un jour vide, et le retire sans rien demander', async ({ page }) => {
  await ouvrirLaBase(page);
  await expect(duree(page)).toHaveText(/^5 (jours|days)$/);

  await page.getByRole('button', { name: /Ajouter un jour|Add a day/ }).click();
  await expect(duree(page)).toHaveText(/^6 (jours|days)$/);
  await expect(page.getByRole('cell', { name: /^J6\s*(repos|rest)$/ })).toBeVisible();

  // J6 est vide : il part sur le champ, sans question — on ne confirme que ce
  // qui se perd.
  await page.getByRole('button', { name: /Retirer un jour|Remove a day/ }).click();
  await expect(duree(page)).toHaveText(/^5 (jours|days)$/);
  await expect(page.getByRole('cell', { name: /^J6/ })).toHaveCount(0);
});

test('retirer un jour qui porte des réglages se confirme, et l’annulation ne retire rien', async ({ page }) => {
  await ouvrirLaBase(page);
  await page.getByRole('button', { name: /Retirer un jour|Remove a day/ }).click();

  // J5 porte deux tiers ET deux accessoires : la question dit ce qui part.
  await expect(page.getByText(/Retirer J5 du cycle|Remove J5 from the cycle/)).toBeVisible();
  await expect(page.getByText(/4 réglages|4 settings/)).toBeVisible();

  await page.getByRole('button', { name: /^(Annuler|Cancel)$/ }).click();
  await expect(duree(page)).toHaveText(/^5 (jours|days)$/);
  await expect(caseDe(page, 'J5', 'SQUAT')).toHaveText('1');
});

test('téléphone : quatre colonnes ou plus tiennent à 390 px, en abrégé', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrirLaBase(page);
  await expect(page.getByRole('columnheader', { name: 'MU' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'DIPS' })).toBeVisible();
  // ⚠️ PAS DE DÉFILEMENT HORIZONTAL : c'est la contrainte qui a fait choisir
  // `table-fixed` et les en-têtes courts, et rien d'autre ne la garde.
  const deborde = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(deborde).toBe(false);
});

test('un accessoire se compose dans un brouillon en tête, et rejoint la FIN de son jour', async ({ page }) => {
  /** ⚠️ RETOUR DE WILLIAM (30/09) : la ligne neuve partait tout en bas de la
   *  liste, et changer son jour la faisait sauter sous le doigt. Elle se compose
   *  maintenant dans un brouillon en surbrillance, en tête de section ; validée,
   *  elle se range à la fin de SON jour. MUTATION QUI ROUGIT : écrire la ligne
   *  dès le clic sur « Accessoire » — le compte monte avant la validation. */
  await ouvrirLaBase(page);
  // ⚠️ PAR LE RÔLE, PAS PAR `getByLabel` : le `<label>` enveloppe le `<select>`,
  // et son texte inclut alors les options — « JourJ1J2… » ne vaut jamais « Jour ».
  const brouillon = page.locator('[data-accessoire-brouillon]');
  const jours = page.getByRole('combobox', { name: 'Jour', exact: true });
  const avant = await jours.count();

  await page.getByRole('button', { name: 'Accessoire', exact: true }).click();
  await expect(brouillon).toBeVisible();
  // Le brouillon porte sa propre ligne de champs, mais RIEN n'est encore ajouté.
  await expect(jours).toHaveCount(avant + 1);
  await expect(brouillon.getByRole('button', { name: /^Ajouter à/ })).toBeDisabled();

  await brouillon.getByRole('combobox', { name: 'Jour', exact: true }).selectOption('J5');
  const mouvement = brouillon.getByRole('combobox', { name: 'Mouvement', exact: true });
  const choisi = await mouvement.locator('option').nth(1).getAttribute('value');
  await mouvement.selectOption({ index: 1 });
  await expect(brouillon).toContainText('il rejoindra la fin de J5');
  await brouillon.getByRole('button', { name: 'Ajouter à J5' }).click();

  // Validé : le brouillon se ferme, la ligne est la DERNIÈRE de son jour.
  await expect(brouillon).toHaveCount(0);
  await expect(jours).toHaveCount(avant + 1);
  const valeurs = await jours.evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
  const mouvements = await page.getByRole('combobox', { name: 'Mouvement', exact: true })
    .evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
  expect(valeurs.lastIndexOf('J5')).toBe(mouvements.lastIndexOf(choisi!));
});

test('« Annuler » jette le brouillon : rien n’est ajouté', async ({ page }) => {
  await ouvrirLaBase(page);
  const jours = page.getByRole('combobox', { name: 'Jour', exact: true });
  const avant = await jours.count();
  await page.getByRole('button', { name: 'Accessoire', exact: true }).click();
  await page.locator('[data-accessoire-brouillon]').getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('[data-accessoire-brouillon]')).toHaveCount(0);
  await expect(jours).toHaveCount(avant);
});

/** NOMMER LES JOURS DU CYCLE — FRE-187.
 *
 *  ⚠️ CE QUE CES DEUX SPECS GARDENT EST LE CÂBLAGE, pas la règle. Les fonctions
 *  sont déjà éprouvées seules (`src/lib/cycle.test.ts`) ; ce qui peut se défaire
 *  ici, c'est qu'un champ n'appelle plus rien, ou qu'un bouton disparaisse. */

const nomDuJour = (page: Page, jour: string) =>
  page.getByRole('textbox', { name: new RegExp(`^(Nom du jour|Day name) ${jour}$`) });

test('le coach nomme un jour, et le nom tient à côté de son J<n>', async ({ page }) => {
  await ouvrirLaBase(page);
  await nomDuJour(page, 'J2').fill('Haut du corps');

  await expect(nomDuJour(page, 'J2')).toHaveValue('Haut du corps');
  // ⚠️ `J2` RESTE AFFICHÉ, et ce n'est pas décoratif : c'est lui qui relie la
  // ligne aux accessoires datés du même jour, dans le tableau juste en dessous.
  // `.first()` : chaque case de la ligne porte « J2, MOUVEMENT : … », donc un
  // `^J2` en attrape six — la cellule de jour est la première de sa ligne.
  await expect(page.getByRole('cell', { name: /^J2/ }).first()).toBeVisible();
  // Les autres jours ne bougent pas — on nomme UN jour, pas la grille.
  await expect(nomDuJour(page, 'J1')).toHaveValue('');
});

test('à sept jours, les jours s’appellent comme la semaine sans rien cliquer ; le cycle change, ils redeviennent J<n>', async ({ page }) => {
  /** William, 30/09 : le bouton « Nommer comme la semaine » était oublié ; son
   *  action devient le défaut, et il disparaît. */
  await ouvrirLaBase(page);
  await expect(page.getByRole('button', { name: /Nommer comme la semaine|Name after the week/ })).toHaveCount(0);
  // Le bloc du mock fait CINQ jours : pas de nom de semaine.
  await expect(nomDuJour(page, 'J1')).toHaveAttribute('placeholder', /Nom du jour|Day name/);

  await page.getByRole('button', { name: /Ajouter un jour|Add a day/ }).click();
  await page.getByRole('button', { name: /Ajouter un jour|Add a day/ }).click();
  // Sept jours : le nom est là, sans avoir été saisi — et les accessoires le disent aussi.
  await expect(nomDuJour(page, 'J1')).toHaveAttribute('placeholder', 'Lundi');
  await expect(nomDuJour(page, 'J7')).toHaveAttribute('placeholder', 'Dimanche');
  await expect(nomDuJour(page, 'J1')).toHaveValue('');
  await expect(page.getByText('J5 · Vendredi').first()).toBeVisible();
  // ⚠️ L'IDENTITÉ N'A PAS BOUGÉ : la colonne dit toujours J1 … J7.
  await expect(page.getByRole('cell', { name: /^J7/ }).first()).toBeVisible();

  // Un nom propre au coach prime, et survit au changement de cycle.
  await nomDuJour(page, 'J2').fill('Haut du corps');
  await page.getByRole('button', { name: /Ajouter un jour|Add a day/ }).click();
  await expect(nomDuJour(page, 'J1')).toHaveAttribute('placeholder', /Nom du jour|Day name/);
  await expect(page.getByText('J5 · Vendredi')).toHaveCount(0);
  await expect(nomDuJour(page, 'J2')).toHaveValue('Haut du corps');
});
