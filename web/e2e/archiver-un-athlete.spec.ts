import { expect, test, type Page } from '@playwright/test';

/** ARCHIVER UN ATHLÈTE QUI SUSPEND LE COACHING (FRE-127).
 *
 *  ⚠️ CE QUE CES SPECS GARDENT, ET CE N'EST PAS « le bouton existe ». Trois
 *  décisions qui ne se devinent pas :
 *
 *    1. l'archivé DISPARAÎT de la liste, mais il en REVIENT — c'est ce qui
 *       sépare archiver de supprimer, et c'est toute la demande du coach ;
 *    2. le bouton « voir les archivés » ne s'affiche QUE s'il y en a. Un
 *       « (0) » permanent coûterait sa place à tout le monde pour dire non ;
 *    3. le geste est réservé au COACH de l'athlète — le kiné en est exclu,
 *       parce que brokkr le lui refuse (mode `coach`).
 *
 *  Le mock porte un athlète archivé, Paul Suspendu, chez le même coach que les
 *  autres : sans lui, la liste masquée ne serait jamais observable.
 */

/** ⚠️ LA LISTE EST DANS LE SÉLECTEUR DE L'EN-TÊTE DEPUIS LE 14/09 (Passe 3,
 *  constat 07) — plus dans la barre latérale. Les promesses ci-dessous n'ont pas
 *  bougé ; seul le chemin pour les éprouver a changé. */
const ouvrir = (page: Page) =>
  page.getByRole('button', { name: /Changer d'athlète|Switch athlete/ }).click();
const option = (page: Page, nom: string) => page.getByRole('option', { name: new RegExp(nom) });

test('un athlète archivé est MASQUÉ de la liste', async ({ page }) => {
  await page.goto('/dashboard');
  await ouvrir(page);

  await expect(option(page, 'Léa Martin')).toBeVisible();
  await expect(option(page, 'Paul Suspendu')).toHaveCount(0);
});

test('« voir les archivés » les RAMÈNE, avec leur nombre', async ({ page }) => {
  /** ⚠️ LE CŒUR DU TICKET : « pour reprendre plus tard ». Un archivé qu'on ne
   *  pourrait plus retrouver serait un supprimé avec une autre étiquette. */
  await page.goto('/dashboard');
  await ouvrir(page);

  const bascule = page.getByRole('button', { name: /Voir les archivés \(1\)/ });
  await expect(bascule).toBeVisible();

  await bascule.click();
  await expect(option(page, 'Paul Suspendu')).toBeVisible();
  await expect(page.getByRole('button', { name: /Masquer les archivés/ })).toBeVisible();
});

test('« masquer » les fait VRAIMENT disparaître, même celui qu’on regarde', async ({ page }) => {
  /** ⚠️ LE DÉFAUT QUE CETTE SPEC GARDE, ET IL VENAIT D'UNE EXCEPTION DE TROP.
   *  La liste gardait l'athlète SÉLECTIONNÉ visible même archivé — posé pour
   *  qu'archiver celui qu'on regarde ne le fasse pas disparaître sous le
   *  curseur. Mais l'exception valait en permanence : dès qu'on ouvrait un
   *  archivé, « Masquer les archivés » n'avait plus aucun effet.
   *
   *  Signalé par William, pas par le harnais : les deux specs d'à côté
   *  n'ouvraient jamais l'archivé, donc l'exception ne se déclenchait pas. Un
   *  cas passant qui ne traverse pas l'état où le défaut vit ne prouve rien. */
  await page.goto('/dashboard');
  await ouvrir(page);
  await page.getByRole('button', { name: /Voir les archivés \(1\)/ }).click();

  // On l'OUVRE — c'est l'état où le défaut vivait.
  await option(page, 'Paul Suspendu').click();
  await expect(page.getByRole('button', { name: /Changer d'athlète.*Paul Suspendu/ })).toBeVisible();

  await ouvrir(page);
  await page.getByRole('button', { name: /Masquer les archivés/ }).click();
  await expect(option(page, 'Paul Suspendu')).toHaveCount(0);
});

test('les archivés sont SIGNALÉS, et le compte principal ne les inclut pas', async ({ page }) => {
  /** ⚠️ REMARQUE DE WILLIAM, ET ELLE PORTE SUR L'ÉCHELLE. Mêlés aux actifs sans
   *  marque, les archivés se perdent : à vingt athlètes, on ne sait plus qui est
   *  encore suivi. Ils viennent APRÈS les actifs, marqués « archivé ».
   *
   *  ⚠️ ET LE COMPTE NE LES INCLUT PAS : « Mes athlètes · 2 » doit rester le
   *  nombre de gens que le coach suit VRAIMENT. */
  await page.goto('/dashboard');
  await ouvrir(page);
  await expect(page.getByText(/Mes athlètes · 2/)).toBeVisible();

  await page.getByRole('button', { name: /Voir les archivés \(1\)/ }).click();

  await expect(option(page, 'Paul Suspendu')).toContainText('archivé');
  await expect(page.getByRole('option').last()).toHaveAccessibleName(/Paul Suspendu/);
  // Le compte des actifs ne bouge pas quand on révèle les archivés.
  await expect(page.getByText(/Mes athlètes · 2/)).toBeVisible();
});

test('le geste est sur le TABLEAU DE BORD, à un choix de la liste', async ({ page }) => {
  /** ⚠️ LA SPEC QUI GARDE L'EMPLACEMENT, ET ELLE EXISTE À CAUSE D'UNE ERREUR.
   *  Le bouton était d'abord posé sur la fiche `/athletes/{id}` — une page que
   *  PLUS AUCUN LIEN n'atteint depuis la suppression de l'annuaire le 31/08. Il
   *  fallait taper l'URL pour le voir, autant dire qu'il n'existait pas.
   *
   *  D'où une spec qui part du chemin RÉEL — le sélecteur, puis le tableau de
   *  bord — et pas d'une adresse écrite à la main. */
  await page.goto('/guichet');
  await ouvrir(page);
  await option(page, 'Léa Martin').click();
  await expect(page).toHaveURL(/\/dashboard/);

  // ⚠️ « Archiver » ET NON « Supprimer » : le libellé porte la promesse de
  // réversibilité, et c'est pour ça qu'aucune confirmation ne le précède.
  await expect(page.getByRole('button', { name: 'Archiver', exact: true })).toBeVisible();
});

/** ⚠️ CE QUE CE HARNAIS NE PEUT PAS ÉPROUVER, ET IL FAUT LE DIRE.
 *
 *  Le geste est réservé au COACH de l'athlète (`estSonCoach`), ce qui exclut le
 *  kiné — brokkr le lui refuse (mode `coach`). Aucune spec ne le garde ici, et
 *  ce n'est pas un oubli : le mock n'a pas d'athlète SUIVI sans être COACHÉ par
 *  le même utilisateur. `isManagedByMe` et `estSonCoach` y coïncident donc
 *  toujours, et la mutation qui ouvre le geste au kiné passe au vert.
 *
 *  Vérifié en essayant : ajouter Nina (chez `other-coach`) aux suivis ne suffit
 *  pas — la fiche athlète cherche dans `/athletes/mine`, où elle n'est pas, et
 *  répond « Athlète introuvable » avant même la question du bouton. C'est un
 *  défaut à part, ANTÉRIEUR : un kiné ne peut pas ouvrir la fiche d'un athlète
 *  qu'il suit.
 *
 *  C'est la même famille que le rôle combiné déjà signalé : l'utilisateur du
 *  harnais est coach ET kiné des mêmes athlètes, donc toute règle branchée sur
 *  la distinction y passe sans être éprouvée. */
