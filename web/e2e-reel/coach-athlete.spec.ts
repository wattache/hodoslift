import { expect, test } from '@playwright/test';
import {
  arbre, COACH_ATHLETE, modeCoach, nettoyerLeProgramme, patchBrut, poserUnMacro,
  PROGRAMME_DOUBLE, seConnecter,
} from './aides';

/** LE COACH QUI EST AUSSI ATHLÈTE — le quatrième compte du harnais (FRE-142).
 *
 *  ⚠️ C'ÉTAIT LE CAS LE PLUS COURANT EN PRODUCTION ET AUCUN HARNAIS NE LE
 *  CONSTRUISAIT. Mesuré le 09/09 : les 4 coachs sont athlètes. William est les
 *  deux, sur son propre programme. `athlete.spec.ts` prouve ce que l'athlète
 *  SEUL ne peut pas faire ; cette spec prouve que les deux rôles réunis
 *  s'ADDITIONNENT au lieu de s'annuler — côté serveur (`perimetre.py` fait
 *  l'union de `access.roles`) comme côté écran (`isSelf` ET `canManage`).
 *
 *  FRE-118 et FRE-127 ont chacune laissé passer un défaut par là : une règle
 *  branchée sur le rôle, verte pour le coach, verte pour l'athlète, et fausse
 *  pour celui qui est les deux.
 *
 *  ⚠️ VUE ROUGE par la mutation qui vise ce qu'elle promet : dans
 *  `refuser_hors_perimetre`, `PROGRAMMEURS & access.roles` remplacé par
 *  `access.roles <= PROGRAMMEURS` (« du staff PUR seulement ») → le renommage
 *  de semaine tombe en 403 ci-dessous. Rétabli.
 */
test.afterEach(() => nettoyerLeProgramme(PROGRAMME_DOUBLE, COACH_ATHLETE));

test('le coach-athlète saisit son réalisé ET programme, sur le même programme', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }],
    { programme: PROGRAMME_DOUBLE, compte: COACH_ATHLETE });

  await seConnecter(page, COACH_ATHLETE);
  await page.goto('/training');

  // L'ATHLÈTE en lui : la saisie du réalisé, comme dans `athlete.spec.ts`.
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
  await page.waitForTimeout(1200);            // le debounce d'écriture est à 400 ms

  await expect.poll(async () => {
    const seance = (await arbre(PROGRAMME_DOUBLE, COACH_ATHLETE))
      .macros[0]?.blocks[0]?.weeks[0]?.sessions?.[0];
    return seance?.exercises?.[0]?.repsDone;
  }, { timeout: 10_000, message: 'le réalisé du coach-athlète n’est jamais arrivé' }).toBe('4');

  // LE COACH en lui : le mode Coach existe — `canManage`, que l'athlète seul
  // n'a pas. C'est l'affordance d'écriture, et elle n'est offerte que là où
  // brokkr accepte.
  await modeCoach(page);
  await expect(page.getByRole('button', { name: 'Coach', exact: true })).toBeVisible();

  // Et le serveur tient sa moitié : la méta ET la prescription s'écrivent —
  // exactement ce que `athlete.spec.ts` voit refuser en 403 à l'athlète seul.
  const semaine = (await arbre(PROGRAMME_DOUBLE, COACH_ATHLETE)).macros[0].blocks[0].weeks[0];
  const ligne = semaine.sessions![0].exercises[0];
  expect(await patchBrut(COACH_ATHLETE, `/weeks/${semaine.id}`, { name: 'Deload' }, PROGRAMME_DOUBLE))
    .toBe(200);
  expect(await patchBrut(COACH_ATHLETE, `/exercises/${String(ligne.id)}`, { weight: '80' }, PROGRAMME_DOUBLE))
    .toBe(200);
  // …sans que le réalisé saisi une minute plus tôt n'ait bougé.
  const relue = (await arbre(PROGRAMME_DOUBLE, COACH_ATHLETE)).macros[0].blocks[0].weeks[0];
  expect(relue.sessions![0].exercises[0]).toMatchObject({ repsDone: '4', weight: '80' });
});
