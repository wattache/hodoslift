import { expect, test, type Page } from '@playwright/test';

/** UN OBJECTIF DE BLOC SE COCHE (FRE-124).
 *
 *  ⚠️ UNE COCHE, PAS UNE MESURE — et c'est ce qui borne la fonctionnalité.
 *  Décision de William : « c'est une satisfaction, c'est pédagogique. Pas pour
 *  du tracking : le tableau des PR le fait. » D'où l'absence d'un « réalisé »
 *  en face du prescrit, qui aurait été la forme d'un suivi.
 *
 *  Le serveur stocke une DATE (`atteint_le`) pour parler la même langue que les
 *  objectifs d'athlète, mais l'écran ne demande pas QUAND : il demande SI.
 */

/** ⚠️ « ACCUMULATION » PORTE LES OBJECTIFS DE LA MAQUETTE. On travaille sur un
 *  objectif EXISTANT plutôt que sur un objectif fraîchement ajouté : le bloc par
 *  défaut n'en a aucun, et un objectif vide ne dit rien de l'état « atteint ». */
async function ouvrirLesObjectifsDuBloc(page: Page) {
  await page.goto('/training');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
  await deplier(page);
}

/** ⚠️ REPLIÉS PAR DÉFAUT DEPUIS LE 13/09 (William) : on déplie avant de lire. */
const deplier = (page: Page) =>
  page.getByRole('button', { name: /^Objectifs du bloc$/ }).click();

/** La carte du seul objectif ENCORE OUVERT de la maquette. */
const carteOuverte = (page: Page) =>
  page.getByRole('listitem').filter({ hasText: 'MUSCLE UP' }).first();

test('le geste « atteint » est sur la carte, sans passer par l’édition', async ({ page }) => {
  /** ⚠️ IL ÉTAIT AU BOUT DE NEUF CELLULES, EN 16 px (refonte des écrans, 09/2026). C'est le geste le
   *  plus chargé de sens de l'écran — « c'est une satisfaction, c'est
   *  pédagogique » — et c'en était le plus petit élément. Il vit maintenant sur
   *  la carte elle-même, en APERÇU : marquer un objectif atteint ne demande pas
   *  d'entrer en mode saisie. */
  await ouvrirLesObjectifsDuBloc(page);

  await expect(carteOuverte(page).getByRole('button', { name: /atteint/i })).toBeVisible();
});

test('cocher puis décocher un objectif fonctionne dans les deux sens', async ({ page }) => {
  /** ⚠️ LES DEUX SENS, ET PAS SEULEMENT LE PREMIER. Décocher envoie une chaîne
   *  VIDE là où la base attend une date — le geste sortait en 500 avant d'être
   *  converti en NULL au serveur. Une spec qui ne cocherait que dans un sens
   *  laisserait passer exactement ce défaut. */
  await ouvrirLesObjectifsDuBloc(page);

  // ⚠️ UN BOUTON `aria-pressed`, PLUS UNE `checkbox`. Une case de 16 px au bout
  // d'un tableau est devenue une cible de 38 px sur la carte ; l'état se lit donc
  // en « pressé », pas en « coché ».
  //
  // ⚠️ ET ON NE LE DÉSIGNE PAS PAR SON NOM : le `title` bascule de « Marquer
  // comme atteint » à « Rouvrir cet objectif », donc un localisateur par nom perd
  // le bouton juste après l'avoir cliqué — c'est-à-dire exactement au moment où
  // la spec doit encore le voir pour vérifier le retour.
  const coche = carteOuverte(page).locator('button[aria-pressed]');
  await expect(coche).toHaveAttribute('aria-pressed', 'false');

  await coche.click();
  await expect(coche).toHaveAttribute('aria-pressed', 'true');

  await coche.click();
  await expect(coche).toHaveAttribute('aria-pressed', 'false');
});

test('un objectif atteint le DIT — sans jamais s’effacer', async ({ page }) => {
  /** ⚠️ LA COCHE SEULE NE SE VOIT PAS, et c'est William qui l'a relevé : une case
   *  cochée au bout d'une ligne de sept cellules se perd. C'est la CARTE qui doit
   *  dire qu'elle est réglée — même signe que le journal des objectifs techniques
   *  et que la liste des objectifs d'athlète (« Atteint le 12 août »).
   *
   *  ⚠️ ET LA PREMIÈRE VERSION DE CETTE SPEC EXIGEAIT `opacity-55` — elle GARDAIT
   *  le défaut. Estomper un objectif atteint efface ce qu'on récompense, sous le
   *  seuil de contraste ; c'est l'inverse de ce que l'état veut dire. La règle du
   *  produit est désormais explicite : un état se marque en POSITIF, jamais en
   *  retirant de la lumière. La spec garde maintenant l'absence d'opacité. */
  await ouvrirLesObjectifsDuBloc(page);
  const carte = carteOuverte(page);
  const coche = carte.getByRole('button', { name: /atteint/i });

  await expect(carte).not.toContainText(/atteint le/i);

  await coche.click();
  // ⚠️ LA DATE ATTENDUE SE CALCULE, elle ne s'écrit pas en dur. Le harnais tourne
  // en FRANÇAIS : `formatShort` rend « 2 sept. », pas « Sep 2 ». Un motif écrit
  // d'après le navigateur du développeur — anglais — passait à côté.
  const aujourdHui = new Intl.DateTimeFormat('fr', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(new Date());
  await expect(carte).toContainText(aujourdHui);
  await expect(carte).not.toHaveClass(/opacity-/);
});

test('en vue ATHLÈTE, la pastille d’un objectif atteint le dit aussi', async ({ page }) => {
  /** ⚠️ LA MOITIÉ QUI COMPTE, ET ELLE MANQUAIT. Le coach voyait la case cochée
   *  dans son tableau d'édition ; l'athlète, lui, ne lit que des pastilles — et
   *  elles ne disaient rien. C'est pourtant lui le destinataire de la
   *  satisfaction que cette coche existe pour donner.
   *
   *  Le mock porte les DEUX cas dans le même bloc : MUSCLE UP ouvert, SQUAT
   *  atteint. Sans le second, rien ici ne serait observable. */
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
  await deplier(page);

  const atteint = page.getByRole('listitem').filter({ hasText: 'SQUAT' });
  const ouvert = page.getByRole('listitem').filter({ hasText: 'MUSCLE UP' });

  await expect(atteint).toContainText(/atteint le/i);
  // Le contre-exemple : l'objectif encore ouvert ne porte AUCUNE date.
  await expect(ouvert).not.toContainText(/atteint le/i);
});

test('la carte se replie, et son en-tête ne VOLE pas le nom du bloc', async ({ page }) => {
  /** ⚠️ CETTE SPEC GARDE LA CAUSE DE HUIT ÉCHECS, pas un affichage. En rendant
   *  l'en-tête repliable, son `<button>` a pris pour nom accessible tout son
   *  contenu — « Objectifs du bloc · Intensification 1/2 atteints ». Dès lors,
   *  chaque `getByRole('button', { name: 'Intensification' })` du harnais
   *  résolvait DEUX éléments, et huit specs sans aucun rapport (bi-set, charge
   *  verrouillée, suppressions, base sans mouvement) sont tombées en accusant
   *  des composants qui n'avaient pas bougé.
   *
   *  Le correctif est un `aria-label` explicite : un bouton de commande dit ce
   *  qu'il COMMANDE, il ne récite pas la zone qu'il ouvre. Le retirer ferait
   *  retomber les huit — sans que rien ne dise pourquoi. Ici, l'échec le dit.
   *
   *  MUTATION QUI ROUGIT : supprimer l'`aria-label` du bouton de repli. */
  await ouvrirLesObjectifsDuBloc(page);

  // L'onglet du bloc reste SEUL à porter ce nom.
  await expect(page.getByRole('button', { name: 'Accumulation' })).toHaveCount(1);

  // Et le repli fonctionne : la carte disparaît, l'en-tête reste.
  const replier = page.getByRole('button', { name: /^Objectifs du bloc$/ });
  await expect(carteOuverte(page)).toBeVisible();
  await replier.click();
  await expect(carteOuverte(page)).toHaveCount(0);
  // ⚠️ LE COMPTE SURVIT AU REPLI, et c'est ce qui rend le repli acceptable :
  // replié, l'en-tête dit encore où l'on en est.
  await expect(page.getByText(/\d+\/\d+ atteints/)).toBeVisible();

  await replier.click();
  await expect(carteOuverte(page)).toBeVisible();
});

test('les objectifs du bloc s’ouvrent REPLIÉS, et la ligne dit encore où l’on en est', async ({ page }) => {
  /** William, 13/09 : « par défaut tout collapsed » — le journal technique
   *  l'était déjà, les objectifs du bloc le sont aussi. Sous l'en-tête fusionné,
   *  deux listes ouvertes repoussaient la séance hors de l'écran.
   *
   *  LES DEUX RÔLES : l'athlète lit `BlockObjectivesList`, le coach
   *  `BlockObjectivesEditor` — deux états par défaut distincts dans le code.
   *  MUTATION QUI ROUGIT : remettre `useState(true)` dans l'un ou l'autre. */
  await page.goto('/training');
  await page.getByRole('button', { name: 'Accumulation', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Objectifs du bloc$/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(carteOuverte(page)).toHaveCount(0);
  await expect(page.getByText(/\d+\/\d+ atteints/)).toBeVisible();

  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Objectifs du bloc$/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(carteOuverte(page)).toHaveCount(0);
});
