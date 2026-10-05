import { expect, test, type Locator, type Page } from '@playwright/test';
import { nettoyer, poserDuRealise, poserUnMacro, seConnecter } from './aides';

/** LE TABLEAU DES RECORDS, À L'ÉCRAN — le seul angle mort du 26/08.
 *
 *  ⚠️ POURQUOI CETTE SPEC EXISTE. Le calcul des records a quitté le navigateur
 *  ce jour-là (FRE-71 §9) : `computeRepPRMatrix` parcourait l'arbre entier, la
 *  grille vient désormais de `GET /athletes/{id}/records`. `test_records.py`
 *  tient la vérité du SERVEUR — 17 specs — mais rien ne regardait ce que le
 *  composant fait de cette réponse, qu'il n'avait jamais reçue de sa vie.
 *  Exactement le risque couvert pour la semaine générée, et laissé ouvert ici.
 *
 *  ⚠️ ET C'EST LA RÈGLE MÉTIER QU'ON VÉRIFIE, PAS SEULEMENT LE RENDU. Les deux
 *  lignes du décor ne diffèrent que par UNE chose : l'une porte un RPE, l'autre
 *  non. C'est la définition de « réalisé » arrêtée le 26/08 — un record est ce
 *  qui a été FAIT, et seule une sensation prouve que quelqu'un a poussé. La
 *  ligne sans RPE est d'ailleurs la PLUS LOURDE des deux : si la règle sautait,
 *  c'est elle qui trônerait dans la grille.
 */
test.afterEach(nettoyer);

/** Le tableau, désigné par son titre — il n'a pas de rôle nommé à lui. */
const tableau = (page: Page) =>
  page.locator('section').filter({ hasText: 'Records personnels' }).locator('table');

/** La cellule (reps × mouvement). L'index de colonne est un CONSTAT vérifié
 *  juste avant par `enTetes`, pas une supposition : si l'ordre des mouvements
 *  changeait, c'est l'en-tête qui rougirait — au lieu de laisser cette spec
 *  interroger une autre colonne en silence. */
const cellule = (page: Page, reps: number, colonne: number): Locator =>
  tableau(page).locator(`tbody tr:has(> td:first-child:text-is("${reps}"))`).locator('td').nth(colonne);

// ⚠️ CONSTATÉ, PAS SUPPOSÉ : les index de colonnes en dépendent, et la spec
// l'affirme avant de compter dessus.
//
// ⚠️ ET C'EST CE CONSTAT QUI A TROUVÉ LE DÉFAUT DU REPLI (12/09). Les colonnes
// sans aucun record se replient désormais — deux septièmes de la largeur pour
// dire « rien ». Mais sur CE terrain de jeu, l'athlète n'a qu'un seul record :
// SIX colonnes sur sept se repliaient, et la grille se réduisait à
// « Reps | Squat | +6 repliées ». Elle cessait d'être une grille.
// Le repli ne joue donc que lorsqu'il est MINORITAIRE. Cette spec est ce qui le
// garde : elle attend les sept mouvements sur un athlète neuf, et rougirait si
// le seuil sautait. Le bench et le deadlift l'ont rejointe
// avec la Table RM (FRE-147) — deux colonnes de plus, décision de William.
const COLONNES = ['Reps', 'Muscle-up', 'Pull-up', 'Chin-up', 'Dips', 'Squat',
                 'Bench press', 'Deadlift'];
const SQUAT = COLONNES.indexOf('Squat');
const PULL_UP = COLONNES.indexOf('Pull-up');

test('un record apparaît dans la grille, et une ligne sans RPE n’en fait pas un', async ({ page }) => {
  await poserUnMacro([
    { name: 'SQUAT', sets: '5', reps: '3', weight: '100' },
    // ⚠️ PLUS LOURDE, ET JAMAIS FAITE. Une ligne posée par le coach pour dans
    // trois semaines : c'est le défaut d'origine signalé le 18/08, où le tableau
    // affichait des records que personne n'avait soulevés.
    { name: 'PULL UP', sets: '3', reps: '3', weight: '200' },
  ]);

  // La TRACE, et elle seule : un RPE ressenti. Le réalisé prime sur le prescrit,
  // donc c'est 142.5 qu'on doit lire, pas 100.
  await poserDuRealise({ SQUAT: { weightDone: '142.5', feltRPE: '8' } });

  await seConnecter(page);
  await page.goto('/dashboard');

  // Le tableau existe — sans ça, les assertions de cellules passeraient pour de
  // mauvaises raisons (un `td` absent n'a pas de texte à ne pas contenir).
  await expect(tableau(page)).toBeVisible({ timeout: 15_000 });

  // L'ordre des colonnes, constaté avant de compter dessus.
  await expect(tableau(page).locator('thead th')).toHaveText(COLONNES);

  // ⚠️ L'ASSERTION QUI PORTE TOUT : une charge calculée par brokkr, sérialisée,
  // reçue par un composant qui ne l'avait jamais vue, et affichée dans la bonne
  // case. Rien de cette chaîne n'était vérifié.
  await expect(cellule(page, 3, SQUAT)).toContainText('142.5', { timeout: 15_000 });

  // Le détail d'exécution suit la même réponse : séries × reps et RPE.
  await expect(cellule(page, 3, SQUAT)).toContainText('5x3');
  await expect(cellule(page, 3, SQUAT)).toContainText('@ 8');

  // Et la plus lourde des deux reste absente, faute de trace.
  await expect(cellule(page, 3, PULL_UP)).toHaveText('—');
  await expect(tableau(page)).not.toContainText('200');
});
