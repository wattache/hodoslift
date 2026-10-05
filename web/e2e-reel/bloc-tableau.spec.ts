import { expect, test, type Page } from '@playwright/test';
import { BROKKR, COACH, PROGRAMME, jeton, nettoyer, seConnecter } from './aides';

/** Depuis l'accueil jusqu'au tracker de l'athlète.
 *
 *  ⚠️ L'ATHLÈTE D'ABORD (le guichet, 12/09). Le coach n'atterrit plus dans
 *  l'espace d'un athlète mais sur SA file, où l'onglet « Tracker » n'existe pas :
 *  il choisit l'athlète dans le sélecteur de l'en-tête (Passe 3, constat 07 —
 *  la liste latérale a disparu le 14/09), et l'espace s'ouvre avec ses onglets.
 *  C'est le geste réel depuis l'accueil — et le clic attend que l'app soit là, ce
 *  qu'un `goto` ne ferait pas (voir plus bas). */
const ouvrirLeTracker = async (page: Page) => {
  await page.getByRole('button', { name: /Changer d'athlète|Switch athlete/ }).click();
  await page.getByRole('option', { name: /Athlète E2E/i }).click();
  await page.getByRole('link', { name: /^Tracker$/ }).click();
  // Un sous-onglet du Tracker depuis le 17/09 : « Charge & RPE » s'ouvre d'office.
  await page.getByRole('tab', { name: /Bloc en tableau|Block table/ }).click();
};

/** LE BLOC EN TABLEAU, CONTRE LA VRAIE PILE — FRE-114.
 *
 *  ⚠️ POURQUOI ICI ET PAS EN VITEST. La dérivation a ses propres specs
 *  (`lib/bloc-tableau.test.ts`), sur des objets fabriqués à la main. Ce qu'elles
 *  ne peuvent pas dire, c'est que l'arbre RENDU PAR BROKKR a la forme que la
 *  dérivation attend — que `sessions[].name` porte bien le jour, que `variant`
 *  est un tableau, que les semaines arrivent dans l'ordre. Trois hypothèses sur
 *  le contrat, et c'est exactement le genre que le harnais mock ne voit pas.
 *
 *  ⚠️ LE DÉCOR EST UNE PROGRESSION AVEC UN TROU, à dessein. C'est le cas de
 *  FRE-150 : une charge qui monte, puis un mouvement qui disparaît. Sur l'écran
 *  d'une semaine il aura fallu trois semaines pour s'en apercevoir ; ici la case
 *  vide doit se voir du premier coup d'œil, et c'est ce que la spec exige. */

test.afterEach(nettoyer);

async function poserUneSemaine(blockId: string, sessions: Record<string, unknown>[]) {
  const r = await fetch(`${BROKKR}/programs/${PROGRAMME}/blocks/${blockId}/weeks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await jeton(COACH)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessions }),
  });
  if (!r.ok) throw new Error(`POST /weeks → ${r.status} ${await r.text()}`);
}

/** ⚠️ LE VOLUME CHANGE D'UNE SEMAINE À L'AUTRE, ET C'EST INDISPENSABLE. La
 *  première version donnait `5 × 3` partout : la clé de rangée avec `sets`/`reps`
 *  — le défaut que cette spec prétend garder — produisait alors exactement la
 *  même clé, et la mutation restait VERTE. Un décor qui ne peut pas distinguer
 *  le correctif de la faute ne prouve rien. */
const squat = (charge: string, sets: string, reps: string) => ({
  name: 'SQUAT', variant: ['HIGH BAR'], sets, reps, weight: charge,
});
/** ⚠️ LESTÉ, ET C'EST LE POINT. Sans charge il serait écarté du tonnage FAUTE DE
 *  POIDS, et la garde qu'on éprouve — les secondes ne sont pas des répétitions —
 *  ne serait jamais atteinte : la mutation qui la retire restait verte. Avec
 *  20 kg, le compter donnerait 3 × 30 × 20 = 1 800 kg, soit plus que le squat. */
const gainage = { name: 'PLANK', sets: '3', reps: '30', repsUnit: 'sec', weight: '20' };

/** Sans charge NI RPE : les 652 lignes de production qui n'ont ni l'un ni
 *  l'autre. La cellule doit rendre le volume et RIEN d'autre — pas un « PDC »
 *  inventé, que la donnée ne dit nulle part. */
// ⚠️ UN NOM DE LA BIBLIOTHÈQUE, pas un nom inventé : `POST /macros` refuse en
// 422 `mouvement_inconnu` (FRE-122, la clé étrangère qui tient le vocabulaire).
const sansCharge = { name: 'DIPS', sets: '2', reps: '8' };

test('le bloc se lit en colonnes, et le trou d’une semaine se voit', async ({ page }) => {
  // S1 et S2 portent le squat qui progresse ; S3 ne le porte plus.
  await fetch(`${BROKKR}/programs/${PROGRAMME}/macros`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await jeton(COACH)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ block: { week: { sessions: [
      { name: 'Lundi', exercises: [squat('100', '5', '3'), gainage, sansCharge] },
      // ⚠️ UN SECOND JOUR, ET IL DOIT RESTER HORS DU TABLEAU du lundi. Sans lui,
      // la spec ne pourrait pas distinguer « filtré » de « il n'y en avait qu'un ».
      { name: 'Mardi', exercises: [{ name: 'BENCH PRESS', sets: '4', reps: '6', weight: '60' }] },
    ] } } }),
  }).then(async r => { if (!r.ok) throw new Error(`POST /macros → ${r.status} ${await r.text()}`); });

  const arbreLu = await (await fetch(`${BROKKR}/programs/${PROGRAMME}/training`, {
    headers: { Authorization: `Bearer ${await jeton(COACH)}` },
  })).json();
  const blockId = arbreLu.macros[0].blocks[0].id;

  await poserUneSemaine(blockId, [{ name: 'Lundi', exercises: [squat('105', '6', '2'), gainage] }]);
  await poserUneSemaine(blockId, [{ name: 'Lundi', exercises: [gainage] }]);

  await seConnecter(page);
  // ⚠️ LE TRACKER, ET PLUS UN ONGLET À LUI. Cette spec a visé successivement une
  // bascule sur « Entraînement » puis un onglet « Programme » ; les deux ont
  // disparu parce que le CHOIX du bloc se faisait ailleurs que son affichage. Il
  // se fait maintenant sur l'écran qui l'affiche.
  // ⚠️ PAR LE LIEN, PAS PAR `goto`, et c'est une course que j'ai vue perdre. La
  // connexion redirige vers le tableau de bord ; un `goto` parti avant la fin de
  // cette redirection se fait écraser, et la spec cherche ensuite sa rangée sur
  // le mauvais écran — j'ai lu la Table RM dans le contexte d'échec. Le clic
  // attend que l'app soit là, et c'est en plus le geste réel.
  await ouvrirLeTracker(page);
  await expect(page.getByRole('heading', { name: /Le bloc en tableau|The block as a table/ })).toBeVisible();

  // ⚠️ LA RANGÉE EST UNE `<tr>` REPÉRÉE PAR SON EN-TÊTE DE LIGNE, pas un `div`
  // filtré par texte : « SQUAT » apparaît aussi dans le nom de la variante.
  const rangeeSquat = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /SQUAT/ }) });
  await expect(rangeeSquat).toBeVisible();

  const cellules = rangeeSquat.getByRole('cell');
  await expect(cellules).toHaveCount(3);
  await expect(cellules.nth(0)).toContainText('100 kg');
  await expect(cellules.nth(1)).toContainText('105 kg');
  // ⚠️ LE TROU, ET C'EST LE CŒUR DE L'ÉCRAN. La troisième semaine ne prescrit
  // plus le squat : la case doit être VIDE de charge, pas absente du tableau.
  await expect(cellules.nth(2)).not.toContainText('kg');
  await expect(cellules.nth(2)).toContainText('—');

  // ⚠️ NI CHARGE NI RPE : la cellule rend le volume, et RIEN d'autre.
  const rangeeSansCharge = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /DIPS/ }) });
  await expect(rangeeSansCharge.getByRole('cell').nth(0)).toHaveText('2 × 8');

  // Le mardi n'est pas dans le tableau du lundi.
  await expect(page.getByRole('rowheader', { name: /BENCH PRESS/ })).toHaveCount(0);

  // ⚠️ ET LE TONNAGE DIT CE QU'IL NE COMPTE PAS. 5 × 3 × 100 = 1 500 kg pour le
  // squat ; le gainage est en SECONDES et ne se multiplie pas — 3 × 30 s × 0 kg
  // n'est pas un tonnage, c'est une invention. La colonne doit donc annoncer une
  // ligne hors compte plutôt que de laisser croire à un total complet.
  const tonnage = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Tonnage/i }) });
  // 5 × 3 × 100 = 1 500 kg pour le squat, et RIEN d'autre. Compter le gainage
  // ajouterait 3 × 30 s × 20 kg = 1 800 kg — plus que le squat lui-même, et
  // entièrement inventé : le total afficherait 3.3 t.
  // ⚠️ LE SÉPARATEUR SUIT LA LANGUE AFFICHÉE, et l'app tourne ici en français :
  // « 1,5 t ». La spec attendait « 1.5 t » — elle n'avait jamais été vue passer,
  // puisqu'elle mourait avant, sur un bouton retiré.
  await expect(tonnage.getByRole('cell').nth(0)).toContainText(/1[.,]5 t/);
  await expect(tonnage.getByRole('cell').nth(0)).not.toContainText(/3[.,]3 t/);
  // Deux lignes hors compte : le gainage (secondes) et les DIPS (sans charge).
  await expect(tonnage.getByRole('cell').nth(0)).toContainText(/2 lignes hors compte|2 lines not counted/);
});

test('changer de jour change le tableau', async ({ page }) => {
  await fetch(`${BROKKR}/programs/${PROGRAMME}/macros`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await jeton(COACH)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ block: { week: { sessions: [
      { name: 'Lundi', exercises: [squat('100', '5', '3')] },
      { name: 'Mardi', exercises: [{ name: 'BENCH PRESS', sets: '4', reps: '6', weight: '60' }] },
    ] } } }),
  }).then(async r => { if (!r.ok) throw new Error(`POST /macros → ${r.status} ${await r.text()}`); });

  await seConnecter(page);
  // ⚠️ LE TRACKER, ET PLUS UN ONGLET À LUI. Cette spec a visé successivement une
  // bascule sur « Entraînement » puis un onglet « Programme » ; les deux ont
  // disparu parce que le CHOIX du bloc se faisait ailleurs que son affichage. Il
  // se fait maintenant sur l'écran qui l'affiche.
  // ⚠️ PAR LE LIEN, PAS PAR `goto`, et c'est une course que j'ai vue perdre. La
  // connexion redirige vers le tableau de bord ; un `goto` parti avant la fin de
  // cette redirection se fait écraser, et la spec cherche ensuite sa rangée sur
  // le mauvais écran — j'ai lu la Table RM dans le contexte d'échec. Le clic
  // attend que l'app soit là, et c'est en plus le geste réel.
  await ouvrirLeTracker(page);
  await expect(page.getByRole('heading', { name: /Le bloc en tableau|The block as a table/ })).toBeVisible();

  await expect(page.getByRole('rowheader', { name: /SQUAT/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Mardi' }).click();
  await expect(page.getByRole('rowheader', { name: /BENCH PRESS/ })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: /SQUAT/ })).toHaveCount(0);
});

/** LE COULOIR RPE — la comparaison visé / ressenti (FRE-114, piste « ligne
 *  ancrée »).
 *
 *  ⚠️ CE QUE CETTE SPEC GARDE N'EST PAS LE DESSIN, C'EST LE TEXTE. Les deux
 *  couloirs sont `aria-hidden` — décoratifs, par construction : les valeurs sont
 *  déjà écrites dans les cases. Ce qui doit exister pour un lecteur d'écran, et
 *  qui a été mis dans le couloir TROIS FOIS avant d'en sortir, c'est la cible et
 *  le verdict. Sur un axe PARTAGÉ, une cible haute passe exactement à la hauteur
 *  où le texte aurait été posé — il n'existe aucun alignement vertical qui y
 *  échappe, d'où la règle « zones disjointes ». */
test('le verdict RPE est écrit dans l’en-tête de rangée, jamais dans le couloir', async ({ page }) => {
  const squatRpe = (charge: string, vise: string) => ({
    name: 'SQUAT', variant: ['HIGH BAR'], sets: '5', reps: '3',
    weight: charge, aimedRPE: vise,
  });

  await fetch(`${BROKKR}/programs/${PROGRAMME}/macros`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await jeton(COACH)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ block: { week: { sessions: [
      { name: 'Lundi', exercises: [squatRpe('100', '8')] },
    ] } } }),
  }).then(async r => { if (!r.ok) throw new Error(`POST /macros → ${r.status} ${await r.text()}`); });

  const arbre = await (await fetch(`${BROKKR}/programs/${PROGRAMME}/training`, {
    headers: { Authorization: `Bearer ${await jeton(COACH)}` },
  })).json();
  const blockId = arbre.macros[0].blocks[0].id;

  await poserUneSemaine(blockId, [{ name: 'Lundi', exercises: [squatRpe('105', '8')] }]);
  await poserUneSemaine(blockId, [{ name: 'Lundi', exercises: [squatRpe('110', '8')] }]);

  /** ⚠️ LE RESSENTI NE SE CRÉE PAS, IL SE PATCHE — et c'est le harnais réel qui
   *  me l'a appris : ma première version passait `feltRPE` à la création, la vue
   *  répondait « RPE tenu · 3 semaines à venir », et rien dans le code de la vue
   *  n'était en cause. La création refuse le réalisé depuis FRE-75 (37 lignes de
   *  production portaient une perf que personne n'avait faite). Aucune spec
   *  vitest n'aurait pu voir ça : c'est une hypothèse sur le CONTRAT. */
  const lu = await (await fetch(`${BROKKR}/programs/${PROGRAMME}/training`, {
    headers: { Authorization: `Bearer ${await jeton(COACH)}` },
  })).json();
  const ressentis = ['8', '9', '9.5'];   // S1 tenue, S2 et S3 au-dessus de 8
  const semaines = lu.macros[0].blocks[0].weeks;
  for (let i = 0; i < semaines.length; i++) {
    const ligne = semaines[i].sessions[0].exercises[0];
    const r = await fetch(`${BROKKR}/programs/${PROGRAMME}/exercises/${ligne.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${await jeton(COACH)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ feltRPE: ressentis[i] }),
    });
    if (!r.ok) throw new Error(`PATCH feltRPE S${i + 1} → ${r.status} ${await r.text()}`);
  }

  await seConnecter(page);
  // ⚠️ PAR LE LIEN, PAS PAR `goto`, et c'est une course que j'ai vue perdre. La
  // connexion redirige vers le tableau de bord ; un `goto` parti avant la fin de
  // cette redirection se fait écraser, et la spec cherche ensuite sa rangée sur
  // le mauvais écran — j'ai lu la Table RM dans le contexte d'échec. Le clic
  // attend que l'app soit là, et c'est en plus le geste réel.
  await ouvrirLeTracker(page);
  await expect(page.getByRole('heading', { name: /Le bloc en tableau|The block as a table/ })).toBeVisible();

  const rangee = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /SQUAT/ }) });
  const entete = rangee.getByRole('rowheader');
  // ⚠️ « RPE 8 VISÉ », PAS « RPE 8 → 8 VISÉ ». Une cible constante sur tout le
  // bloc n'a pas d'intervalle : la flèche annoncerait une progression que
  // personne n'a programmée.
  await expect(entete).toContainText(/RPE 8 (visé|targeted)/);
  await expect(entete).not.toContainText('8 → 8');
  await expect(entete).toContainText(/RPE (dépassé|exceeded) ×2/);

  // L'amplitude de la piste dorée est celle des CHARGES, y compris sur une
  // rangée qui porte un RPE visé : c'est ce que la piste trace.
  await expect(entete).toContainText(/100 → 110 kg/);

  await page.screenshot({ path: 'test-results/bloc-tableau-couloir-rpe.png', fullPage: true });
});
