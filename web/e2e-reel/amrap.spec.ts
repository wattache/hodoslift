import { expect, test } from '@playwright/test';
import { arbre, COACH, nettoyer, patchBrut, poserUnMacro, seConnecter } from './aides';

/** UN AMRAP S'AFFICHE EN MINUTES, À L'ÉCRAN (FRE-91).
 *
 *  ⚠️ POURQUOI CETTE SPEC EXISTE. La table du coach et l'aperçu de l'athlète
 *  formataient le badge d'un AMRAP par deux chemins différents : `formatTimeValue`
 *  d'un côté, `formatReps(…, "sec")` de l'autre. Le coach lisait donc `300"` là
 *  où l'athlète lisait `5'` — même exercice, deux écrans, deux lectures. Les deux
 *  ne se regardent jamais côte à côte, alors personne ne l'a signalé.
 *
 *  La fusion a tranché pour la version lisible, et 22 lignes de production
 *  changent d'affichage. `format.test.ts` garde la règle ; ce fichier-ci garde
 *  qu'elle ARRIVE JUSQU'À L'ÉCRAN.
 *
 *  ⚠️ ET C'EST LE HARNAIS RÉEL, PAS LA MAQUETTE, délibérément. La maquette porte
 *  « AMRAP » dans sa bibliothèque mais aucun exercice ne l'utilise, et lui en
 *  ajouter un modifierait le décor partagé de 107 specs pour un seul cas. Ici le
 *  décor est semé puis nettoyé par cette spec seule.
 */
test.afterEach(nettoyer);

test('un AMRAP de 300 secondes se lit « 5\' », pas « 300" »', async ({ page }) => {
  // ⚠️ `300` EST LA VALEUR RÉELLE, pas un nombre choisi pour l'exemple : c'est
  // celle de 19 des 22 AMRAP datés de production.
  await poserUnMacro([{
    name: 'SQUAT', sets: '3', reps: '10', weight: '60',
    format: 'AMRAP', clusterMode: '300',
  }]);

  // ⚠️ LA SEMAINE DOIT PORTER DES DATES QUI COUVRENT AUJOURD'HUI. La vue de
  // l'athlète ne choisit pas la première semaine venue : elle choisit la semaine
  // COURANTE, par date. Sans dates, elle n'affiche rien — et la spec échouait
  // sur « element(s) not found », ce qui ressemble à un badge manquant alors que
  // c'est la semaine entière qui n'était pas là.
  const semaine = (await arbre()).macros[0].blocks[0].weeks[0];
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const dans7 = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
  expect(await patchBrut(COACH, `/weeks/${semaine.id}`, { startDate: aujourdhui, endDate: dans7 })).toBe(200);
  // La séance porte SA date : c'est elle que l'écran de l'athlète déroule.
  expect(await patchBrut(COACH, `/sessions/${semaine.sessions![0].id}`, { sessionDate: aujourdhui })).toBe(200);

  await seConnecter(page);
  await page.goto('/training');

  // ⚠️ ON RESTE EN MODE ATHLÈTE, ET C'EST LE POINT. Le format s'affiche là comme
  // un BADGE avec son suffixe (« AMRAP 5' ») ; la table du coach, elle, en fait
  // une colonne éditable — c'est-à-dire un `<select>`, où le suffixe n'existe pas.
  // Le défaut corrigé se voit donc ici, et nulle part ailleurs.

  // ⚠️ IL FAUT CHOISIR LA SEMAINE, comme le ferait un coach : le panneau de
  // droite reste sur « Sélectionne une semaine dans le programme » tant qu'aucune
  // n'est sélectionnée, et la table des exercices n'existe donc pas. Sans ce
  // clic la spec échouait sur « Received: hidden », ce qui ressemblait à un
  // défaut de rendu alors que l'écran n'avait simplement rien à rendre.

  // ⚠️ ET IL FAUT DÉPLIER : l'écran s'ouvre sur « Aperçu », séances repliées.
  // Un athlète clique pour voir sa séance ; la spec fait le même geste.
  await page.getByRole('button', { name: 'Détail' }).first().click();
  await page.getByText(/Lundi/).first().click();

  // ⚠️ `.filter({ visible: true })` ET NON `.first()` : la table est rendue DEUX
  // fois, en disposition mobile et bureau, et l'une des deux est masquée par CSS.
  // Un `.first()` tombait sur la version cachée — la spec échouait sur
  // « Received: hidden », ce qui ressemble à un défaut de rendu alors que ce
  // n'est qu'un mauvais choix de cible.
  const badge = page.getByText(/AMRAP/).filter({ visible: true }).first();
  await expect(badge).toBeVisible({ timeout: 15_000 });

  // ⚠️ L'ASSERTION QUI PORTE LA SPEC, ET SON ORDRE COMPTE. On vérifie d'abord que
  // l'ANCIEN rendu a disparu : si l'assertion de présence venait en tête, un
  // retour en arrière donnerait « 5' introuvable » — vrai, mais muet sur la
  // cause. Ici le rouge dit que le coach relit des secondes.
  await expect(page.getByText('300"').filter({ visible: true })).toHaveCount(0);
  await expect(badge).toContainText("5'");
});
