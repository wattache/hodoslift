import { expect, test } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** Générer la semaine 1 depuis la BASE, sur une semaine EXISTANTE.
 *
 *  C'est le cas NOMINAL du flux trame → génération. Il a changé de chemin le
 *  22/08 : un bloc neuf naissait avec sa semaine 1 vide, donc la génération
 *  passait par « semaine existante » (`PUT /weeks/{id}/content`) — et ce
 *  chemin-là a été cassé deux fois, le front envoyant le contenu à
 *  `PATCH /weeks/{id}` qui ne connaît que la méta. Le bloc naît désormais NU,
 *  et la génération CRÉE la semaine.
 *
 *  La BASE est posée par l'API (le décor) ; le GESTE — le bouton « Générer la
 *  semaine 1 » — passe par l'interface, et la preuve par `GET /training`.
 *
 *  ÉPROUVÉE en réintroduisant le défaut : `generateWeekOneFromBase` renvoyé sur
 *  `api.patch('/weeks/{id}', contenu)` comme avant le correctif (eitri,
 *  `training-editor.ts`) → 422 serveur, la semaine reste vide, la spec rougit.
 *  Rétabli.
 */
test.afterEach(nettoyer);

test('générer la semaine 1 depuis la BASE écrit les séances pour de vrai', async ({ page }) => {
  // ⚠️ UN BLOC SANS AUCUNE SEMAINE — l'état d'un bloc neuf depuis le 22/08, et
  // donc le point de départ réel du coach qui compose une BASE. La génération
  // CRÉE la semaine (`POST /blocks/{id}/weeks`) au lieu de remplir une coquille
  // qu'on lui avait posée d'office.
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    daySplit: [{ day: 'J1', tiers: { SQUAT: 1 } }],
    selectedPrincipaux: ['SQUAT'],
    principles: [{ name: 'SQUAT', tier: 1, variant: [], sets: '5', reps: '5',
                   repsUnit: 'count', weight: '100' }],
    accessories: [],
    // ⚠️ DES DATES S1 DEPUIS FRE-138, ET C'EST UN RENVERSEMENT. Cette spec disait
    // « PAS de dates S1 : l'état de 54 blocs réels sur 125 » — vrai, et c'était
    // justement le problème : une trame sans date produit des semaines sans date,
    // donc du réalisé qui n'entre dans aucune courbe. La génération les EXIGE
    // maintenant, et refuse en 409 `base_sans_dates`.
    //
    // Ce que l'ancien commentaire gardait — « une BASE sans dates reste
    // ENREGISTRABLE » — n'a pas disparu et n'a pas changé : c'est
    // `base-sans-dates.spec.ts`, et la contrainte ne porte que sur la GÉNÉRATION.
    s1StartDate: '2026-09-07',
    s1EndDate: '2026-09-13',
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await page.getByRole('button', { name: 'Générer la semaine 1' }).click();

  // La vérité du serveur : la semaine 1 porte la séance générée et sa ligne.
  await expect.poll(async () => {
    const s = (await arbre()).macros[0]?.blocks[0]?.weeks[0]?.sessions ?? [];
    return s.map(x => ({ nom: x.name, lignes: x.exercises.map(e => e.name) }));
  }, { timeout: 10_000 }).toEqual([{ nom: 'J1', lignes: ['SQUAT'] }]);
});

test('changer l’incrément dans la BASE change la semaine SUIVANTE', async ({ page }) => {
  /** ⚠️ LE CHEMIN COMPLET DE FRE-150, ET AUCUNE SPEC NE LE TRAVERSAIT. Les specs
   *  unitaires prouvent que `semaine_suivante` relit la trame ; celle-ci prouve
   *  que le geste du coach — corriger l'incrément dans l'éditeur de BASE — arrive
   *  jusqu'à la semaine générée.
   *
   *  C'est exactement le signalement : « son dips du mardi ne s'incrémente pas,
   *  alors que l'incrément existe ». Il existait dans la trame, et la trame
   *  n'était plus jamais relue — la ligne gardait l'incrément qu'elle avait à sa
   *  naissance, ou n'en avait aucun, et alors la charge était EFFACÉE.
   *
   *  ⚠️ LA LIGNE DE SEMAINE NAÎT SANS INCRÉMENT, à dessein : c'est l'état des
   *  33 lignes de production qui portaient le défaut. Si la trame n'était pas
   *  relue, la semaine 2 n'aurait aucune charge du tout. */
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '5', weight: '100' }]);
  const bloc = (await arbre()).macros[0].blocks[0];

  // Le coach pose l'incrément dans la TRAME, après coup — la ligne de semaine,
  // elle, n'en a jamais eu.
  await poserUneBase(bloc.id, {
    daySplit: [{ day: 'J1', tiers: { SQUAT: 1 } }],
    selectedPrincipaux: ['SQUAT'],
    principles: [{ name: 'SQUAT', tier: 1, variant: [], sets: '5', reps: '5',
                   repsUnit: 'count', weight: '100',
                   increment: '5', incrementUnit: 'kg' }],
    accessories: [],
    s1StartDate: '2026-09-07', s1EndDate: '2026-09-13',
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();

  await expect.poll(async () => {
    const semaines = (await arbre()).macros[0].blocks[0].weeks;
    return semaines[1]?.sessions?.[0]?.exercises?.[0]?.weight;
  }, { timeout: 10_000, message: 'la trame n’a pas été relue' }).toBe('105');
});
