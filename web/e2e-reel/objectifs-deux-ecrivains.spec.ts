import { expect, test } from '@playwright/test';
import { BROKKR, colonne, jeton, seConnecter, ATHLETE, COACH } from './aides';

/** DEUX ÉCRIVAINS SUR LA MÊME LISTE D'OBJECTIFS (FRE-134).
 *
 *  ⚠️ CE QUE CETTE SPEC GARDE, ET QUI N'EXISTE NULLE PART AILLEURS. `PUT
 *  /athletes/{id}/goals` remplace la liste ENTIÈRE par celle du client, et
 *  `owner_or_staff` ouvre la porte à DEUX humains : l'athlète et son coach.
 *  Celui qui avait chargé la page en premier renvoyait une liste sans l'objectif
 *  que l'autre venait d'ajouter — et cet objectif disparaissait, sans erreur ni
 *  journal. La version exigée par le serveur referme ce trou.
 *
 *  ⚠️ ET SURTOUT : LE CONTRAT DE LECTURE A CHANGÉ DE FORME. `GET .../goals`
 *  rendait un tableau nu, il rend maintenant `{ goals, version }`. Un front qui
 *  n'aurait pas suivi enverrait un PUT sans version — 422 — et l'athlète ne
 *  pourrait plus enregistrer un seul objectif. Les specs brokkr tiennent la
 *  vérité du serveur ; celle-ci vérifie que les DEUX bouts se parlent, ce que
 *  `tsc` ne peut pas faire pour un aller-retour de valeur.
 *
 *  On passe par l'API et non par l'écran : le deuxième écrivain doit détenir une
 *  version PÉRIMÉE, et l'interface n'offre aucun geste pour en fabriquer une. */

const ATHLETE_E2E = 'e2e-athlete';

async function lire(compte: { sub: string }) {
  const r = await fetch(`${BROKKR}/athletes/${ATHLETE_E2E}/goals`, {
    headers: { Authorization: `Bearer ${await jeton(compte)}` },
  });
  return r.json() as Promise<{ goals: { id: string }[]; version: string }>;
}

async function ecrire(compte: { sub: string }, version: string, goals: unknown[]) {
  return fetch(`${BROKKR}/athletes/${ATHLETE_E2E}/goals`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${await jeton(compte)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version, goals }),
  });
}

const objectif = (id: string, exercise = 'SQUAT') =>
  ({ id, exercise, sets: '1', reps: '1', weight: '100', motivation: '', createdAt: '2026-01-10' });

test.afterEach(() => {
  colonne(`DELETE FROM athlete_goals WHERE athlete_id = 'e2e0e2e0-0000-4000-8000-000000000001'`);
});

test('le second écrivain ne peut plus effacer l’objectif du premier', async () => {
  // Les deux ouvrent la page. L'athlète garde SA version.
  const vueParLAthlete = (await lire(ATHLETE)).version;

  // Le coach ajoute un objectif, avec la version qu'il vient de lire.
  const r1 = await ecrire(COACH, (await lire(COACH)).version, [objectif('g-coach')]);
  expect(r1.status).toBe(200);

  // L'athlète enregistre sa propre liste — celle d'AVANT.
  const r2 = await ecrire(ATHLETE, vueParLAthlete, [objectif('g-athlete', 'BENCH PRESS')]);
  expect(r2.status).toBe(409);
  expect((await r2.json()).code).toBe('objectifs_perimes');

  // ⚠️ LU EN BASE, PAS PAR L'API. C'est le seul œil qui voit ce que le serveur a
  // vraiment écrit — l'objectif du coach est toujours là, et lui seul.
  expect(colonne(
    `SELECT string_agg(legacy_id, ',' ORDER BY legacy_id) FROM athlete_goals `
    + `WHERE athlete_id = 'e2e0e2e0-0000-4000-8000-000000000001'`,
  )).toBe('g-coach');
});

test('relire suffit à repartir', async () => {
  const perimee = (await lire(ATHLETE)).version;
  await ecrire(COACH, (await lire(COACH)).version, [objectif('g-coach')]);
  expect((await ecrire(ATHLETE, perimee, [objectif('g-athlete', 'BENCH PRESS')])).status).toBe(409);

  // Le geste que l'interface fait toute seule après un refus : refetch, puis
  // réécrire. Sans cette moitié, la garde serait une impasse.
  const fraiche = await lire(ATHLETE);
  const r = await ecrire(ATHLETE, fraiche.version,
                         [...fraiche.goals, objectif('g-athlete', 'BENCH PRESS')]);
  expect(r.status).toBe(200);
  expect(colonne(
    `SELECT string_agg(legacy_id, ',' ORDER BY legacy_id) FROM athlete_goals `
    + `WHERE athlete_id = 'e2e0e2e0-0000-4000-8000-000000000001'`,
  )).toBe('g-athlete,g-coach');
});


test('le coach ajoute un objectif DEPUIS L’ÉCRAN, et il arrive en base', async ({ page }) => {
  // ⚠️ LE VRAI CHEMIN, ET IL EST LE PLUS EXPOSÉ PAR CE TICKET. La version ne
  // traverse aucun composant : le hook la lit dans l'entrée de cache que la
  // lecture a remplie. Une clé de requête qui divergerait, un `select` qui
  // laisserait tomber l'enveloppe — et le PUT partirait sans version, en 422.
  // `tsc` ne voit rien de tout ça : c'est un aller-retour de VALEUR.
  await seConnecter(page);
  await page.goto('/dashboard');

  const carte = page.locator('section').filter({ hasText: 'Objectifs' }).first();
  await expect(carte).toBeVisible({ timeout: 15_000 });

  await carte.getByRole('button', { name: 'Éditer' }).click();
  await carte.getByRole('button', { name: 'Ajouter' }).click();
  // Sortir du mode édition est le geste qui PERSISTE (`toggleEditMode`).
  await carte.getByRole('button', { name: 'Aperçu' }).click();

  await expect.poll(() => colonne(
    `SELECT count(*) FROM athlete_goals `
    + `WHERE athlete_id = 'e2e0e2e0-0000-4000-8000-000000000001'`,
  ), { timeout: 15_000 }).toBe('1');
});
