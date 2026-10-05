import { expect, test } from '@playwright/test';
import { ATHLETE, arbre, nettoyer, patchBrut, poserUnMacro, seConnecter } from './aides';

/** Le parcours de l'ATHLÈTE — le second rôle, celui qu'aucun test d'interface
 *  ne couvrait.
 *
 *  La règle métier (FRE-43) : l'athlète décrit SON ÉTAT — répétitions faites,
 *  forme du jour, poids — et jamais la programmation. Côté serveur c'est
 *  `_CHAMPS_ATHLETE` qui la tient ; côté interface, l'affordance n'existe pas.
 *  Les deux moitiés se testent donc différemment :
 *
 *   - le RÉALISÉ passe par l'interface, comme l'athlète le vit (connexion avec
 *     le second compte de l'émulateur, saisie, debounce, écriture réelle) ;
 *   - le REFUS (403 sur la méta) passe par l'API brute : l'interface n'offrant
 *     pas le geste, seul un appel direct peut prouver que le serveur le
 *     refuserait à un client moins poli.
 *
 *  ÉPROUVÉE en réintroduisant le défaut : `"name"` ajouté à
 *  `_CHAMPS_ATHLETE["semaine"]` (brokkr, `training_structure.py`) → le PATCH
 *  méta passe en 200 et la spec rougit sur l'assertion 403. Rétabli.
 */
test.afterEach(nettoyer);

test('l’athlète saisit son réalisé ; la programmation lui reste fermée', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);

  await seConnecter(page, ATHLETE);
  await page.goto('/training');

  // Saisir le réalisé, comme à la salle. Côté athlète, deux plis à ouvrir :
  // la séance (accordéon fermé au chargement), puis le panneau de saisie de la
  // ligne (le chevron « Ajouter une note »).
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran (le bandeau la choisit quand il y en a plusieurs), et la replier ne
  // laissait qu'un titre au-dessus du vide. Le nom n'est plus un bouton : on
  // attend qu'il soit là, on ne le clique plus.
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByTitle('Ajouter une note').first().click();
  const reps = page.getByLabel('Rép. réelles').first();
  await reps.fill('4');
  await reps.blur();
  await page.getByRole('button', { name: 'Forme 4/5' }).click();
  await page.waitForTimeout(1200);            // le debounce d'écriture est à 400 ms

  // La vérité du serveur : le réalisé est écrit…
  await expect.poll(async () => {
    const seance = (await arbre()).macros[0]?.blocks[0]?.weeks[0]?.sessions?.[0];
    return { reps: seance?.exercises?.[0]?.repsDone, forme: seance?.formOfTheDay };
  }, { timeout: 10_000 }).toEqual({ reps: '4', forme: 4 });

  // …et la méta reste fermée : renommer ou masquer une semaine, renommer une
  // séance, sont des gestes de programmation. 403 — l'objet existe et l'athlète
  // le lit, c'est le CHAMP qui lui est refusé.
  const semaine = (await arbre()).macros[0].blocks[0].weeks[0];
  const seance = semaine.sessions![0];
  expect(await patchBrut(ATHLETE, `/weeks/${semaine.id}`, { name: 'pirate' })).toBe(403);
  expect(await patchBrut(ATHLETE, `/weeks/${semaine.id}`, { hidden: true })).toBe(403);
  expect(await patchBrut(ATHLETE, `/sessions/${seance.id}`, { name: 'pirate' })).toBe(403);

  // Son état, en revanche, s'écrit : le poids de la semaine est à lui.
  expect(await patchBrut(ATHLETE, `/weeks/${semaine.id}`, { athleteWeightKg: 72.5 })).toBe(200);
});

test('l’athlète note un repos réel sur une ligne à repos PRESCRIT', async ({ page }) => {
  /** ⚠️ CE QUE LA SPEC CI-DESSUS NE COUVRAIT PAS. Elle éprouve `repsDone`, qui
   *  s'est toujours saisi. `restActual`, lui, n'était offert que sur un repos
   *  LIBRE : 4 395 lignes de production portent un repos prescrit, et AUCUNE ne
   *  portait de réel — faute de case, pas faute d'envie (877 saisies sur les
   *  7 299 lignes à repos libre, là où la case existait).
   *
   *  Le champ vient d'être ouvert partout (FRE-42). Les specs sur maquette
   *  prouvent qu'il S'AFFICHE ; celle-ci prouve que ce qu'on y tape ARRIVE —
   *  à travers le debounce, le PATCH et la colonne.
   *
   *  ⚠️ ET C'EST L'ATHLÈTE QUI ÉCRIT, pas le coach. `restActual` appartient à
   *  `CHAMPS_REALISE` : si un jour il en sortait, l'interface continuerait
   *  d'offrir la case et le serveur répondrait 403 — une frappe perdue en
   *  silence, le pire défaut de ce produit. */
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3', rest: '180' }]);

  await seConnecter(page, ATHLETE);
  await page.goto('/training');
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByTitle('Ajouter une note').first().click();

  const repos = page.getByLabel('Repos réel').first();
  // La consigne sert de repère — en secondes, sous le titre « Repos (s) » depuis
  // le 13/09 — et la case est VIDE : « pris comme prévu » ne s'écrit pas.
  await expect(repos).toHaveAttribute('placeholder', '180');
  await expect(repos).toHaveValue('');

  await repos.fill('300');
  await repos.blur();

  await expect.poll(async () => {
    const l = (await arbre()).macros[0]?.blocks[0]?.weeks[0]?.sessions?.[0]?.exercises ?? [];
    return l[0]?.restActual;
  }, { timeout: 10_000, message: 'le repos réel n’est jamais arrivé en base' }).toBe('300');

  // ⚠️ ET LA CONSIGNE N'A PAS BOUGÉ. Écrire le réel dans `rest` détruirait la
  // prescription du coach — c'est le défaut jumeau que `weightDone` a déjà
  // connu, et il ne se voit qu'en relisant les DEUX champs.
  const ligne = (await arbre()).macros[0].blocks[0].weeks[0].sessions![0].exercises[0];
  expect(ligne.rest, 'la consigne du coach est intacte').toBe('180');
});
