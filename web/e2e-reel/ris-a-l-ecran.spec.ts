import { expect, test } from '@playwright/test';
import { BROKKR, COACH, jeton, seConnecter } from './aides';

/** LE RIS AFFICHÉ EST CELUI DU SERVEUR — FRE-141.
 *
 *  ⚠️ CET ÉCRAN LE RECALCULAIT, et le motif écrit était la latence : « un RIS
 *  servi accuserait un temps de retard devant un plateau ». L'argument tombe sur
 *  le MÉTIER — le RIS n'a de valeur qu'une fois le dernier squat passé (William,
 *  08/09). Un classement qui frémit à chaque essai jugé n'informe personne.
 *
 *  ⚠️ ET AUCUNE SPEC NE GARDAIT LE CHANGEMENT. Les deux specs RIS du harnais
 *  éprouvent la RÉPONSE de brokkr ; aucune ne regarde l'écran. Vérifié par
 *  mutation : forcer le classement à `null` les laissait toutes VERTES. Celle-ci
 *  existe pour ça.
 *
 *  ⚠️ ELLE PORTE SUR DEUX CHOSES, et il en faut deux : la VALEUR affichée (qui
 *  attrape une régression de `RisInline`) et l'ORDRE du classement (qui attrape
 *  une régression du tri). Un seul participant ne pourrait pas distinguer les
 *  deux — d'où le poids de corps différent, qui sépare les RIS à total égal.
 */

const COMPET = 'e2e-ris-ecran';
const ORIGINE = 'http://localhost:5200';

async function appel(chemin: string, options: RequestInit = {}) {
  return fetch(`${BROKKR}${chemin}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${await jeton(COACH)}`,
      Origin: ORIGINE,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

const participant = (name: string, bodyweight: number) => ({
  name, bodyweight, gender: 'M',
  // Même total pour les deux : c'est le POIDS qui doit les départager, et rien
  // d'autre. Un total différent laisserait planer un doute sur ce qui trie.
  movements: [
    { name: 'MUSCLE UP', attempts: [{ weight: 40, result: 'rep' }] },
    { name: 'PULL UP', attempts: [{ weight: 50, result: 'rep' }] },
    { name: 'DIPS', attempts: [{ weight: 60, result: 'rep' }] },
    { name: 'SQUAT', attempts: [{ weight: 100, result: 'rep' }] },
  ],
});

test.afterEach(async () => {
  await appel(`/competitions/${COMPET}`, { method: 'DELETE' });
});

test('le classement affiche le RIS servi, et s’ordonne dessus', async ({ page }) => {
  const r = await appel(`/competitions/${COMPET}`, {
    method: 'PUT',
    body: JSON.stringify({
      // ⚠️ DANS LE FUTUR : l'écran range les compétitions passées ailleurs, et
      // une date échue faisait chercher la ligne dans une section repliée.
      name: 'Open RIS écran', date: '2026-12-06', maxAttempts: 1,
      movementNames: ['MUSCLE UP', 'PULL UP', 'DIPS', 'SQUAT'],
      // ⚠️ LES NOMS SONT À CONTRESENS DU CLASSEMENT, ET C'EST INDISPENSABLE.
      // brokkr rend les participants triés par NOM (`ORDER BY cp.name`) : avec
      // « Leger » et « Lourd », l'ordre alphabétique coïncidait avec l'ordre du
      // RIS, et la spec passait même en cassant le tri. Ici le plus LOURD — donc
      // le moins bien classé — s'appelle « Alpha », et il arrive premier dans la
      // réponse. Seul un tri par RIS peut le faire redescendre.
      participants: [participant('Alpha Lourd E2E', 100), participant('Zoe Legere E2E', 60)],
    }),
  });
  expect(r.status, await r.text()).toBe(200);

  // Ce que brokkr calcule — la référence, lue par le même chemin que l'écran.
  const comp = (await (await appel('/competitions')).json())
    .find((c: { id: string }) => c.id === COMPET);
  const attendu = Object.fromEntries(
    comp.participants.map((p: { name: string; ris: number }) => [p.name, p.ris]));
  expect(attendu['Zoe Legere E2E']).toBeGreaterThan(attendu['Alpha Lourd E2E']);

  await seConnecter(page);
  // ⚠️ PAS DE `modeCoach` ICI : la bascule athlète/coach n'existe que sur l'écran
  // Entraînement. L'appeler faisait attendre un bouton qui ne viendra jamais, et
  // la spec échouait sur un timeout sans rapport avec ce qu'elle éprouve.
  await page.goto('/competitions');
  // ⚠️ LE BOUTON, PAS LE TEXTE : `getByText` tombe sur le `div` interne, que
  // Playwright ne parvient pas à cliquer. Le nom accessible porte aussi la date
  // et le compte de participants, d'où le motif partiel.
  await page.getByRole('button', { name: /Open RIS écran/ }).click();

  // ⚠️ LE RIS EST ARRONDI À L'AFFICHAGE (`formatRis`). On compare donc sur deux
  // décimales, pas sur le flottant : exiger l'égalité stricte ferait rougir la
  // spec sur un arrondi, c'est-à-dire sur autre chose que ce qu'elle éprouve.
  // Le classement général au RIS vit dans sa section, tous groupes confondus
  // (Plateau, 24/09) : une ligne par athlète, le RIS en dernier.
  const classement = page.locator('section').filter({ hasText: /Classement général/ });
  const ligne = (nom: string) => classement.getByRole('listitem').filter({ hasText: nom });
  const affiche = async (nom: string) =>
    (await ligne(nom).textContent())?.match(/kg\s*([\d.]+|-)$/)?.[1] ?? null;

  await expect.poll(() => affiche('Zoe Legere E2E'), { timeout: 10_000 })
    .toBe(attendu['Zoe Legere E2E'].toFixed(2));
  expect(await affiche('Alpha Lourd E2E')).toBe(attendu['Alpha Lourd E2E'].toFixed(2));

  // ⚠️ ET L'ORDRE SUIT LE RIS, pas le total ni l'ordre reçu. Les deux athlètes
  // ont exactement le même total : seul le poids les sépare.
  const cartes = await classement.getByRole('listitem').allTextContents();
  const rang = (nom: string) => cartes.findIndex(t => t.includes(nom));
  expect(rang('Zoe Legere E2E')).toBeLessThan(rang('Alpha Lourd E2E'));
});
