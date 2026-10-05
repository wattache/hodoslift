import { expect, test, type Page } from '@playwright/test';

/** UNE SEMAINE D'ÉCHECS N'EST PAS UNE SEMAINE D'ABSENCE (FRE-110).
 *
 *  ⚠️ CE REPÈRE EXISTE À CAUSE D'UNE CORRECTION, ET C'EST TOUT SON PROPOS. Le
 *  serveur ne compte plus que les séries TENUES : une série notée `FAIL` ne
 *  charge plus le tonnage. Mesuré en production — 81 lignes, 36 731 kg comptés
 *  pour 9 093 réellement tenus, dont 51 lignes qui tombent à ZÉRO.
 *
 *  Le gain de justesse crée donc un trou visible, et un trou dans une courbe de
 *  suivi se lit « il n'est pas venu ». Or l'athlète était là, sous une barre trop
 *  lourde — le contraire d'une absence. Sans second repère, on aurait remplacé un
 *  chiffre faux par un graphe trompeur.
 *
 *  ⚠️ CE QUE CES SPECS GARDENT N'EST PAS « le repère s'affiche » mais **il ne
 *  s'affiche QUE là où il dit quelque chose**. Le serveur rend prescrit = tenu
 *  partout où rien n'a échoué : un repère dessiné sur chaque semaine passerait
 *  une spec naïve tout en couvrant le graphe de liserés muets.
 *
 *  Le mock porte UNE semaine en échec sur seize (la 11e, `21 juil.`), ce qui est
 *  exactement ce qu'il faut pour tenir les deux affirmations à la fois.
 */

/** Le graphe de suivi d'un athlète, à l'onglet Tracker. */
async function ouvrirLeSuivi(page: Page) {
  await page.goto('/tracking');
  // ⚠️ EN FRANÇAIS : le harnais tourne dans la langue par défaut, pas celle du
  // navigateur du développeur. Et la légende est mise en majuscules par CSS —
  // le DOM, lui, porte « Tonnage total ».
  await expect(page.getByText(/tonnage total/i).first()).toBeVisible();
}

/** Le liseré du prescrit : le seul trait pointillé de cette forme dans le SVG.
 *  Visé par son tracé plutôt que par un `data-testid`, parce que c'est le TRACÉ
 *  qui est la fonctionnalité — un identifiant survivrait à un repère invisible.
 *
 *  ⚠️ IL SUFFIT À COUVRIR LE CREUX. Le manque est dessiné en deux éléments — ce
 *  trait, et le rectangle en creux dessous — sous UNE SEULE condition
 *  (`manque != null`, `tracking-chart.tsx`). Compter les traits dit donc déjà
 *  sur quelles semaines le repère apparaît, et un localisateur pour le
 *  rectangle éprouverait la même branche une seconde fois.
 *
 *  Un `creux` vivait ici pour ça, jamais utilisé : il faisait échouer `npm run
 *  lint` depuis le 01/09, donc la CI, pour une assertion que personne n'avait
 *  écrite. Retiré le 07/09. Ce qu'il aurait pu éprouver en plus est la
 *  GÉOMÉTRIE — la hauteur du creux vaut l'écart — et FRE-110 l'a laissée hors
 *  périmètre en connaissance de cause. Si on la veut un jour, elle se mesure,
 *  elle ne se compte pas. */
const reperes = (page: Page) => page.locator('svg line[stroke-dasharray="3 2"]');

/** LA BARRE DE VOLUME D'UNE SEMAINE, par son rang.
 *
 *  ⚠️ LES BARRES ET NON LES BANDES DE SURVOL, et c'est une leçon de cette spec.
 *  Le graphe pose une bande de capture invisible par semaine ; les viser
 *  paraissait plus juste — c'est ce qui écoute la souris — mais il y en a
 *  DIX-SEPT pour seize semaines. Une bande de plus, et tout l'index glisse d'un
 *  cran : la spec survolait la semaine 9, sans échec, et échouait en accusant
 *  l'infobulle.
 *
 *  Les barres, elles, sont exactement seize — une par semaine, dans l'ordre. La
 *  spec le VÉRIFIE avant de s'en servir, pour qu'un jour où ce ne serait plus
 *  vrai on lise la vraie raison plutôt qu'une valeur manquante.
 *
 *  Index 10 = la 11e semaine du mock, `21 juil.`, la seule en échec. */
const barres = (page: Page) => page.locator('svg rect[opacity="0.55"]');

/** ⚠️ `mouse.move` ET NON `.hover()`, et ce n'est pas une commodité. Playwright
 *  exige qu'un élément soit « actionnable » avant de le survoler ; un `line` SVG
 *  a une hauteur NULLE, donc il est jugé invisible et l'attente expire. Les
 *  barres, elles, sont recouvertes par les zones de survol du graphe, qui
 *  intercepteraient le clic.
 *
 *  Le graphe n'écoute de toute façon que la position de la souris : la déplacer
 *  est exactement ce que fait un utilisateur, sans le contrat d'actionnabilité
 *  qui n'a pas de sens sur un tracé. */
async function survoler(page: Page, cible: ReturnType<typeof barres>) {
  // ⚠️ FAIRE DÉFILER D'ABORD, sans quoi rien ne se passe et RIEN NE LE DIT.
  // `.hover()` amène l'élément à l'écran tout seul ; `mouse.move` prend des
  // coordonnées de FENÊTRE. Le graphe vit en bas de la page : la souris partait
  // sous le pli, aucune infobulle ne s'ouvrait, et l'échec accusait l'affichage.
  await cible.scrollIntoViewIfNeeded();
  const boite = await cible.boundingBox();
  if (!boite) throw new Error('cible absente du graphe');
  await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
}

/** L'infobulle elle-même, par son rôle : c'est elle qui atteste qu'un survol a
 *  eu lieu. Sans ce garde-fou, une spec qui cherche « 28 juil. » passe sur
 *  l'ÉTIQUETTE D'AXE du même nom — verte sans qu'aucun survol n'ait eu lieu.
 *
 *  ⚠️ ELLE CIBLAIT LE LIBELLÉ « Format du top set », et c'était doublement faux :
 *  ce libellé quitte l'infobulle quand des courbes par combinaison sont allumées
 *  (FRE-182) — il y devient une ligne par courbe — et chercher « → » DANS ce
 *  libellé ne pouvait jamais rien trouver, donc le contre-exemple plus bas
 *  passait quoi qu'affiche l'infobulle. */
const infobulleOuverte = (page: Page) => page.getByRole('tooltip');

test('le repère du prescrit ne marque QUE la semaine où des séries ont échoué', async ({ page }) => {
  await ouvrirLeSuivi(page);

  // Seize semaines dans le mock, une seule en échec.
  await expect(reperes(page)).toHaveCount(1);
});

test('l’infobulle montre « tenu → prescrit » sur cette semaine', async ({ page }) => {
  await ouvrirLeSuivi(page);

  await expect(barres(page)).toHaveCount(16);
  await survoler(page, barres(page).nth(10));
  await expect(infobulleOuverte(page)).toBeVisible();

  // ⚠️ LA MÊME FORME QUE PARTOUT AILLEURS DANS L'APP — `2' → 1'45"` sur le repos,
  // `prescrit → réel` sur les reps. Une seconde notation pour dire « constaté vs
  // attendu » demanderait à être apprise deux fois.
  await expect(infobulleOuverte(page).getByText('210 kg → 340 kg')).toBeVisible();
});

test('une semaine SANS échec n’affiche qu’une seule valeur', async ({ page }) => {
  /** ⚠️ LE CONTRE-EXEMPLE, ET IL PORTE PLUS QUE LE CAS PASSANT. Le serveur rend
   *  `tonnagePrevuTotalKg` sur TOUTES les semaines, égal au tonnage tenu quand
   *  rien n'a échoué. Un affichage qui ne comparerait pas les deux écrirait
   *  « 340 kg → 340 kg » seize fois, et le repère perdrait tout son sens. */
  await ouvrirLeSuivi(page);

  // La semaine suivante (28 juil.) n'a pas d'échec dans le mock : sa barre est
  // pleine, sans creux au-dessus.
  await survoler(page, barres(page).nth(11));

  await expect(infobulleOuverte(page)).toBeVisible();
  // ⚠️ DANS L'INFOBULLE, PAS DANS LA PAGE. La recherche était globale, et le
  // tableau du bloc (FRE-114) a rejoint le Tracker le 11/09 : sa légende écrit
  // « axe RPE partagé 8 → 10 », à un mètre de là. La spec tombait sur une flèche
  // qui n'était pas la sienne — elle ne parlait pas de la bonne zone.
  await expect(infobulleOuverte(page).getByText(/→/)).toHaveCount(0);
});

test('le repère suit la bascule vers les RÉPÉTITIONS', async ({ page }) => {
  /** ⚠️ LE GRAPHE A DEUX UNITÉS, ET LE DÉFAUT LES TOUCHE TOUTES LES DEUX : le
   *  volume en reps vaut `séries × répétitions`, donc il baisse exactement comme
   *  le tonnage. Un repère posé sur le seul tonnage aurait laissé l'autre moitié
   *  du graphe inexpliquée — le défaut même qu'on répare. */
  await ouvrirLeSuivi(page);
  await page.getByRole('button', { name: /reps/i }).click();

  await expect(reperes(page)).toHaveCount(1);
  await expect(barres(page)).toHaveCount(16);
  await survoler(page, barres(page).nth(10));
  await expect(page.getByText('28 → 40')).toBeVisible();
});
