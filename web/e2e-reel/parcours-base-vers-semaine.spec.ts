import { expect, test, type Page } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** LE PARCOURS ENTIER : composer une BASE → générer → ajouter une semaine.
 *
 *  ⚠️ POURQUOI CETTE SPEC EXISTE ALORS QUE CHAQUE ÉTAPE EST DÉJÀ COUVERTE. Elles
 *  le sont SÉPARÉMENT, et chacune pose son décor par l'API avant de vérifier le
 *  serveur. Deux choses passaient donc entre les mailles, et le déplacement des
 *  deux générations côté brokkr (26/08) les a rendues critiques :
 *
 *   1. PERSONNE NE COMPOSE UNE BASE À L'ÉCRAN. `poserUneBase` écrit par l'API :
 *      le chemin d'écriture de l'éditeur (`PUT /base`) n'était jamais éprouvé
 *      depuis un vrai clavier.
 *   2. PERSONNE NE REGARDE UNE SEMAINE GÉNÉRÉE. On vérifiait que la base de
 *      données la contient. Or elle ne vient plus du navigateur : c'est une
 *      réponse HTTP d'une route neuve. Si l'écran tombait sur cette forme,
 *      TOUS les autres tests resteraient verts et la page serait blanche.
 *
 *  ⚠️ CE QUI SE VÉRIFIE ICI SE VÉRIFIE À L'ÉCRAN, délibérément — c'est le seul
 *  endroit du harnais où c'est le cas pour ce domaine. `GET /training` dit ce
 *  qui est écrit ; il ne dit pas si le coach le voit.
 *
 *  ⚠️ CE QU'ELLE NE PEUT PAS ATTRAPER, ET IL FAUT LE SAVOIR. Éprouvée par
 *  mutation : faire IGNORER au front la réponse des deux routes la laisse
 *  VERTE. Ce n'est pas une faiblesse de la spec, c'est l'application qui
 *  rattrape — les deux gestes appellent `invalidate()`, donc l'arbre se
 *  recharge et l'écran finit juste. Ce que la spec attrape, c'est un défaut de
 *  RENDU : masquer l'aperçu ou les séances de la semaine la fait rougir aux
 *  deux endroits. C'est précisément le risque du 26/08 — une semaine qui ne
 *  vient plus du navigateur mais d'une route neuve.
 */
test.afterEach(nettoyer);

const apercu = (page: Page) => page.locator('article[aria-label^="Aperçu"]');

/** La case de la grille jours × mouvements : celle qui propose un tier.
 *  Désignée par ce qu'elle CONTIENT — l'écran porte d'autres listes déroulantes
 *  (nature, unité d'incrément), et `.first()` tomberait sur l'une d'elles. */
/** La case J1 × premier mouvement — un bouton qui fait tourner le tier (20/09). */
const caseDeLaGrille = (page: Page) =>
  page.getByRole('button', { name: /^J1, [A-ZÉÈ ]+\s*:/ }).first();

/** ⚠️ LE PREMIER MOUVEMENT, ET IL EST NOMMÉ. La section « Principes » et les
 *  colonnes de la grille sont engendrées par la MÊME liste ordonnée : leurs
 *  premiers éléments désignent donc le même mouvement, et les deux `.first()`
 *  ci-dessous parlent bien du même. Le nommer plutôt que de s'en remettre à la
 *  position fait rougir la spec si cet ordre change, au lieu de la laisser
 *  éprouver un autre mouvement en silence. */
const MOUVEMENT = 'MUSCLE UP';

test('composer, générer, voir, prolonger — de bout en bout à l’écran', async ({ page }) => {
  // Le décor MINIMAL : un bloc nu, et une BASE qui ne dit qu'une chose — quel
  // mouvement la section « Principes » doit offrir. Tout le reste se fait au
  // clavier, puisque c'est justement ce qui n'était éprouvé nulle part.
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  // ⚠️ `selectedPrincipaux: null` — « jamais configuré », l'état de 48 BASE sur
  // 111, et celui où l'éditeur retombe sur l'ordre canonique de la bibliothèque.
  // `[]` dirait autre chose : le coach a retiré les mouvements un par un, et
  // l'écran n'offrirait alors AUCUNE section où ajouter un principe.
  await poserUneBase(bloc.id, {
    daySplit: [], selectedPrincipaux: null, principles: [], accessories: [],
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  /* ---- 1. COMPOSER, au clavier ---------------------------------------- */

  // La grille et les sections offrent tous les mouvements de la bibliothèque ;
  // on travaille sur le PREMIER des deux côtés.
  //
  // ⚠️ ET SI CET ORDRE CHANGEAIT, l'aperçu de l'étape 2 rougirait : il attend
  // `MOUVEMENT` nommément. Pas besoin d'une assertion de plus ici — j'en avais
  // écrit une sur l'en-tête de colonne, elle tombait sur l'`<option>` caché du
  // sélecteur et vérifiait donc autre chose que ce qu'elle annonçait.
  await page.getByRole('button', { name: 'Principe' }).first().click();
  await page.getByLabel('Séries').first().fill('5');
  await page.getByLabel('Reps').first().fill('3');
  await page.getByLabel('Charge').first().fill('100');
  // L'incrément : c'est lui qu'on relira dans la semaine suivante, à l'écran.
  await page.getByLabel('Incr.').first().fill('2.5');

  // Aucun jour ne porte encore de tier : pas de séance, donc pas d'aperçu.
  await expect(apercu(page)).toHaveCount(0);

  await caseDeLaGrille(page).click();

  /* ---- 2. L'APERÇU, sur un brouillon non enregistré -------------------- */

  await expect(apercu(page)).toContainText(MOUVEMENT, { timeout: 10_000 });

  /* ---- 3. GÉNÉRER ------------------------------------------------------ */

  // ⚠️ LE BOUTON EST FERMÉ TANT QUE LA TRAME N'A PAS SA DATE (FRE-138), et ce
  // parcours est le seul endroit du harnais qui l'éprouve AU CLAVIER. La date de
  // S1 est la seule origine des dates de semaine : sans elle, la semaine générée
  // n'entre dans aucune courbe de suivi. Le serveur refuse en 409
  // `base_sans_dates` ; l'écran, lui, ne propose pas le geste.
  const generer = page.getByRole('button', { name: 'Générer la semaine 1' });
  await expect(generer, 'le bouton s’ouvre alors que la trame n’a pas de date')
    .toBeDisabled();

  // ⚠️ ET LA RAISON EST ÉCRITE À L'ÉCRAN, pas cachée dans un `title`. Signalé par
  // William le 09/09 : « le bouton de génération est grisé, et rien ne dit
  // explicitement pourquoi ». Un bouton fermé sans motif visible est la version
  // silencieuse de la consigne impossible que FRE-93 a déjà corrigée ailleurs —
  // et une infobulle ne se lit ni au doigt, ni en un coup d'œil.
  //
  // Le motif vise le message DES DATES, pas n'importe lequel des trois : les
  // deux autres raisons (semaine déjà remplie, rien à générer) passeraient
  // sinon pour celle qu'on éprouve.
  await expect(page.getByRole('status')
                   .filter({ hasText: /en haut de cette trame|top of this template/ }))
    .toBeVisible();

  // ⚠️ LA DATE SE POSE AU CALENDRIER, PAS AU CLAVIER : `DatePicker` est un
  // popover, pas un `<input type=date>`. C'est le seul endroit du harnais qui
  // traverse ce composant — et c'est le geste réel du coach.
  //
  // ⚠️ LE JOUR SE DÉSIGNE PAR SON NOM COMPLET, et il est toujours FRANÇAIS :
  // `DatePickerPanel` fixe `locale={fr}` quelle que soit la langue de l'écran.
  // Le `gridcell` qui l'entoure, lui, n'a pas de nom accessible — c'est le
  // bouton qu'il contient qui le porte.
  //
  // ⚠️ LES DATES SE DÉRIVENT DU JOUR COURANT (FRE-177). Elles étaient écrites en
  // dur — « 7 » et « 13 septembre 2026 » — et le calendrier s'ouvre sur le mois
  // d'AUJOURD'HUI : le 1er octobre, aucun de ces boutons n'aurait été à l'écran,
  // et `make livrer` serait tombé sans qu'aucun code n'ait changé. On n'a pas
  // figé l'horloge : le navigateur parle à un vrai brokkr, dont l'horloge ne se
  // fige pas.
  const nomDuJour = (d: Date) =>
    new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      .format(d);
  const jour = (d: Date) =>
    // ⚠️ ANCRÉ AUX DEUX BOUTS : sans les `^$`, « 7 » attraperait aussi « 17 » et
    // « 27 » — trois éléments, et Playwright refuse.
    //
    // ⚠️ ET LE JOUR COURANT PORTE UN PRÉFIXE : « Aujourd'hui, dimanche 13
    // septembre 2026 ». Le 13/09, la spec a attendu 30 s un bouton qui était
    // là — sous un autre nom. Le préfixe est facultatif, pas ignoré.
    page.getByRole('button', { name: new RegExp(`^(Aujourd'hui, )?${nomDuJour(d)}$`) });

  /** ⚠️ ATTENDRE QUE LE CALENDRIER SOIT PARTI AVANT D'EN OUVRIR UN AUTRE. Le
   *  popover se ferme avec une animation de sortie : pendant ~150 ms, l'ancien
   *  et le nouveau coexistent, et la même date existe DEUX fois à l'écran. Sans
   *  cette attente la spec échoue une fois sur deux, sur un « strict mode
   *  violation » qui n'a rien à voir avec ce qu'elle éprouve. */
  const calendrierFerme = () => expect(page.getByRole('dialog')).toHaveCount(0);

  /** Ouvre le calendrier, avance jusqu'au mois de `d` — le calendrier vide s'ouvre
   *  sur le mois courant —, choisit le jour. Une fin de semaine qui tombe le mois
   *  suivant passe par la flèche, comme le ferait le coach. */
  const aujourdHui = new Date();
  const choisir = async (champ: RegExp, d: Date) => {
    await page.getByRole('button', { name: champ }).click();
    const mois = (d.getFullYear() - aujourdHui.getFullYear()) * 12 + d.getMonth() - aujourdHui.getMonth();
    for (let k = 0; k < mois; k++) await page.getByRole('button', { name: 'Aller au mois suivant' }).click();
    await jour(d).click();
    await calendrierFerme();
  };
  const debut = new Date(aujourdHui.getFullYear(), aujourdHui.getMonth(), aujourdHui.getDate(), 12);
  const fin = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + 6, 12);

  await choisir(/Début S1|W1 start/, debut);

  // ⚠️ ET LA FIN AUSSI : le début seul ne suffit pas (décision du 09/09). C'est
  // la seule assertion du harnais qui distingue les deux moitiés de la règle —
  // sans elle, exiger le début seul passerait au vert.
  await expect(generer, 'le début seul ouvre le bouton').toBeDisabled();
  await choisir(/^Fin$|^End$/, fin);

  await expect(generer).toBeEnabled();
  await generer.click();

  // ⚠️ ON LIT L'ÉCRAN, PAS LA BASE. `generation.spec.ts` tient déjà la vérité du
  // serveur ; ce qui manquait est que la semaine rendue par la route s'AFFICHE.
  await expect(page.getByText(MOUVEMENT).first()).toBeVisible({ timeout: 10_000 });

  // Et ce que le serveur a écrit correspond bien à ce qui a été tapé — sans
  // quoi l'écran pourrait montrer un brouillon local convaincant.
  await expect.poll(async () => {
    const l = (await arbre()).macros[0].blocks[0].weeks[0]?.sessions?.[0]?.exercises ?? [];
    return l.map(e => [e.name, e.sets, e.reps, e.weight]);
  }, { timeout: 10_000 }).toEqual([[MOUVEMENT, '5', '3', '100']]);

  /* ---- 4. PROLONGER, et lire l'incrément À L'ÉCRAN --------------------- */

  // ⚠️ CE PARCOURS NE PASSE PAS EN MODE ATHLÈTE, et ce n'est pas un oubli. La
  // raison a CHANGÉ avec FRE-138 et il faut le dire : elle était « cette BASE n'a
  // pas de dates S1, donc la bascule ne montrerait pas la semaine générée » —
  // vrai jusqu'au 08/09, et faux depuis, puisque la trame est datée ici. Ce qui
  // reste vrai, c'est que la bascule choisit la semaine COURANTE par date, donc
  // ce que l'athlète verrait dépendrait du jour où la spec tourne. Le composant
  // de l'athlète, `WeekOverview`, est de toute façon couvert : c'est LUI qui rend
  // l'aperçu vérifié à l'étape 2, avec des données venues du serveur.
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();

  await expect.poll(async () => (await arbre()).macros[0].blocks[0].weeks.length,
                    { timeout: 10_000 }).toBe(2);

  // ⚠️ L'ASSERTION LA PLUS PARLANTE DU PARCOURS : 100 + 2,5 calculés par brokkr,
  // écrits en base, relus par le front, et affichés. Toute la chaîne du jour en
  // une valeur.
  await expect.poll(async () => {
    const l = (await arbre()).macros[0].blocks[0].weeks[1]?.sessions?.[0]?.exercises ?? [];
    return l.map(e => [e.name, e.weight]);
  }, { timeout: 10_000 }).toEqual([[MOUVEMENT, '102.5']]);

  // ⚠️ ET À L'ÉCRAN. La charge est dans un champ de saisie : c'est sa VALEUR
  // qu'il faut lire, pas le texte de la page — `getByText` ne verrait rien.
  await expect(page.locator('input[value="102.5"]').first())
    .toBeVisible({ timeout: 10_000 });
});
