import { expect, test } from '@playwright/test';
import { choisirAthlete } from './aides-athlete';

/** LE JOURNAL DE SUIVI DU KINÉ (FRE-102).
 *
 *  « Le kiné prend des notes au fil de l'eau puis il sait où il en est. » Les
 *  deux moitiés de cette phrase décident de la forme, et ce sont elles qu'on
 *  garde ici : des entrées datées, la plus récente EN PREMIER.
 *
 *  ⚠️ VISÉ SUR THÉO, PAS SUR LÉA, et c'est délibéré. L'utilisateur du dev-mock
 *  EST Léa : sur elle, tout s'ouvrirait par `isSelf` et on ne prouverait rien du
 *  rôle. Théo est celui qu'il SUIT — le seul chemin qui passe par le lien
 *  `athletes.kine_uid`, c'est-à-dire celui de la production.
 */

/** ⚠️ CADRÉ SUR LA SECTION, et il l'a fallu : l'onglet Suivi kiné porte TROIS
 *  listes — l'historique des douleurs, les bilans, et le journal. Viser
 *  `listitem` sur la page entière en ramassait huit, dont aucune du journal en
 *  tête. Un sélecteur trop large ne rend pas un test fragile : il le rend FAUX. */
const journal = (page: import('@playwright/test').Page) =>
  page.locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Notes de suivi' }) })
    .getByRole('listitem');

const allerChezTheo = async (page: import('@playwright/test').Page) => {
  await page.goto('/dashboard');
  await choisirAthlete(page, /Théo Bernard/);
  await page.goto('/kine');
  // ⚠️ PAR LE SOUS-ONGLET, comme le kiné le fera. On pourrait aller droit à
  // `/kine?vue=notes`, mais on éprouverait alors l'URL sans jamais éprouver le
  // chemin qu'emprunte un humain — et c'est celui-là qui casse.
  await page.getByRole('tab', { name: 'Notes de suivi' }).click();
};

test('le journal se lit du plus RÉCENT au plus ancien', async ({ page }) => {
  await allerChezTheo(page);

  const notes = journal(page);
  await expect(notes.first()).toContainText('Reprise du gainage');

  // ⚠️ L'ORDRE EST LA FONCTIONNALITÉ, pas une préférence d'affichage. « Il sait
  // où il en est » veut dire que l'état courant se lit d'abord ; un journal
  // trié à l'endroit obligerait à dérouler tout l'historique pour trouver la
  // dernière observation. D'où l'assertion sur la SÉQUENCE, pas sur la présence.
  await expect(notes.last()).toContainText('Suspicion de tendinopathie');
});

test('une note corrigée le DIT, une note fraîche non', async ({ page }) => {
  /** ⚠️ LE PIÈGE QUE CE TEST GARDE : `cree_le` et `modifie_le` naissent de deux
   *  appels d'horloge distincts et diffèrent toujours de quelques microsecondes.
   *  Comparer les deux à l'identique ferait donc dire « modifiée » à TOUTES les
   *  notes, y compris celles que personne n'a touchées. La comparaison porte sur
   *  la seconde. */
  await allerChezTheo(page);

  const notes = journal(page);
  await expect(notes.last()).toContainText('modifiée le');
  await expect(notes.first()).not.toContainText('modifiée le');
});

test('« Ajouter » reste fermé tant que rien n’est écrit', async ({ page }) => {
  // Une note vide est un clic de trop, pas une information — et le serveur la
  // refuserait en 422. L'écran dit non plus tôt, avec un bouton éteint plutôt
  // qu'une erreur après coup.
  await allerChezTheo(page);

  const ajouter = page.getByRole('button', { name: 'Ajouter', exact: true });
  await expect(ajouter).toBeDisabled();

  await page.getByRole('textbox', { name: 'Nouvelle note de suivi' }).fill('   ');
  await expect(ajouter).toBeDisabled();

  await page.getByRole('textbox', { name: 'Nouvelle note de suivi' }).fill('Douleur en baisse');
  await expect(ajouter).toBeEnabled();
});

test('l’athlète ne voit PAS le journal sur son propre suivi', async ({ page }) => {
  /** ⚠️ L'ASSERTION QUI PORTE LA DÉCISION, et la seule qu'on puisse prendre pour
   *  acquise à tort. Les BILANS sont ouverts à l'athlète (`owner_or_kine`) parce
   *  qu'il les remplit ; il serait naturel d'aligner les notes dessus. Non : une
   *  note de suivi est l'observation du praticien — « suspicion de tendinopathie,
   *  à surveiller » est une hypothèse, pas un constat. La lui montrer
   *  l'inquiéterait sans contexte et censurerait ce que le kiné y écrit.
   *
   *  Léa est l'athlète que l'utilisateur du dev-mock EST : `canMedical` y est
   *  vrai (par `isSelf`) et les bilans s'affichent. Les notes, elles, sont
   *  gardées par `suivisIds` — c'est tout l'écart entre les deux. */
  await page.goto('/dashboard');
  await choisirAthlete(page, /Léa Martin/);
  await page.goto('/kine');

  // ⚠️ L'ONGLET LUI-MÊME N'EXISTE PAS, et c'est mieux qu'un contenu masqué : une
  // pastille grisée dirait « il y a quelque chose ici, mais pas pour toi », ce
  // qui est précisément l'information qu'on ne veut pas donner à l'athlète sur
  // les notes du praticien.
  await expect(page.getByRole('tab', { name: 'Bilans' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Notes de suivi' })).toHaveCount(0);
});


test('le sous-onglet actif vit dans l’URL', async ({ page }) => {
  /** ⚠️ SANS ÇA, OUVRIR UN BILAN PUIS REVENIR RAMÈNERAIT AU PREMIER ONGLET. On
   *  aurait quitté « Bilans » pour réapparaître sur « Douleurs », et il
   *  faudrait le retrouver à chaque aller-retour. Un rechargement ou un favori
   *  retombent au bon endroit pour la même raison. */
  await page.goto('/dashboard');
  await choisirAthlete(page, /Théo Bernard/);
  await page.goto('/kine');

  await page.getByRole('tab', { name: 'Notes de suivi' }).click();
  await expect(page).toHaveURL(/vue=notes/);

  // Et l'URL suffit à y revenir directement.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Notes de suivi' })).toBeVisible();
});

test('une vue INTERDITE dans l’URL retombe sur ce qu’on a le droit de voir', async ({ page }) => {
  /** Une URL `?vue=notes` partagée à un athlète ne doit lui rendre ni un écran
   *  vide, ni une erreur — juste le premier onglet auquel il a droit. */
  await page.goto('/dashboard');
  await choisirAthlete(page, /Léa Martin/);
  await page.goto('/kine?vue=notes');

  await expect(page.getByRole('heading', { name: 'Notes de suivi' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /^(Douleurs|Pain)$/ }))
    .toHaveAttribute('aria-selected', 'true');
});
