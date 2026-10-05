import { expect, test } from '@playwright/test';
import { BROKKR, PROGRAMME, arbre, colonne, jeton, modeCoach, nettoyer, poserDuRealise, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** POSER LES DATES DE S1 DANS LA BASE RATTRAPE UN BLOC DÉJÀ ENTRAÎNÉ (FRE-138).
 *
 *  Le 15/09, « + Semaine » s'est fermé sur 34 derniers blocs de production dont
 *  la BASE n'a pas de dates ; le message aux coachs dit « pose le début et la fin
 *  de S1, tout le bloc se date ». Cette spec tient la promesse faite À EUX, sur
 *  l'état réel de ces blocs — des semaines NUES qui portent déjà du réalisé :
 *
 *    1. toutes les semaines du bloc reçoivent leurs dates, à la suite ;
 *    2. RIEN D'AUTRE ne bouge : le réalisé, les séances, les lignes, la trame ;
 *    3. « + Semaine » se rouvre, et la semaine ajoutée est datée à son tour.
 *
 *  ⚠️ PAR L'ÉCRAN, PAS PAR L'API. Le redatage est calculé au FRONT
 *  (`blockWeekDates`) et part dans le même `PUT /base` que la trame : un test
 *  serveur qui poste lui-même `weekDates` passerait à côté du calcul — et du
 *  déclencheur, qui ne part que si les dates de S1 ont CHANGÉ.
 *
 *  MUTATION QUI ROUGIT : `updateBlockBase` qui n'envoie plus `weekDates`
 *  (`const dates = null`) → la trame se date, les semaines restent nues. */
test.afterEach(nettoyer);

test('dater S1 dans la BASE date tout le bloc, sans toucher au réalisé, et rouvre « + Semaine »', async ({ page }) => {
  // L'état des blocs de production : une trame sans dates, trois semaines nues,
  // et du réalisé en S1.
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3', weight: '100' }]);
  const bloc = (await arbre()).macros[0].blocks[0];
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${BROKKR}/programs/${PROGRAMME}/blocks/${bloc.id}/weeks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await jeton()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions: [{ name: 'Lundi', exercises: [{ name: 'SQUAT', sets: '5', reps: '3' }] }] }),
    });
    if (!r.ok) throw new Error(`POST /weeks → ${r.status} ${await r.text()}`);
  }
  await poserDuRealise({ SQUAT: { weightDone: '102.5', feltRPE: '8' } });
  await poserUneBase(bloc.id, {
    daySplit: [{ day: 'J1', tiers: { SQUAT: 1 } }], selectedPrincipaux: ['SQUAT'],
    principles: [{ name: 'SQUAT', tier: 1, variant: [], sets: '5', reps: '3', repsUnit: 'count', weight: '100' }],
    accessories: [],
  });

  const dansLeBloc = `FROM training_weeks w WHERE w.block_id = '${bloc.id}'`;
  const semainesEnBase = () => colonne(
    `SELECT w.number || ':' || coalesce(w.start_date::text, '∅') || '→' || coalesce(w.end_date::text, '∅') ${dansLeBloc} ORDER BY w.number`,
  ).split('\n').filter(Boolean);
  // Tout ce qui ne doit PAS bouger, en une empreinte : réalisé, lignes, séances, trame.
  const leReste = () => colonne(`
    SELECT (SELECT string_agg(coalesce(e.weight_done,'∅') || '/' || coalesce(e.felt_rpe,'∅') || '/' || coalesce(e.weight,'∅'), ',' ORDER BY w.number, e.position)
              FROM training_exercises e JOIN training_sessions s ON s.id = e.session_id JOIN training_weeks w ON w.id = s.week_id
              WHERE w.block_id = '${bloc.id}')
      || ' | ' || (SELECT count(*) FROM training_sessions s JOIN training_weeks w ON w.id = s.week_id WHERE w.block_id = '${bloc.id}')
      || ' | ' || (SELECT string_agg(name || '/' || sets || '/' || coalesce(weight,'∅'), ',') FROM training_base_principles WHERE block_id = '${bloc.id}')`);

  expect(semainesEnBase()).toEqual(['1:∅→∅', '2:∅→∅', '3:∅→∅']);
  const avant = leReste();

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  // Le décor est bien celui des 34 blocs : « + Semaine » fermé.
  await expect(page.getByRole('button', { name: 'Semaine', exact: true })).toBeDisabled({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Aller à la BASE' }).click();

  /* ---- Le geste du coach : le début, puis la fin de S1, au calendrier ---- */
  const nomDuJour = (d: Date) =>
    new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  const jour = (d: Date) => page.getByRole('button', { name: new RegExp(`^(Aujourd'hui, )?${nomDuJour(d)}$`) });
  const aujourdHui = new Date();
  const choisir = async (champ: RegExp, d: Date) => {
    await page.getByRole('button', { name: champ }).click();
    const mois = (d.getFullYear() - aujourdHui.getFullYear()) * 12 + d.getMonth() - aujourdHui.getMonth();
    for (let k = 0; k < mois; k++) await page.getByRole('button', { name: 'Aller au mois suivant' }).click();
    await jour(d).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  const debut = new Date(aujourdHui.getFullYear(), aujourdHui.getMonth(), aujourdHui.getDate(), 12);
  const fin = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + 6, 12);
  await choisir(/Début S1|W1 start/, debut);
  await choisir(/^Fin$|^End$/, fin);

  const iso = (d: Date, plus = 0) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + plus, 12);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };

  // 1. Tout le bloc est daté, à la suite, sept jours chacune (la durée de S1).
  await expect.poll(semainesEnBase, { timeout: 10_000, message: 'les semaines du bloc ne se sont pas datées' })
    .toEqual([
      `1:${iso(debut)}→${iso(debut, 6)}`,
      `2:${iso(debut, 7)}→${iso(debut, 13)}`,
      `3:${iso(debut, 14)}→${iso(debut, 20)}`,
    ]);
  // 2. Et rien d'autre n'a bougé.
  expect(leReste()).toBe(avant);

  // 3. « + Semaine » se rouvre, et la semaine ajoutée suit.
  await page.getByRole('button', { name: /Voir la semaine/ }).click();
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await expect.poll(semainesEnBase, { timeout: 10_000 })
    .toContain(`4:${iso(debut, 21)}→${iso(debut, 27)}`);
});
