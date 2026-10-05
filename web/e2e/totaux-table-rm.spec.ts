import { expect, test, type Page } from '@playwright/test';

/** LES TOTAUX NOMMÉS DE LA TABLE RM (FRE-147).
 *
 *  Le total de street vaut `MU + DIPS + SQUAT + max(PU, CU)` : quatre places,
 *  dont une que le pull up et le chin up se disputent. L'écran montrait UN total
 *  libre, réglé par des bascules — utile au coach, mais incapable de répondre à
 *  « que vaut son total de street ».
 *
 *  Le SBD s'y est ajouté quand le bench et le deadlift ont rejoint la table.
 *  ⚠️ CE N'EST PAS UNE DISCIPLINE, C'EST UN TOTAL : « on veut pas créer SBD
 *  comme sport ». Rien dans le modèle ne connaît le SBD, seule une carte le
 *  nomme.
 *
 *  ⚠️ ET CE N'EST PAS LE BARÈME DE COMPÉTITION. Ces totaux additionnent des 1RM
 *  d'ENTRAÎNEMENT saisis à la main ; le barème (`total_bareme_kg`, FRE-92)
 *  additionne des charges réellement validées en compétition. Les confondre
 *  ferait apparaître un total que l'athlète n'a jamais réalisé.
 */

const ouvrirLeTableau = async (page: Page) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /Table RM|RM table/ })).toBeVisible();
};

const panneau = (page: Page) => page.locator('aside').filter({ hasText: /avec pull-up|with pull-up/i });

test('les deux totaux de street, et le plus grand fait foi', async ({ page }) => {
  await ouvrirLeTableau(page);

  // Léa : MU 12 + DIPS 60 + SQUAT 120 = 192 de socle.
  await expect(panneau(page)).toContainText('237');    // + pull-up 45
  await expect(panneau(page)).toContainText('239.5');  // + chin-up 47.5

  // ⚠️ LE PLUS GRAND EST DÉSIGNÉ, PAS CALCULÉ À CÔTÉ. Le total officiel de
  // street est `max(PU, CU)` : afficher un troisième chiffre répéterait l'un des
  // deux. On marque celui qui fait foi — ici le chin-up, qui est le plus lourd.
  const officiel = page.locator('div').filter({ hasText: /^Street · avec chin-up/i }).first();
  await expect(officiel).toContainText(/OFFICIEL|OFFICIAL/i);
});

test('le total SBD est le sien, et ne concourt pas avec le street', async ({ page }) => {
  await ouvrirLeTableau(page);

  // Léa : SQUAT 120 + BENCH 55 + DEADLIFT 130.
  const sbd = page.locator('div').filter({ hasText: /^SBD/ }).first();
  await expect(sbd).toContainText('305');

  // ⚠️ AUCUN « OFFICIEL » SUR LE SBD, ET C'EST LA RÈGLE. Le sceau départage le
  // pull up et le chin up, qui répondent à LA MÊME question de deux façons. Le
  // SBD pose une autre question : le désigner vainqueur reviendrait à déclarer
  // qu'une discipline bat l'autre, ce qui ne veut rien dire — et ici il est même
  // le plus gros des trois (305 contre 239,5), donc un `max` naïf l'aurait pris.
  await expect(sbd).not.toContainText(/OFFICIEL|OFFICIAL/i);
});

test('le total libre survit — c’est un autre geste', async ({ page }) => {
  await ouvrirLeTableau(page);

  // ⚠️ LES DEUX RÉPONDENT À DES QUESTIONS DIFFÉRENTES. Les totaux nommés disent
  // ce que vaut l'athlète en street ou en SBD ; le total libre dit ce que le
  // coach a décidé de compter POUR CET ATHLÈTE (FRE-126, sélection persistée).
  // Retirer le second en ajoutant les premiers aurait cassé un geste utilisé.
  // ⚠️ RENOMMÉ « MON TOTAL — À COMPOSER » (refonte des écrans, 09/2026). « Total
  // libre » n'expliquait pas de quoi il était libre : il affichait le même
  // nombre que « Street · avec pull-up » sans cadre ni titre, et se lisait comme
  // une seconde vérité. Ce que cette spec garde n'a pas changé — le geste existe
  // toujours, à côté des totaux nommés, et il compte les sept mouvements.
  await expect(panneau(page)).toContainText(/à composer|to compose/i);
  await expect(panneau(page)).toContainText('469.5');   // les sept mouvements
  // Et les bascules qui le composent vivent DEDANS, désormais : elles étaient en
  // haut du panneau, sans libellé, sans rien qui dise ce qu'elles réglaient.
  await expect(panneau(page).getByRole('button', { name: /total/i }).first()).toBeVisible();
});

test('un 1RM manquant DIT ce qui manque, au lieu d’un total amputé', async ({ page }) => {
  // ⚠️ LE CAS LE PLUS FRÉQUENT EN PRODUCTION, ET C'EST TOUT L'ENJEU : le chin up
  // n'est renseigné que sur 11 athlètes sur 70, et le bench et le deadlift sur
  // AUCUN au jour de la livraison. Afficher `MU + DIPS + SQUAT + 0` donnerait un
  // nombre qui se lit comme un total et n'en est pas un — la même règle que la
  // page publique du coach, où « un 0 n'est pas un record, c'est un chiffre non
  // communiqué ».
  await page.goto('/dashboard');
  // Le sélecteur de l'en-tête porte la liste depuis le 14/09 (constat 07).
  await page.getByRole('button', { name: /Changer d'athlète|Switch athlete/ }).click();
  await page.getByRole('button', { name: /Voir les archivés|Show archived/ }).click();
  await page.getByRole('option', { name: /Paul Suspendu/ }).click();
  await expect(page.getByRole('heading', { name: /Table RM|RM table/ })).toBeVisible();

  // Paul : ni muscle-up, ni chin-up, ni bench, ni deadlift.
  await expect(panneau(page)).toContainText(/1RM manquant|1RM missing/);
  await expect(panneau(page)).not.toContainText(/OFFICIEL|OFFICIAL/i);

  // ⚠️ ET LE SBD DIT CE QUI LUI MANQUE À LUI, pas ce qui manque au street. Un
  // message partagé aurait laissé croire qu'un chin-up complèterait son SBD.
  const sbd = page.locator('div').filter({ hasText: /^SBD/ }).first();
  await expect(sbd).toContainText('BP DL');

  // Et le total libre, lui, reste un vrai chiffre : il n'a jamais prétendu être
  // le total de street.
  await expect(panneau(page)).toContainText('130');
});
