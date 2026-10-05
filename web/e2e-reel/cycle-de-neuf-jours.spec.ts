import { expect, test } from '@playwright/test';
import { arbre, colonne, modeCoach, nettoyer, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** UN CYCLE QUI NE FAIT PAS SEPT JOURS — jusqu'à Postgres (20/09).
 *
 *  ⚠️ CE QUE LE DEV-MOCK NE PEUT PAS PROUVER, et c'est tout l'objet du ticket :
 *  qu'un cycle de NEUF jours s'écrive vraiment, et que la fin de S1 suive. Le
 *  mock n'enregistre rien ; seule la colonne `day_split` dit la vérité, et seule
 *  `colonne()` la lit (l'API rabote déjà les défauts, cf. `aides.ts`).
 *
 *  Le cas est celui qui a motivé le ticket : « certains athlètes ont des
 *  semaines de 9 jours » — `routers/guichet.py` le dit depuis toujours, et la
 *  grille bornée aux sept jours de la semaine ne pouvait pas les porter. */

test.afterEach(nettoyer);

const SQUAT = { name: 'SQUAT', tier: 1, variant: [], sets: '5', reps: '5', repsUnit: 'count', weight: '100' };

/** LE SEUL BLOC DU PROGRAMME DE TEST — par son programme, pas par un id.
 *  `arbre()` rend l'identifiant de l'API, qui n'est pas la clé SQL du bloc ;
 *  le décor n'en pose qu'un, et c'est lui qu'on lit. */
const DU_BLOC = `FROM training_blocks b
  JOIN training_macros m ON m.id = b.macro_id
 WHERE m.program_id = 'e2e-program'`;

/** Le `day_split` tel qu'il est RANGÉ, et la fin de S1 — lus en base. */
const grilleEnBase = (): { jours: string[]; fin: string } => {
  const jours = colonne(
    `SELECT string_agg(j->>'day', ',' ORDER BY (regexp_replace(j->>'day', '\\D', '', 'g'))::int)
       FROM (SELECT b.day_split ${DU_BLOC}) x, jsonb_array_elements(x.day_split) j`);
  const fin = colonne(`SELECT s1_end_date ${DU_BLOC}`);
  return { jours: jours ? jours.split(',') : [], fin };
};

test('passer à neuf jours écrit J8 et J9, et pousse la fin de S1 d’autant', async ({ page }) => {
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    daySplit: [1, 2, 3, 4, 5, 6, 7].map(n => ({ day: `J${n}`, tiers: n === 1 ? { SQUAT: 1 } : {} })),
    selectedPrincipaux: ['SQUAT'],
    principles: [SQUAT],
    accessories: [],
    s1StartDate: '2026-09-07',
    s1EndDate: '2026-09-13',   // sept jours
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await expect(page.getByRole('heading', { name: /Répartition du cycle/ })).toBeVisible();

  await page.getByRole('button', { name: 'Ajouter un jour' }).click();
  await page.getByRole('button', { name: 'Ajouter un jour' }).click();
  await expect(page.getByRole('cell', { name: /^J9\s*repos$/ })).toBeVisible();

  // Un tier sur le NEUVIÈME jour — celui qui n'existait pas avant ce ticket.
  await page.getByRole('button', { name: /^J9, SQUAT\s*:/ }).click();

  await expect.poll(grilleEnBase, { timeout: 10_000 }).toEqual({
    jours: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8', 'J9'],
    // ⚠️ LA DURÉE DU CYCLE DÉPLACE LA FIN DE S1 (décision William, 19/09) : deux
    // jours ajoutés, deux jours de plus. Sans ça, le cycle ferait neuf jours et
    // la semaine sept — et J8 comme J9 tomberaient hors de leur propre semaine.
    fin: '2026-09-15',
  });
  expect(colonne(`SELECT day_split->8->'tiers'->>'SQUAT' ${DU_BLOC}`)).toBe('1');
});

test('la génération nomme les séances par jour de cycle', async ({ page }) => {
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    // ⚠️ J9 ET J2 SEULEMENT, ET DANS LE DÉSORDRE : les séances doivent sortir
    // J2 puis J9. Un tri de chaînes les rangerait à l'envers dès qu'un cycle
    // dépasse neuf jours, et personne ne le verrait avant d'en configurer un.
    daySplit: [{ day: 'J9', tiers: { SQUAT: 1 } }, { day: 'J2', tiers: { SQUAT: 1 } }],
    selectedPrincipaux: ['SQUAT'],
    principles: [SQUAT],
    accessories: [],
    s1StartDate: '2026-09-07',
    s1EndDate: '2026-09-15',
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await page.getByRole('button', { name: 'Générer la semaine 1' }).click();

  await expect.poll(async () => {
    const s = (await arbre()).macros[0]?.blocks[0]?.weeks[0]?.sessions ?? [];
    return s.map(x => x.name);
  }, { timeout: 10_000 }).toEqual(['J2', 'J9']);
});


test('une grille en jours de SEMAINE s’affiche et se migre, au lieu de se vider', async ({ page }) => {
  /** ⚠️ L'INCIDENT DU 20/09, ET CE QUI LE REND IMPOSSIBLE. Le front qui parle en
   *  jours de cycle a été ouvert sur une base pas encore migrée : il n'a
   *  reconnu aucun jour, a affiché sept lignes VIDES, et le premier geste du
   *  coach les a enregistrées — une répartition perdue, reconstituée depuis les
   *  semaines déjà engendrées.
   *
   *  La faute n'était pas la migration manquante : c'est qu'une valeur non
   *  reconnue était JETÉE au lieu d'être gardée. Ici, la trame est posée en
   *  « Lundi » / « Jeudi » (ce que le serveur accepte : `day` est un texte
   *  libre), et l'éditeur doit MONTRER les tiers, pas une grille vide. */
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    daySplit: [{ day: 'Lundi', tiers: { SQUAT: 1 } }, { day: 'Jeudi', tiers: { SQUAT: 2 } }],
    selectedPrincipaux: ['SQUAT'],
    principles: [SQUAT],
    accessories: [],
    s1StartDate: '2026-09-07',
    s1EndDate: '2026-09-13',
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  // Lundi est le premier jour de la semaine, jeudi le quatrième.
  await expect(page.getByRole('button', { name: /^J1, SQUAT\s*:/ })).toHaveText('1');
  await expect(page.getByRole('button', { name: /^J4, SQUAT\s*:/ })).toHaveText('2');

  // ⚠️ ET LA TRAME SE MIGRE D'ELLE-MÊME au premier enregistrement : on touche
  // une autre case, et la base ne porte plus un seul jour de semaine.
  await page.getByRole('button', { name: /^J2, SQUAT\s*:/ }).click();
  await expect.poll(() => colonne(
    `SELECT string_agg(j->>'day', ',' ORDER BY j->>'day')
       FROM (SELECT b.day_split ${DU_BLOC}) x, jsonb_array_elements(x.day_split) j`), { timeout: 10_000 })
    .toMatch(/^J[0-9,J]*$/);
});


test('retirer un jour CONFIGURÉ : la confirmation, puis J9 disparaît partout', async ({ page }) => {
  /** Le pendant de l'ajout : le scénario du dessus prouve que J8 et J9
   *  naissent, celui-ci qu'un jour PORTEUR s'en va vraiment — à l'écran, en
   *  base, et dans ce que la génération produit ensuite. */
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    // Neuf jours, deux porteurs : J1 restera, J9 est celui qu'on retire.
    daySplit: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({
      day: `J${n}`, tiers: n === 1 || n === 9 ? { SQUAT: 1 } : {},
    })),
    selectedPrincipaux: ['SQUAT'],
    principles: [SQUAT],
    accessories: [],
    s1StartDate: '2026-09-07',
    s1EndDate: '2026-09-15',   // neuf jours
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await expect(page.getByRole('cell', { name: /^J9$/ })).toBeVisible();

  // ⚠️ LA CONFIRMATION EST DUE : J9 porte un tier, et le retrait l'emporte avec
  // lui. Un jour vide, lui, part sans question (spec du dev-mock).
  await page.getByRole('button', { name: 'Retirer un jour' }).click();
  await expect(page.getByText(/Retirer J9 du cycle/)).toBeVisible();
  await page.getByRole('button', { name: 'Retirer', exact: true }).click();

  // À l'écran : plus de J9, et le cycle en compte huit.
  await expect(page.getByRole('cell', { name: /^J9/ })).toHaveCount(0);
  await expect(page.getByText(/^8 jours$/)).toBeVisible();

  // ⚠️ ET EN BASE, parce que l'écran ment sur ce point précis : la grille vit
  // dans un brouillon local, et c'est l'écriture différée qui compte. Un retrait
  // affiché mais jamais enregistré reviendrait au prochain chargement.
  await expect.poll(grilleEnBase, { timeout: 10_000 }).toEqual({
    jours: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8'],
    // ⚠️ La fin de S1 recule d'un jour : la durée du cycle la déplace, dans les
    // deux sens (décision du 19/09).
    fin: '2026-09-14',
  });
  // Le tier de J9 est parti avec lui, pas seulement sa ligne.
  expect(colonne(`SELECT day_split::text ${DU_BLOC}`)).not.toContain('J9');

  // ⚠️ ET LA GÉNÉRATION LE CONFIRME : c'est elle qui lit la grille pour de vrai.
  // Une grille nettoyée à l'écran mais pas en base produirait encore une séance
  // « J9 » — le défaut serait alors visible par l'athlète, pas par le coach.
  await page.getByRole('button', { name: 'Générer la semaine 1' }).click();
  await expect.poll(async () => {
    const s = (await arbre()).macros[0]?.blocks[0]?.weeks[0]?.sessions ?? [];
    return s.map(x => x.name);
  }, { timeout: 10_000 }).toEqual(['J1']);
});
