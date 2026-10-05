import { expect, test } from '@playwright/test';
import { S1_DATEE, arbre, modeCoach, nettoyer, poserDuRealise, poserUnMacro, seConnecter } from './aides';

/** CE QU'UNE SEMAINE NEUVE HÉRITE DE LA PRÉCÉDENTE — et ce qu'elle n'hérite pas.
 *
 *  Écrit sur un doute de William (« la charge réelle se reporte d'une semaine à
 *  l'autre »). Elle ne se reporte pas : ces deux specs le prouvent de bout en
 *  bout, et le figent.
 *
 *  On lit le SERVEUR et non l'écran : « c'est affiché » et « c'est écrit » sont
 *  deux choses différentes, et seule la seconde décide de ce qui compte dans le
 *  tonnage, les records et le Tracking.
 */
test.afterEach(nettoyer);

test('la semaine neuve ne porte aucun réalisé', async ({ page }) => {
  await poserUnMacro([{
    name: 'SQUAT', sets: '5', reps: '3',
    weight: '100', weightLocked: 'true',
  }], { datesDeS1: S1_DATEE });
  // ⚠️ LE RÉALISÉ SE POSE APRÈS, par `PATCH` — la création ne l'accepte plus
  // (FRE-75). C'est aussi ce que fait un athlète : il remplit une ligne qui
  // existe, il n'en crée pas une déjà faite.
  await poserDuRealise({
    SQUAT: { weightDone: '105', repsDone: '4', feltRPE: '8', athleteFeedback: 'lourd' },
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await expect.poll(async () => (await arbre()).macros[0].blocks[0].weeks.length,
                    { timeout: 10_000 }).toBe(2);

  const [s1, s2] = (await arbre()).macros[0].blocks[0].weeks;
  const l1 = s1.sessions![0].exercises[0];
  const l2 = s2.sessions![0].exercises[0];

  // La semaine passée garde son réalisé : c'est de l'histoire, et l'écraser est
  // le défaut qui coûtait le plus cher (cf. semaine-suivante.spec.ts).
  expect(l1.weightDone).toBe('105');

  // La neuve n'a été faite par personne. Laisser le réalisé la ferait compter
  // dans le tonnage et les records avant même d'être effectuée.
  expect(l2.weightDone ?? '').toBe('');
  expect(l2.repsDone ?? '').toBe('');
  expect(l2.feltRPE ?? '').toBe('');
  expect(l2.athleteFeedback ?? '').toBe('');

  // La PRESCRIPTION, elle, se reporte — la charge est verrouillée, c'est
  // précisément ce que le verrou veut dire.
  expect(l2.weight).toBe('100');
});

test('la prescription se reporte selon le verrou et l’incrément', async ({ page }) => {
  await poserUnMacro([
    // ni verrou ni incrément : rien ne fait progresser cette charge, on l'efface
    // plutôt que de la reconduire en silence.
    { name: 'SQUAT', sets: '5', reps: '3', weight: '100' },
    // ⚠️ LA PROGRESSION PART DU RÉALISÉ (25), PLUS DU PRESCRIT (20) — décision de
    // William, 09/09 (FRE-161). Cette spec affirmait l'inverse, avec son
    // argument : « sinon une bonne semaine décalerait toute la suite du bloc ».
    // C'est vrai, et c'est désormais l'effet VOULU : la programmation suit
    // l'athlète, dans les deux sens. Mesuré avant de trancher — sur 454 lignes
    // portant prescrit et réel, 159 ont été tenues plus lourd et 24 plus léger.
    { name: 'DIPS', sets: '4', reps: '6', weight: '20',
      increment: '2.5', incrementUnit: 'kg' },
  ], { datesDeS1: S1_DATEE });
  await poserDuRealise({ SQUAT: { weightDone: '105' }, DIPS: { weightDone: '25' } });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await expect.poll(async () => (await arbre()).macros[0].blocks[0].weeks.length,
                    { timeout: 10_000 }).toBe(2);

  // ⚠️ UNE CHARGE EFFACÉE EST UNE ABSENCE, ET PLUS UNE CHAÎNE VIDE (FRE-137).
  // Cette spec attendait `''` sur le SQUAT — l'ancien encodage, que le serveur
  // fabriquait à la lecture. Elle a rougi au bon moment : c'est le seul test qui
  // traverse la génération ET la relecture par le vrai contrat.
  const lignes = (await arbre()).macros[0].blocks[0].weeks[1].sessions![0].exercises;
  expect(lignes.map(l => [l.name, l.weight, l.weightDone])).toEqual([
    ['SQUAT', null, null],
    ['DIPS', '27.5', null],   // 25 tenus + 2,5, et non 20 prescrits + 2,5
  ]);
});
