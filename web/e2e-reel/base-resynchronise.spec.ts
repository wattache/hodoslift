import { expect, test } from '@playwright/test';
import { S1_DATEE, arbre, modeCoach, nettoyer, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** L'ÉDITEUR DE BASE RELIT LE SERVEUR (FRE-66).
 *
 *  Le brouillon était semé UNE FOIS au montage et plus jamais relu : l'éditeur
 *  travaillait sur une photo, et la fenêtre de décalage n'avait aucune borne
 *  tant que le panneau restait ouvert.
 *
 *  ⚠️ CE QUE ÇA A PRODUIT — le mystère de la « seconde tentative » d'Aubin, le
 *  17/08. Il ouvrait la BASE, voyait ses principes, refermait, rouvrait : vide.
 *  Deux ouvertures, deux résultats, aucun geste différent. La cause n'était pas
 *  son geste mais le MOMENT du montage — avant ou après la réponse du serveur.
 *
 *  ⚠️ POURQUOI CONTRE LA VRAIE PILE. Le défaut est un décalage ENTRE deux
 *  sources : ce que l'écran tient en mémoire et ce que la base porte vraiment.
 *  Sur le dev-mock les écritures sont des no-op — les deux ne peuvent pas
 *  diverger, donc le défaut n'y est pas reproductible. Il fallait un vrai
 *  serveur que l'on puisse faire changer DANS LE DOS de l'écran.
 */
test.afterEach(nettoyer);

const PRINCIPE = {
  name: 'SQUAT', tier: 1, variant: [], sets: '5', reps: '5',
  repsUnit: 'count', weight: '100',
};

test('la BASE modifiée dans le dos de l’écran finit par s’afficher', async ({ page }) => {
  // Un bloc dont la trame est VIDE : c'est ce que l'écran va photographier.
  await poserUnMacro([], { sansSemaine: true, datesDeS1: S1_DATEE });
  const bloc = (await arbre()).macros[0].blocks[0];

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  // La photo est prise : la grille jours × mouvements n'a aucun tier posé.
  // Les tiers posés, lus sur les cases de la grille (des boutons depuis le 20/09).
  const tiers = () => page.getByRole('button', { name: /^J\d+, [A-ZÉÈ ]+\s*:/ })
    .evaluateAll(bs => bs.map(b => (b.textContent ?? '').trim()));
  expect(await tiers()).not.toContain('1');

  // LE SERVEUR BOUGE, sans que l'écran en sache rien — c'est exactement ce
  // qu'un second onglet ou un autre coach produirait.
  await poserUneBase(bloc.id, {
    daySplit: [{ day: 'J1', tiers: { SQUAT: 1 } }],
    selectedPrincipaux: ['SQUAT'],
    principles: [PRINCIPE],
    accessories: [],
    // La BASE garde ses dates : le « + Semaine » qui déclenche la relecture les
    // exige (FRE-138).
    s1StartDate: S1_DATEE.debut, s1EndDate: S1_DATEE.fin,
  });

  // ⚠️ IL FAUT PROVOQUER LE REFETCH, sans quoi le test n'éprouve rien. En usage
  // réel il vient tout seul : `refetchOnWindowFocus: true` — le coach bascule
  // vers une autre fenêtre et revient. Ici on ajoute une semaine, l'un des
  // gestes STRUCTURELS qui appellent `invalidate()`.
  //
  // ⚠️ ET PAS UN RENOMMAGE, qui semblait pourtant le geste le plus léger :
  // `patchMeta` écrit sans jamais invalider (les renommages sont optimistes et
  // locaux). Le test passait donc à côté de son propre déclencheur — il aurait
  // échoué avec ou sans le correctif, ce qui est le pire des tests.
  //
  // Le panneau BASE reste monté : `key={block.id}` ne change pas, donc le
  // brouillon survit — c'est exactement la condition qu'on veut éprouver.
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();

  // ⚠️ L'ASSERTION DU TICKET. Le tier posé côté serveur apparaît dans la grille :
  // il ne peut venir que d'une RELECTURE de la prop, le brouillon ne l'ayant
  // jamais contenu. Sans resync, cette case reste à « — » pour toujours, et le
  // coach doit fermer/rouvrir le panneau pour la découvrir — c'est exactement la
  // « seconde tentative » d'Aubin.
  //
  // ⚠️ ET PAS « le bouton Générer s'active » : le geste déclencheur crée une
  // semaine, donc désactive ce bouton pour une raison SANS RAPPORT (« la semaine
  // 1 contient déjà des séances »). L'assertion aurait été rouge avec un
  // correctif parfaitement fonctionnel.
  await expect.poll(tiers, { timeout: 15_000 }).toContain('1');
});

test('une édition NON ACQUITTÉE n’est jamais écrasée par le resync', async ({ page }) => {
  /** ⚠️ L'AUTRE MOITIÉ, ET C'EST ELLE QUI REND LE CORRECTIF SÛR. `PUT /base`
   *  remplace la trame INTÉGRALEMENT : resemer par-dessus une frappe non encore
   *  acquittée l'effacerait — on causerait la perte qu'on prétend empêcher.
   *
   *  ⚠️ LA PREMIÈRE VERSION DE CETTE SPEC NE PROUVAIT RIEN. Elle vérifiait qu'un
   *  choix du coach arrive en base, ce qui reste vrai avec ou sans garde-fou :
   *  rien n'y déclenchait de resync pendant l'écriture. La mutation l'a dit —
   *  retirer la garde ne la faisait pas rougir. Il faut donc FABRIQUER la
   *  concurrence : on retient la requête d'écriture, et on provoque une
   *  invalidation pendant qu'elle est en vol. */
  await poserUnMacro([], { sansSemaine: true, datesDeS1: S1_DATEE });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  // ⚠️ L'INTERCEPTION SE POSE ICI, pas avant `seConnecter` : installée dès
  // l'ouverture, elle perturbait la popup d'authentification de l'émulateur et
  // le test échouait avant d'avoir rien éprouvé. La retenue ne doit couvrir que
  // l'instant qu'on veut observer.
  await page.route('**/blocks/*/base', async route => {
    await new Promise(r => setTimeout(r, 2000));
    await route.continue();
  });

  // Le geste du coach : poser un tier dans la grille jours × mouvements.
  await page.getByRole('button', { name: /^J1, SQUAT\s*:/ }).click();

  // PENDANT que l'écriture est en vol, un geste structurel invalide la requête
  // et fait redescendre une prop… qui ne porte pas encore ce tier.
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();

  // ⚠️ LE TIER DOIT SURVIVRE. Sans la garde, le resync le remplace par la trame
  // d'avant — le coach voit son choix disparaître sous ses yeux, et la prochaine
  // écriture le grave.
  // Les tiers posés, lus sur les cases de la grille (des boutons depuis le 20/09).
  const tiers = () => page.getByRole('button', { name: /^J\d+, [A-ZÉÈ ]+\s*:/ })
    .evaluateAll(bs => bs.map(b => (b.textContent ?? '').trim()));
  await page.waitForTimeout(3000);   // l'écriture a eu le temps d'aboutir
  expect(await tiers()).toContain('1');

  // Et il est bien arrivé en base.
  await expect.poll(async () => {
    const jours = (await arbre()).macros[0].blocks[0].base?.daySplit ?? [];
    return jours.some((j: { tiers?: Record<string, number> }) =>
      Object.keys(j.tiers ?? {}).length > 0);
  }, { timeout: 15_000 }).toBe(true);
});
