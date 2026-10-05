import { expect, test, type Page } from '@playwright/test';

/** LES DOULEURS SUIVIES — FRE-195, sur le dev-mock.
 *
 *  Ce que le mock peut prouver : la figure, les gestes, et ce que l'écran
 *  affiche. Ce qu'il ne peut PAS (les écritures ne persistent pas) : qu'une
 *  douleur déclarée arrive jusqu'à Postgres. C'est le harnais réel qui le dit.
 *
 *  Le jeu de démonstration porte les trois états que la lecture distingue : une
 *  douleur RÉCURRENTE (« Mon épaule », 4 logs), une PONCTUELLE (« Genou
 *  gauche », 1 log) et une CLOSE qui garde son historique. */

async function ouvrir(page: Page) {
  await page.goto('/kine?vue=douleurs');
  await expect(page.getByRole('heading', { name: 'Mon épaule' })).toBeVisible();
}

/** Un muscle de la figure, par son nom exact.
 *
 *  ⚠️ `.first()` PARCE QUE LES DEUX PLANCHES SONT RENDUES. Face et dos vivent
 *  dans le même écran (côte à côte au-dessus de `lg`, l'une masquée en dessous),
 *  et un muscle visible des deux côtés — l'épaule, le brachio-radial — porte
 *  donc DEUX boutons du même nom. Exiger `toHaveCount(1)` faisait rougir une
 *  spec sur une figure parfaitement correcte. */
/** La carte d'une douleur.
 *
 *  ⚠️ `.last()` PARCE QUE LES SECTIONS SONT IMBRIQUÉES : l'écran entier est une
 *  `<section>` qui contient le nom, et la carte en est une aussi. Playwright
 *  rend le parent AVANT l'enfant, donc la dernière est bien la carte. */
const carteDe = (page: Page, nom: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: nom, exact: true }) }).last();

const zone = (page: Page, nom: string) =>
  page.locator('svg[role="group"]').getByRole('button', { name: nom, exact: true }).first();

test('les douleurs vivantes s’affichent, les closes sont repliées', async ({ page }) => {
  await ouvrir(page);
  await expect(page.getByRole('heading', { name: 'Genou gauche' })).toBeVisible();
  await expect(page.getByText(/Anciennes douleurs|Past pains/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Le coude qui tire' })).toHaveCount(0);
});

test('« ça revient » se lit sur la carte, et vient du compte de logs', async ({ page }) => {
  /** ⚠️ `recurrente` EST SERVI PAR BROKKR, où il se déduit du nombre de relevés.
   *  Le recalculer au front ferait une seconde définition de la même notion. */
  await ouvrir(page);
  await expect(page.getByText(/notée 4 fois|logged 4 times/)).toBeVisible();
});

test('la figure nomme ses muscles avec le CÔTÉ DE L’ATHLÈTE', async ({ page }) => {
  /** ⚠️ DE FACE, ON REGARDE QUELQU'UN : sa droite est à notre gauche. La zone
   *  la plus à gauche de l'image doit donc s'annoncer « droite ». Se tromper
   *  n'est pas un défaut d'affichage : c'est envoyer le kiné sur l'autre
   *  épaule, et sept des huit douleurs de production précisent un côté. */
  await ouvrir(page);

  const gauche = page.locator('svg[role="group"]').first()
    .getByRole('button', { name: 'Pectoraux droite', exact: true });
  await expect(gauche).toHaveCount(1);
  const boite = await gauche.boundingBox();
  const cadre = await page.locator('svg[role="group"]').first().boundingBox();
  expect(boite!.x, 'le côté DROIT de l’athlète est à GAUCHE de l’image, de face')
    .toBeLessThan(cadre!.x + cadre!.width / 2);
});

test('la figure descend au MUSCLE, pas à la région', async ({ page }) => {
  /** ⚠️ LE CAS QUI A LANCÉ LE CHANTIER. « Brachial et brachio radial, dips »
   *  est une saisie de production : la figure répondait « Avant-bras » pour ses
   *  trois tracés, dont le brachio-radial. */
  await ouvrir(page);
  for (const nom of ['Brachio-radial droite', 'Couturier gauche', 'Vaste interne droite',
                     'Anconé gauche', 'Pouce droite',
                     // ⚠️ LA VUE DISTINGUE LES DEUX FAISCEAUX DU DELTOÏDE : un
                     // tracé unique de chaque côté, mais pas le même muscle
                     // selon qu'on regarde devant ou derrière.
                     // (à GAUCHE : le deltoïde antérieur DROIT porte la
                     // douleur du jeu de démonstration, donc la mention
                     // « déjà suivie ».)
                     'Deltoïde antérieur gauche', 'Deltoïde postérieur gauche']) {
    await expect(zone(page, nom), nom).toBeAttached();
  }
});

test('toucher un muscle LIBRE ouvre la déclaration, avec son intensité', async ({ page }) => {
  await ouvrir(page);
  await zone(page, 'Pectoraux droite').click();

  await expect(page.getByRole('heading', { name: /Nouvelle douleur|New pain/ })).toBeVisible();
  await expect(page.getByLabel(/appeler cette douleur|call this/i)).toBeVisible();
  // ⚠️ ONZE BOUTONS, PAS UN CURSEUR : une cible de 44 px qu'on atteint du
  // premier coup, là où un `range` se glisse sur une piste de quelques pixels.
  const intensites = page.getByRole('group', { name: /Intensité|Intensity/ }).getByRole('button');
  await expect(intensites).toHaveCount(11);
  await expect(intensites.first()).toHaveAccessibleName(/^0\/10 · (pas mal|no pain)$/);
});

test('toucher un muscle DÉJÀ suivi ne propose pas de doublon', async ({ page }) => {
  /** ⚠️ C'EST TOUT L'OBJET DE LA FEATURE. Sans ce rattachement, chaque
   *  signalement referait un îlot — l'état d'avant, où sept athlètes ont saisi
   *  une fois chacun sans que rien ne se suive. Le serveur refuse le doublon
   *  (409) ; l'écran n'y arrive même pas. */
  await ouvrir(page);
  await zone(page, 'Deltoïde antérieur droite — déjà suivie').click();

  await expect(page.getByRole('heading', { name: /Nouvelle douleur|New pain/ })).toHaveCount(0);
  // La carte de la douleur existante ouvre sa saisie du jour.
  const carte = carteDe(page, 'Mon épaule');
  await expect(carte.getByRole('group', { name: /Intensité|Intensity/ })).toBeVisible();
});

test('noter une douleur propose ZÉRO comme réponse', async ({ page }) => {
  /** ⚠️ « PLUS MAL AUJOURD'HUI » SE DIT. Sans le zéro, une douleur qui passe ne
   *  peut s'exprimer que par le silence — et le silence veut déjà dire « pas
   *  saisi ». Il est VERT, parce que c'est la seule bonne nouvelle que cet
   *  écran sache afficher. */
  await ouvrir(page);
  await carteDe(page, 'Mon épaule')
    .getByRole('button', { name: /Noter aujourd'hui|Corriger la note|Log today|Edit today/ }).click();

  const zero = page.getByRole('group', { name: /Intensité|Intensity/ })
    .getByRole('button', { name: /^0\/10/ });
  await expect(zero).toBeVisible();
  await expect(zero).toHaveCSS('border-bottom-color', 'rgb(127, 165, 140)');
});

test('la carte se lit d’un coup d’œil : chiffre, jauge, fraîcheur', async ({ page }) => {
  await ouvrir(page);
  const carte = carteDe(page, 'Mon épaule');
  // Le gros chiffre et son « /10 » : « Mon épaule » est notée 3.
  await expect(carte.getByText(/^3\/10$/)).toBeVisible();
  // ⚠️ LE BADGE DIT L'ANCIENNETÉ, pas la gravité : une douleur qu'on suit et
  // qu'on ne note plus depuis cinq semaines n'est pas suivie, elle est oubliée.
  await expect(carte.getByText(/Il y a|ago|Noté aujourd'hui|Logged today/)).toBeVisible();
});

test('le staff LIT mais ne se voit proposer aucune saisie', async ({ page }) => {
  /** ⚠️ LA RÈGLE D'AFFORDANCE : le serveur sert la liste en `owner_or_staff`
   *  mais n'accepte les écritures qu'en `owner`. Un bouton qui mène à un 403
   *  n'existe pas — on regarde ici l'athlète d'un AUTRE, via la sélection. */
  await page.goto('/kine?vue=douleurs&athlete=ath-2');
  const figure = page.locator('svg[role="group"]').first();
  if (await figure.getByRole('button').count()) {
    // Le mock ouvre tout à l'utilisateur de démonstration : on ne prouve alors
    // rien ici, et c'est la spec brokkr `test_le_STAFF_lit_mais_n_ecrit_pas` qui
    // garde la règle. On ne laisse pas passer une assertion qui ne mesure rien.
    test.skip(true, 'dev-mock : la sélection ne distingue pas un autre athlète');
  }
});

test('le clavier suffit : tabuler jusqu’à un muscle, Entrée, nommer, valider', async ({ page }) => {
  /** ⚠️ UNE FIGURE CLIQUABLE SEULE EST INUTILISABLE AU LECTEUR D'ÉCRAN. Chaque
   *  muscle est un bouton nommé ; ce parcours est le seul qui le prouve, et il
   *  ne passe par aucune coordonnée. */
  await ouvrir(page);
  const cible = zone(page, 'Pectoraux droite');
  await cible.focus();
  await expect(cible).toBeFocused();
  // Le nom du muscle s'annonce aussi au FOCUS, pas seulement au survol.
  await expect(page.locator('p[aria-live="polite"]')).toHaveText(/Pectoraux droite/);

  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Nouvelle douleur|New pain/ })).toBeVisible();

  await page.getByLabel(/appeler cette douleur|call this/i).fill('Mon pec');
  const suivre = page.getByRole('button', { name: /^(Suivre|Track it)$/ });
  await expect(suivre).toBeEnabled();
});

test('« Suivre » reste fermé tant que la douleur n’a pas de nom', async ({ page }) => {
  await ouvrir(page);
  await zone(page, 'Pectoraux droite').click();
  const suivre = page.getByRole('button', { name: /^(Suivre|Track it)$/ });
  await expect(suivre).toBeDisabled();
  await page.getByLabel(/appeler cette douleur|call this/i).fill('Mon pec');
  await expect(suivre).toBeEnabled();
});

test('la figure tient ENTIÈRE au repos, et c’est le zoom qui la fait déborder', async ({ page }) => {
  /** ⚠️ LE CADRE FAIT 724 × 1448 — UN CORPS DEUX FOIS PLUS HAUT QUE LARGE. Calé
   *  sur la largeur, il rendait une figure du double en hauteur : on ouvrait
   *  l'écran sur un torse, tête et jambes hors champ, et il fallait deviner
   *  qu'on pouvait faire défiler pour atteindre l'endroit où l'on a mal.
   *
   *  ⚠️ ET LE PLANCHER DU DOIGT NE L'AURAIT PAS VU : il compte les cibles sous
   *  44 px, or le débordement ne change pas leur nombre — il change ce qu'on
   *  VOIT. Une spec qui compte ne remplace pas une spec qui cadre. */
  await ouvrir(page);

  const mesurer = () => page.evaluate(() => {
    const svg = document.querySelector('svg[role="group"]') as SVGSVGElement;
    const cadre = svg.closest('.overflow-auto') as HTMLElement;
    return { haut: svg.getBoundingClientRect().height, cadre: cadre.clientHeight,
             large: svg.getBoundingClientRect().width, cadreLarge: cadre.clientWidth };
  });

  const auRepos = await mesurer();
  expect(auRepos.cadre).toBeGreaterThan(0);
  expect(auRepos.haut, `figure ${Math.round(auRepos.haut)}px dans un cadre de ${auRepos.cadre}px`)
    .toBeLessThanOrEqual(auRepos.cadre + 1);
  // ⚠️ ET LA LARGEUR AUSSI : deux corps calés sur la hauteur débordaient de
  // leur colonne, bras hors cadre et barre de défilement horizontale.
  expect(auRepos.large).toBeLessThanOrEqual(auRepos.cadreLarge + 1);

  await page.getByRole('slider', { name: /Zoom/i }).fill('4');
  const agrandie = await mesurer();
  expect(agrandie.haut).toBeGreaterThan(agrandie.cadre);
});

test('la figure montre D’EMBLÉE les muscles suivis, dans la couleur de leur note', async ({ page }) => {
  /** ⚠️ SINON LA RÉPONSE ARRIVE APRÈS LE GESTE. La figure s'ouvrait vierge : on
   *  retouchait l'épaule qu'on suit déjà, et l'app répondait « c'est la même,
   *  la voici » — utile, mais après coup.
   *
   *  ⚠️ ET C'EST UN TROISIÈME ÉTAT, pas une sélection : `aria-pressed` reste
   *  faux, et la couleur est celle de l'INTENSITÉ, pas l'or de la sélection.
   *  Un même or pour les deux ferait croire qu'on a choisi ce qu'on n'a pas
   *  choisi — et la couleur seule ne dirait rien au lecteur d'écran, d'où la
   *  mention dans le nom. */
  await ouvrir(page);
  const suivi = zone(page, 'Deltoïde antérieur droite — déjà suivie');
  await expect(suivi).toBeAttached();
  await expect(suivi).toHaveAttribute('aria-pressed', 'false');
  // « Mon épaule » est notée 3/10 : le palier 1–3, jaune pâle.
  await expect(suivi).toHaveCSS('fill', 'rgb(230, 199, 122)');

  // Un muscle libre reste gris, et ne porte pas la mention.
  await expect(zone(page, 'Pectoraux gauche')).toHaveCSS('fill', 'rgb(180, 179, 184)');
});

test('les muscles de la figure sont atteignables au doigt — grâce au zoom', async ({ page }) => {
  /** ⚠️ LE PLANCHER DU DOIGT NE VOIT PAS LE SVG : `plancher-du-doigt` filtre
   *  sur `offsetParent`, que les éléments SVG ne portent pas. On les mesure
   *  donc ici, par leur rectangle rendu.
   *
   *  ⚠️ ET C'EST LA RÉSERVE DE FRE-195, DEVENUE UN CHIFFRE. Le grain « muscle »
   *  a été retenu contre l'avis que des cibles de cette taille seraient trop
   *  fines sur un téléphone : à l'échelle 1, 61 cibles sur 87 passent sous les
   *  44 px, médiane 27, la plus fine à 11. Le zoom EST la réponse, et cette
   *  spec est ce qui l'oblige à en être une : ×2 en laisse 37, ×3 douze, ×4
   *  quatre. C'est pour ça que le curseur monte à 4 et pas à 3.
   *
   *  MUTATION QUI ROUGIT : ramener `max` à 3 sur le curseur de zoom. */
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrir(page);

  const sous44 = async () => page.evaluate(() =>
    [...document.querySelectorAll('svg[role="group"] g[role="button"]')]
      .map(z => z.getBoundingClientRect().height)
      .filter(h => h > 0 && h < 44).length);

  const auRepos = await sous44();
  expect(auRepos, 'la figure doit porter des cibles à mesurer').toBeGreaterThan(20);

  await page.getByRole('slider', { name: /Zoom/i }).fill('4');
  const auMax = await sous44();
  expect(auMax, `au zoom maximal, ${auMax} cibles restent sous 44 px`).toBeLessThanOrEqual(6);
  expect(auMax).toBeLessThan(auRepos / 4);
});

test('une douleur notée plusieurs fois montre son HISTOIRE', async ({ page }) => {
  /** ⚠️ LA FEATURE PROMET LE SUIVI DANS LE TEMPS (FRE-197), et la carte ne
   *  montrait que la dernière note. Dix relevés de production sur dix portent
   *  un commentaire : c'est le texte que le kiné vient lire, et seul le dernier
   *  survivait à l'écran. */
  await ouvrir(page);
  const carte = carteDe(page, 'Mon épaule');
  await carte.getByRole('button', { name: /Voir l'historique|See history/ }).click();

  await expect(carte.getByText(/4 relevés|4 logs/)).toBeVisible();
  // Les commentaires passés, que la carte seule effaçait.
  await expect(carte.getByText(/Échauffement plus long/)).toBeVisible();
  await expect(carte.getByText(/Réveil difficile/)).toBeVisible();
});

test('LIRE son histoire ne demande pas d’ÉCRIRE', async ({ page }) => {
  /** ⚠️ LES DEUX GESTES ÉTAIENT CONFONDUS. L'historique ne s'ouvrait qu'avec la
   *  saisie : pour relire ses notes il fallait cliquer « Corriger la note du
   *  jour » — faire mine d'écrire pour lire. Et le staff, qui n'écrit pas, le
   *  voyait toujours déplié : la même carte se comportait de deux façons selon
   *  qui la regarde.
   *
   *  MUTATION QUI ROUGIT : rebrancher l'historique sur `ouvert` — le voir
   *  ouvrirait le sélecteur d'intensité avec lui. */
  await ouvrir(page);
  const carte = carteDe(page, 'Mon épaule');
  await carte.getByRole('button', { name: /Voir l'historique|See history/ }).click();

  await expect(carte.getByText(/4 relevés|4 logs/)).toBeVisible();
  // Rien ne s'est ouvert du côté de l'écriture.
  await expect(carte.getByRole('group', { name: /Intensité|Intensity/ })).toHaveCount(0);
});

test('l’histoire n’est PAS montée tant qu’on ne la demande pas', async ({ page }) => {
  /** ⚠️ UN APPEL PAR CARTE OUVERTE, PAS UN PAR DOULEUR AFFICHÉE. La liste se lit
   *  à chaque ouverture de l'écran : charger l'historique de toutes les douleurs
   *  ferait payer le suivi à qui vient juste voir où il a mal.
   *
   *  ⚠️ ON MESURE LE MONTAGE, PAS LE RÉSEAU, et ce n'est pas un raccourci : sur
   *  le dev-mock AUCUNE requête ne part jamais — `queryFn` rend une valeur en
   *  mémoire. Une spec qui écouterait `page.on('request')` serait verte quoi
   *  qu'on fasse, y compris en montant l'histoire de force. Essayé, et elle
   *  restait verte sous la mutation : c'est le hook qui ne peut pas appeler ce
   *  qui n'est pas monté, et c'est donc ça qu'on vérifie. Le coût réseau réel
   *  appartient au harnais, pas au mock. */
  await ouvrir(page);
  const carte = carteDe(page, 'Mon épaule');
  // ⚠️ LE TITRE DE SECTION, PAS LE TEXTE BRUT : le bouton porte lui aussi le
  // compte (« Voir l'historique (4 relevés) »), et c'est voulu — sans lui rien
  // ne dirait qu'il y a quelque chose à déplier. Chercher « 4 relevés » dans la
  // carte trouverait donc le bouton, et la spec serait verte pour rien.
  await expect(carte.getByRole('heading', { level: 4 })).toHaveCount(0);

  await carte.getByRole('button', { name: /Voir l'historique|See history/ }).click();
  await expect(carte.getByRole('heading', { level: 4 })).toBeVisible();
});

test('la courbe porte le TEMPS RÉEL, et ne comble pas les trous', async ({ page }) => {
  /** ⚠️ L'AXE EST LE TEMPS, PAS LE RANG DU RELEVÉ. Première version : un bâton
   *  par relevé, tous de même largeur — deux notes à un mois d'écart y
   *  ressemblaient trait pour trait à deux notes consécutives. « On voit pas la
   *  différence de dates » (William, 22/09), et c'est précisément ce qu'une
   *  douleur suivie doit montrer.
   *
   *  ⚠️ ET LES TROUS RESTENT DES TROUS. « Pas noté » n'est pas « 0 » : le zéro
   *  est une réponse, et il est vert. Les jours sans relevé se traversent par
   *  un PONT droit et plus clair — la convention que `lib/courbe` porte déjà
   *  pour le tracker, où la rectitude dit elle-même qu'on n'a rien mesuré là.
   *
   *  MUTATION QUI ROUGIT : placer les points sur leur rang (`x(i)` sur l'index
   *  du relevé) au lieu de leur date — les écarts deviennent tous égaux. */
  await ouvrir(page);
  const carte = carteDe(page, 'Mon épaule');
  await carte.getByRole('button', { name: /Voir l'historique|See history/ }).click();

  // L'historique est un appel à part : on attend qu'il soit là avant de mesurer.
  await expect(carte.getByText(/4 relevés|4 logs/)).toBeVisible();

  const mesure = await page.evaluate(() => {
    const svg = [...document.querySelectorAll('svg')]
      .find(s => s.getAttribute('viewBox') === '0 0 900 200')!;
    const cx = [...svg.querySelectorAll('circle')].map(c => Number(c.getAttribute('cx')));
    const dates = [...svg.querySelectorAll('text')].map(t => t.textContent ?? '')
      .filter(x => /^\d{4}-/.test(x));
    return {
      points: cx.length,
      ecarts: cx.slice(1).map((v, i) => Math.round(v - cx[i])),
      ponts: [...svg.querySelectorAll('path')].filter(p => p.getAttribute('opacity') === '0.35').length,
      bornes: dates,
    };
  });

  expect(mesure.points).toBe(4);
  // Le jeu du mock est noté à 44, 30, 8 et 1 jours : 14, 22 puis 7 jours
  // d'écart. Des écarts tous égaux voudraient dire qu'on trace le rang.
  expect(new Set(mesure.ecarts).size, `écarts ${mesure.ecarts.join(', ')}`).toBe(3);
  const parJour = [mesure.ecarts[0] / 14, mesure.ecarts[1] / 22, mesure.ecarts[2] / 7];
  for (const p of parJour) expect(p).toBeCloseTo(parJour[0], 1);

  // Aucun relevé n'est consécutif : tout est pont, et les trous se voient.
  expect(mesure.ponts).toBe(3);
  expect(mesure.bornes).toHaveLength(2);

  // ⚠️ LA COURBE EST `aria-hidden` : elle ne se lit pas à voix haute. C'est la
  // liste datée qui porte le contenu, commentaires compris.
  await expect(carte.locator('ul').filter({ hasText: /\d\/10/ }).locator('li')).toHaveCount(4);
});

test('le jour se déclare ENTRAÎNÉ ou non, et peut rester sans réponse', async ({ page }) => {
  /** ⚠️ « J'AI DÉJÀ EU DES DOULEURS MÊME HORS TRAINING, PERSISTANTES »
   *  (William, 23/09). C'est ce que le kiné cherche en premier devant une
   *  douleur qui dure, et la base ne sait pas y répondre : mesuré le 23/09,
   *  9 relevés sur 11 tombaient un jour sans trace d'entraînement — dont un où
   *  l'athlète s'était entraîné LA VEILLE. Une séance peut être saisie plus
   *  tard, ou pas du tout.
   *
   *  ⚠️ TROIS ÉTATS, ET LE TROISIÈME EST LE PLUS IMPORTANT. Une case à cocher
   *  n'en aurait que deux et dirait « repos » là où personne n'a répondu.
   *  Recliquer remet la question à « non dit ».
   *
   *  MUTATION QUI ROUGIT : faire du bouton un choix exclusif qu'on ne peut plus
   *  désélectionner — « pas dit » devient impossible à redonner. */
  await ouvrir(page);
  await carteDe(page, 'Mon épaule')
    .getByRole('button', { name: /Noter aujourd'hui|Corriger la note|Log today|Edit today/ }).click();

  const jour = page.getByRole('group', { name: /Ce jour-là|That day/ });
  const entraine = jour.getByRole('button', { name: /^(Entraînement|Training)$/ });
  const repos = jour.getByRole('button', { name: /^(Repos|Rest)$/ });

  // Au départ, aucune réponse : la question n'a pas encore été posée.
  await expect(entraine).toHaveAttribute('aria-pressed', 'false');
  await expect(repos).toHaveAttribute('aria-pressed', 'false');

  await entraine.click();
  await expect(entraine).toHaveAttribute('aria-pressed', 'true');
  await expect(repos).toHaveAttribute('aria-pressed', 'false');

  await repos.click();
  await expect(entraine).toHaveAttribute('aria-pressed', 'false');
  await expect(repos).toHaveAttribute('aria-pressed', 'true');

  // ⚠️ ET ON PEUT REVENIR À « NON DIT » : une réponse donnée par erreur doit
  // pouvoir partir, sinon on force un fait que personne n'a déclaré.
  await repos.click();
  await expect(repos).toHaveAttribute('aria-pressed', 'false');
});

test('l’historique dit « repos » ou « entraînement » — et rien quand on n’a pas répondu', async ({ page }) => {
  /** ⚠️ `null` N'EST PAS « REPOS ». Les relevés d'avant cette question n'ont
   *  jamais eu l'occasion de répondre : les afficher « repos » inventerait des
   *  journées que personne n'a déclarées. Le jeu de démonstration porte les
   *  trois cas exprès. */
  await ouvrir(page);
  const carte = carteDe(page, 'Mon épaule');
  await carte.getByRole('button', { name: /Voir l'historique|See history/ }).click();
  await expect(carte.getByRole('heading', { level: 4 })).toBeVisible();

  const lignes = carte.locator('ul').filter({ hasText: /\d\/10/ }).locator('li');
  await expect(lignes).toHaveCount(4);
  // Quatre relevés, mais seulement deux réponses : les deux plus anciens sont
  // d'avant la question.
  await expect(lignes.getByText(/^(Entraînement|Training)$/)).toHaveCount(1);
  await expect(lignes.getByText(/^(Repos|Rest)$/)).toHaveCount(1);
});

test('la courbe marque les jours ENTRAÎNÉS, et rien d’autre', async ({ page }) => {
  /** ⚠️ SUR LE GRAPHE ET DANS LA LISTE, pas l'un ou l'autre : c'est sur la
   *  courbe qu'on lit « cette pointe suit une séance » d'un coup d'œil, et
   *  c'est dans la liste qu'on lit laquelle.
   *
   *  ⚠️ ET SEULS LES JOURS ENTRAÎNÉS PORTENT UNE BANDE. L'absence de bande ne
   *  dit RIEN — ni « repos », ni « pas répondu ». En colorer une pour le repos
   *  demanderait de distinguer deux teintes pâles pour une nuance que la liste
   *  énonce en toutes lettres ; en colorer une pour « pas répondu »
   *  inventerait des journées que personne n'a déclarées.
   *
   *  MUTATION QUI ROUGIT : bander tous les relevés au lieu des seuls entraînés
   *  — quatre bandes au lieu d'une. */
  await ouvrir(page);
  const carte = carteDe(page, 'Mon épaule');
  await carte.getByRole('button', { name: /Voir l'historique|See history/ }).click();
  await expect(carte.getByRole('heading', { level: 4 })).toBeVisible();

  const mesure = await page.evaluate(() => {
    const svg = [...document.querySelectorAll('svg')]
      .find(s => s.getAttribute('viewBox') === '0 0 900 200')!;
    const bandes = [...svg.querySelectorAll('rect')]
      .map(r => Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2);
    const points = [...svg.querySelectorAll('circle')].map(c => Number(c.getAttribute('cx')));
    return { bandes, points };
  });

  // Un seul relevé du jeu de démonstration est déclaré entraîné.
  expect(mesure.bandes).toHaveLength(1);
  // Et la bande tombe SUR son point, pas à côté.
  const ecart = Math.min(...mesure.points.map(p => Math.abs(p - mesure.bandes[0])));
  expect(ecart, `bande à ${mesure.bandes[0]}, points à ${mesure.points.join(', ')}`).toBeLessThan(2);

  // ⚠️ UNE BANDE NE SE LIT PAS SEULE : sans ce mot, un fond doré derrière un
  // point n'est qu'une décoration.
  await expect(carte.getByText(/^(Entraînement|Training)$/).first()).toBeVisible();
});
