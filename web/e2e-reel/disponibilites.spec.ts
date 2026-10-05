import { expect, test } from '@playwright/test';
import { ATHLETE, BROKKR, COACH, jeton } from './aides';

/** LA MATRICE DE DISPONIBILITÉ — la route que le harnais ne pouvait PAS joindre.
 *
 *  ⚠️ CE FICHIER EST LA PREUVE DE FRE-80, pas seulement une couverture de plus.
 *  `competition_coach_availability` porte 11 lignes en production et
 *  `competitions.py` l'interroge — mais elle manquait à
 *  `docs/postgres-schema.sql`, dont le bac à sable est construit. Ici, la route
 *  répondait donc 500 `UndefinedTable` : elle était INTESTABLE.
 *
 *  Et son test unitaire passait, parce qu'il fabriquait sa propre mini-table.
 *  Un harnais qui ment coûte plus cher qu'un harnais absent : il donne la même
 *  confiance qu'une vraie preuve. Que ce fichier soit vert est ce qui dit que le
 *  fichier de référence et la base se sont retrouvés.
 */

const COMPET = 'e2e-dispo';
const JOUR = '2026-05-01';

interface Case { coachUid: string; coachName: string; day: string; status: string }

/** ⚠️ LE CORPS NE SE LIT QU'UNE FOIS. `expect(r.status, await r.text())` consomme
 *  le flux avant l'assertion suivante — piège rencontré deux fois aujourd'hui.
 *  On lit d'abord, on assertionne ensuite, sur la valeur déjà en main. */
async function lire<T>(r: Response): Promise<T> {
  const brut = await r.text();
  expect(r.status, brut).toBe(200);
  return JSON.parse(brut) as T;
}

async function appel(chemin: string, compte = COACH, init: RequestInit = {}) {
  return fetch(`${BROKKR}${chemin}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await jeton(compte)}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

test.beforeAll(async () => {
  await lire(await appel(`/competitions/${COMPET}`, COACH, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Open Dispo E2E', startDate: JOUR, endDate: '2026-05-02',
      maxAttempts: 1, movementNames: ['SQUAT'], participants: [],
    }),
  }));
});

test.afterAll(async () => {
  await appel(`/competitions/${COMPET}`, COACH, { method: 'DELETE' });
});

test('la matrice est COMPLÈTE dès le départ, comblée à « pending »', async () => {
  /** `pending` est une valeur, pas une absence. La matrice répond à « qui
   *  reste-t-il à relancer ? », question qui a besoin des trous — les laisser
   *  porter par l'absence de ligne rendrait « jamais vu » et « ligne perdue »
   *  indistinguables. Deux jours de compétition, donc deux cases par coach. */
  const matrice = await lire<Case[]>(await appel(`/competitions/${COMPET}/availability`));

  const miennes = matrice.filter(l => l.coachUid === 'e2e-coach');
  expect(miennes.map(l => l.day).sort()).toEqual([JOUR, '2026-05-02']);
  expect(miennes.every(l => l.status === 'pending')).toBe(true);
  expect(miennes.every(l => l.coachName.length > 0)).toBe(true);
});

test('un coach se déclare, et la matrice le reflète', async () => {
  await lire(await appel(`/competitions/${COMPET}/availability`, COACH, {
    method: 'PUT',
    body: JSON.stringify({ coachUid: 'e2e-coach', day: JOUR, status: 'available' }),
  }));

  const matrice = await lire<Case[]>(await appel(`/competitions/${COMPET}/availability`));
  const jour = (d: string) => matrice.find(l => l.coachUid === 'e2e-coach' && l.day === d)!;
  expect(jour(JOUR).status).toBe('available');
  // L'autre jour n'a pas bougé : la déclaration est par JOUR, pas par compétition.
  expect(jour('2026-05-02').status).toBe('pending');
});

test('un athlète lit la matrice mais ne l’écrit pas', async () => {
  /** La lecture est ouverte — savoir qui encadre la compétition intéresse tout
   *  le monde. L'écriture est réservée aux coachs, comme la compétition
   *  elle-même. */
  expect((await appel(`/competitions/${COMPET}/availability`, ATHLETE)).status).toBe(200);

  const refus = await appel(`/competitions/${COMPET}/availability`, ATHLETE, {
    method: 'PUT',
    body: JSON.stringify({ coachUid: 'e2e-coach', day: JOUR, status: 'unavailable' }),
  });
  expect(refus.status).toBe(403);
  expect((await refus.json()).code).toBe('reserve_aux_coachs');
});
