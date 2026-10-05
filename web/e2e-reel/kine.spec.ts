import { expect, test } from '@playwright/test';
import { KINE, arbre, jeton, nettoyer, poserUnMacro, seConnecter, BROKKR, PROGRAMME } from './aides';

/** LE KINÉ PROGRAMME COMME LE COACH (2026-08-18), sur l'athlète qu'il suit.
 *
 *  Le troisième rôle traverse pour de vrai : compte émulateur `e2e-kine`,
 *  déclaré dans `kines` et lié à l'athlète de test par `athletes.kine_uid` —
 *  c'est le LIEN qui ouvre, pas le rôle. Le kiné d'un AUTRE athlète n'aurait
 *  rien, et c'est la seule frontière qui reste (corollaire FRE-64).
 *
 *  ⚠️ CETTE SPEC AFFIRMAIT L'INVERSE — « il entre, il voit, il n'écrit pas », avec
 *  403 sur chaque écriture. C'était la position de FRE-52/65, prudente parce
 *  qu'aucun droit d'écriture n'avait alors été décidé. Il l'a été depuis : mêmes
 *  droits, mêmes onglets, et on affinera à l'usage plutôt qu'en anticipant.
 *
 *  Les deux moitiés se testent différemment, comme pour l'athlète :
 *   - l'ENTRÉE et l'AFFORDANCE passent par l'interface ;
 *   - le DROIT lui-même par l'API brute — une affordance visible ne prouve pas
 *     que le serveur suit, et c'est justement le décalage qu'on veut interdire.
 */
test.afterEach(nettoyer);

test('le kiné entre, voit le programme de son athlète, et l\'écrit', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3', weight: '100' }]);

  await seConnecter(page, KINE);

  // Son athlète est dans l'en-tête (la liste vient de /athletes/suivis). Il n'en
  // suit qu'un : le sélecteur est alors un nom qui ouvre son espace (constat 07).
  //
  // ⚠️ INSENSIBLE À LA CASSE (refonte des écrans, 09/2026) : la sidebar NORMALISE la casse à
  // l'affichage — « WILLI LAGACHETTE » y devient « Willi Lagachette », parce que
  // 16 prénoms sur 67 sont saisis tout en capitales en production et criaient
  // dans la colonne. Le compte de harnais « Athlète E2E » y devient donc
  // « Athlète E2e ». C'est la CASSE qui n'est plus garantie, pas le nom : la
  // spec cesse de l'exiger, et continue de garder ce qui compte — que cet
  // athlète-là soit bien dans la barre.
  await expect(page.getByRole('button', { name: /Athlète E2E/i }).first())
    .toBeVisible({ timeout: 10_000 });

  await page.goto('/training');
  // ⚠️ LA SÉANCE EST DÉPLIÉE D'OFFICE (refonte des écrans, 09/2026). Elle s'ouvrait par un clic sur
  // son en-tête ; le repli a disparu avec la cascade — une seule séance est à
  // l'écran (le bandeau la choisit quand il y en a plusieurs), et la replier ne
  // laissait qu'un titre au-dessus du vide. Le nom n'est plus un bouton : on
  // attend qu'il soit là, on ne le clique plus.
  await expect(page.getByText(/^Lundi/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('SQUAT').first()).toBeVisible({ timeout: 10_000 });

  // L'AFFORDANCE D'ÉCRITURE EST LÀ : le mode Coach lui est offert. C'est le
  // pendant exact de l'ancienne assertion `toHaveCount(0)`.
  await expect(page.getByRole('button', { name: 'Coach', exact: true })).toBeVisible();

  // …et le serveur suit. Deux grains : la LIGNE et la STRUCTURE.
  const t = await jeton(KINE);
  const { macros } = await arbre();
  const semaine = macros[0].blocks[0].weeks[0];
  const ligne = semaine.sessions?.[0]?.exercises?.[0] as { id?: string };
  const patch = (chemin: string, corps: unknown) =>
    fetch(`${BROKKR}/programs/${PROGRAMME}${chemin}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    }).then(r => r.status);
  expect(await patch(`/exercises/${ligne.id}`, { weight: '999' })).toBe(200);
  expect(await patch(`/weeks/${semaine.id}`, { name: 'par le kiné' })).toBe(200);

  // L'EFFET, pas seulement le code : un 200 qui n'écrit rien passerait sinon.
  const relu = await arbre();
  const semaineRelue = relu.macros[0].blocks[0].weeks[0];
  expect(semaineRelue.name).toBe('par le kiné');
  expect(semaineRelue.sessions?.[0]?.exercises?.[0]?.weight).toBe('999');
});
