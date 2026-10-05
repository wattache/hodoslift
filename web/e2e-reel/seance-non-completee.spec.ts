import { expect, test } from '@playwright/test';
import { ATHLETE, BROKKR, COACH, PROGRAMME, arbre, colonne, jeton, modeCoach, nettoyer, patchBrut, poserUnMacro, seConnecter } from './aides';

/** OÙ L'APP S'OUVRE, ET JUSQU'OÙ VA UNE SEMAINE — 20/09.
 *
 *  Deux règles demandées le même jour par William, et qui se tiennent : on ne
 *  peut pas présupposer QUAND l'athlète fera sa séance, donc l'app s'ouvre sur
 *  la première NON COMPLÉTÉE ; et le coach peut étirer une semaine
 *  exceptionnelle sans changer la durée de référence du bloc.
 *
 *  ⚠️ LE HARNAIS RÉEL EST LE SEUL À POUVOIR LES VOIR. La première demande du
 *  RÉALISÉ (un `feltRPE` posé par un PATCH) ; la seconde, une écriture qui
 *  arrive vraiment dans `training_weeks`. Le dev-mock ne persiste ni l'un ni
 *  l'autre. */

test.afterEach(nettoyer);

const LIGNE = (nom: string) => ({ name: nom, sets: '3', reps: '5', weight: '80' });

/** Les dates des semaines du bloc de test, dans l'ordre — la vérité SQL. */
const semainesEnBase = (): string[] => {
  const lignes = colonne(
    `SELECT string_agg(w.start_date || '→' || w.end_date, ' ' ORDER BY w.number)
       FROM training_weeks w
       JOIN training_blocks b ON b.id = w.block_id
       JOIN training_macros m ON m.id = b.macro_id
      WHERE m.program_id = 'e2e-program'`);
  return lignes ? lignes.split(' ') : [];
};

test("l'app ouvre la première séance NON complétée, pas la première", async ({ page }) => {
  await poserUnMacro([], {
    sessions: [
      { name: 'J1', exercises: [LIGNE('SQUAT')] },
      { name: 'J2', exercises: [LIGNE('MUSCLE UP')] },
    ],
  });

  // J1 est entièrement faite : son unique ligne porte un ressenti.
  const s1 = (await arbre()).macros[0].blocks[0].weeks[0].sessions![0];
  expect(await patchBrut(COACH, `/exercises/${String(s1.exercises[0].id)}`, { feltRPE: '8' })).toBe(200);

  await seConnecter(page, ATHLETE);
  await page.goto('/training');

  // ⚠️ C'EST J2 QUI S'OUVRE. Avant le 20/09, le défaut cherchait une séance
  // datée d'aujourd'hui — que la génération ne pose jamais — et retombait sur
  // la première, c'est-à-dire sur du déjà fait : 181 fois sur 199 dans la
  // semaine en cours de production.
  await expect(page.getByText('MUSCLE UP').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('SQUAT')).toHaveCount(0);
});

test('le coach étire une semaine, et la BASE ne bouge pas', async ({ page }) => {
  /** ⚠️ LE DÉCOR EST POSÉ EN SQL, ET LE GESTE PAR L'INTERFACE. Les semaines
   *  naissent SANS dates (`poserUnMacro` : « 1:∅→∅ ») — elles n'en reçoivent
   *  qu'à la cascade de la BASE, qui est un autre geste, déjà gardé par
   *  `dater-la-base-rattrape-le-bloc`. Ce qu'on éprouve ici, c'est l'exception
   *  d'UNE semaine ; on part donc d'un bloc déjà daté, comme il l'est en vrai. */
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);
  const bloc = (await arbre()).macros[0].blocks[0];
  const r = await fetch(`${BROKKR}/programs/${PROGRAMME}/blocks/${bloc.id}/weeks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await jeton()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessions: [{ name: 'J1', exercises: [LIGNE('SQUAT')] }] }),
  });
  expect(r.ok, await r.text()).toBe(true);

  // Cinq jours chacune, enchaînées — et la BASE qui porte la durée de référence.
  const debut = new Date(); debut.setDate(debut.getDate() + 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  // ⚠️ BORNÉ AU BLOC DE TEST, TOUJOURS. Le bac à sable est une COPIE DE LA
  // PRODUCTION : un `WHERE number = 1` sans son bloc rédate la semaine 1 de
  // chacun des 194 blocs qui s'y trouvent. Fait une fois, le 20/09.
  const DU_BLOC = `(SELECT b.id FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id
                     WHERE m.program_id = '${PROGRAMME}' LIMIT 1)`;
  colonne(`UPDATE training_blocks SET s1_start_date = '${iso(debut)}', s1_end_date = '${iso(plus(debut, 4))}'
            WHERE id = ${DU_BLOC}`);
  colonne(`UPDATE training_weeks SET start_date = '${iso(debut)}', end_date = '${iso(plus(debut, 4))}'
            WHERE number = 1 AND block_id = ${DU_BLOC}`);
  colonne(`UPDATE training_weeks SET start_date = '${iso(plus(debut, 5))}', end_date = '${iso(plus(debut, 9))}'
            WHERE number = 2 AND block_id = ${DU_BLOC}`);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: 'Semaine 2', exact: true }).click();

  // La S2 a besoin de trois jours de plus — un déplacement professionnel.
  const nomDuJour = (d: Date) =>
    new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  await page.getByRole('button', { name: /Fin de la semaine/ }).click();
  await page.getByRole('button', { name: new RegExp(`^(Aujourd'hui, )?${nomDuJour(plus(debut, 12))}$`) }).click();

  await expect.poll(semainesEnBase, { timeout: 10_000 }).toEqual([
    `${iso(debut)}→${iso(plus(debut, 4))}`,
    `${iso(plus(debut, 5))}→${iso(plus(debut, 12))}`,
  ]);

  // ⚠️ LA BASE NE BOUGE PAS : la durée de référence reste celle du cycle, et
  // c'est elle qui datera les semaines suivantes. L'étirement est l'exception
  // d'UNE semaine, pas une nouvelle règle pour le bloc.
  expect(colonne(
    `SELECT s1_end_date FROM training_blocks b JOIN training_macros m ON m.id = b.macro_id
      WHERE m.program_id = 'e2e-program'`)).toBe(iso(plus(debut, 4)));
});
