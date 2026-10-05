import { expect, test } from '@playwright/test';
import { S1_DATEE, arbre, modeCoach, nettoyer, poserUneBase, seConnecter } from './aides';

/** Les gestes de CRÉATION, vérifiés en base et non à l'écran.
 *
 *  C'est la différence avec les 77 specs du dev-mock : là-bas les écritures sont
 *  des no-op, donc « le macro s'affiche » ne dit rien de « le macro existe ».
 *  Ici chaque assertion passe par `GET /training` — la vérité du serveur.
 *
 *  Ce que ces tests auraient attrapé : `addMacro` envoyait `week` à la racine et
 *  prenait un 422 sur CHAQUE ajout de macro. Personne ne l'a vu pendant des
 *  semaines, parce qu'aucun test ne traversait le réseau.
 */
test.afterEach(nettoyer);

test('créer un macrocycle l’écrit VRAIMENT', async ({ page }) => {
  await seConnecter(page);
  await page.goto('/training');

  expect((await arbre()).macros).toHaveLength(0);

  await page.getByRole('button', { name: 'Créer un macrocycle' }).click();
  await expect(page.getByRole('button', { name: /Créer un macrocycle/ })).toBeHidden({ timeout: 10_000 })
    .catch(() => { /* le bouton peut rester : c'est l'état SERVEUR qui tranche */ });

  await expect.poll(async () => (await arbre()).macros.length,
                    { timeout: 10_000 }).toBe(1);

  // …et il naît avec son bloc et SANS semaine.
  //
  // ⚠️ CE CONTRAT A CHANGÉ LE 22/08. Un macro neuf ouvrait sur une semaine 1
  // vide que personne n'avait demandée — déroutant pour les coachs qui
  // composent d'abord la BASE, puisqu'ils voyaient un objet apparaître avant
  // d'avoir rien décidé, et que « Générer la semaine 1 » le remplaçait ensuite.
  // Le bloc naît nu ; c'est la génération (ou « + Semaine ») qui crée.
  const macro = (await arbre()).macros[0];
  expect(macro.blocks).toHaveLength(1);
  expect(macro.blocks[0].weeks).toHaveLength(0);
});

test('la ligne vide d’une semaine neuve existe côté serveur', async ({ page }) => {
  await seConnecter(page);
  await page.goto('/training');
  await page.getByRole('button', { name: 'Créer un macrocycle' }).click();

  await expect.poll(async () => (await arbre()).macros.length,
                    { timeout: 10_000 }).toBe(1);

  // ⚠️ LA SEMAINE SE DEMANDE MAINTENANT. Le macro naît sans elle (22/08), donc
  // ce test doit poser le geste « + Semaine » — qui reste le chemin où
  // `materialiserLignesVides` compte.
  // ⚠️ LA BASE DOIT ÊTRE DATÉE D'ABORD (FRE-138) : « + Semaine » est fermé sur un
  // bloc sans dates de S1, et brokkr refuse en 409. Posée par l'API, puis relue.
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, { daySplit: [], selectedPrincipaux: null, principles: [], accessories: [],
                                s1StartDate: S1_DATEE.debut, s1EndDate: S1_DATEE.fin });
  // ⚠️ `goto`, PAS `reload` : recharger pendant que la première ouverture finit de
  // se poser laissait parfois l'écran sans le bouton « Coach » pendant 30 s — une
  // fois sur deux passages complets du harnais, jamais seul.
  await page.goto('/training');
  // Le panneau « Gérer » n'existe qu'en mode coach — l'athlète ne compose pas.
  await modeCoach(page);
  // Le « + » est une icône SVG : le nom accessible du bouton est « Semaine » nu.
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await expect.poll(async () => (await arbre()).macros[0].blocks[0].weeks.length,
                    { timeout: 10_000 }).toBe(1);

  // `createEmptyWeek` affiche une ligne vide que le chargement en masse ÉCARTE.
  // `materialiserLignesVides` la crée ensuite pour de bon — sans quoi la première
  // frappe du coach serait perdue jusqu'au refetch.
  await expect.poll(async () => {
    const s = (await arbre()).macros[0].blocks[0].weeks[0].sessions;
    return s?.[0]?.exercises?.length ?? 0;
  }, { timeout: 10_000 }).toBe(1);
});
