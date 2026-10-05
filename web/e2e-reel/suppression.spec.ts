import { expect, test, type Page } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserUnMacro, seConnecter } from './aides';

/** Les SUPPRESSIONS, jusqu'à la dernière — et ce qu'elles doivent nettoyer.
 *
 *  Trois règles gardées ici, chacune apprise à ses dépens :
 *
 *   - supprimer un membre d'un bi-set NETTOIE le lien du survivant (FRE-31) :
 *     cinq lignes réelles portaient un `groupId` orphelin, invisibles à l'écran
 *     par construction — c'est le serveur qui tient la règle, pas le client ;
 *   - la DERNIÈRE ligne et la DERNIÈRE séance se suppriment : le front gardait
 *     l'objet à l'écran quand le serveur l'avait déjà supprimé (constat A2 de
 *     la revue), et chaque frappe partait ensuite en 404 ;
 *   - supprimer une semaine ne laisse RIEN : ses séances et lignes partent avec
 *     (cascade de clés étrangères — l'impossibilité structurelle d'un orphelin
 *     est prouvée par la suite brokkr ; ici on vérifie ce que l'API en rend).
 *
 *  ÉPROUVÉE en réintroduisant le défaut : l'appel à `_nettoyer_groupe` retiré de
 *  `delete_exercise` (brokkr, `training_lines.py`) → le survivant garde son
 *  `groupId` orphelin et la spec rougit sur l'assertion de nettoyage. Rétabli.
 */
test.afterEach(nettoyer);

async function confirmer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
}

/** « Retirer » vit dans le dépli de la ligne (brief coach, 27/09) : on déplie
 *  la ligne visée, puis on clique le seul bouton de suppression affiché. */
async function retirerLaLigne(page: Page, i: number): Promise<void> {
  const depli = page.locator(`[data-ligne="${i}"]`).first().getByRole('button', { name: /^Déplier la ligne/ });
  if (await depli.getAttribute('aria-expanded') !== 'true') await depli.click();
  await page.getByTitle('Supprimer l’exercice').first().click();
  await confirmer(page);
}

test('supprimer un membre de bi-set, puis tout, jusqu’au BLOC', async ({ page }) => {
  await poserUnMacro([
    { name: 'SQUAT', sets: '5', reps: '3' },
    { name: 'CURL BICEPS', sets: '3', reps: '12', groupId: 'g1' },
    // ⚠️ UN NOM DE LA BIBLIOTHÈQUE (« TRICEPS EXTENSION », pas « EXTENSION
    // TRICEPS ») : depuis FRE-122, `POST /macros` refuse un mouvement inconnu en
    // 422, et le bac à sable est une copie de la production — resynchronisée le
    // 12/09, elle a perdu l'entrée que cette spec avait créée en passant.
    { name: 'TRICEPS EXTENSION', sets: '3', reps: '12', groupId: 'g1' },
  ]);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  // 1. Retirer un membre du bi-set : le survivant doit être DÉLIÉ par le
  //    serveur — l'écran ne montre jamais un groupe d'un seul membre, c'est
  //    précisément pour ça que l'orphelin était invisible.
  // ⚠️ APOSTROPHE TYPOGRAPHIQUE (`’`), PAS DROITE. Le libellé vient des
  // locales depuis FRE-113, et elles l'écrivent ainsi. La droite ne
  // sélectionne RIEN, et le seul symptôme est un timeout de 30 s — c'est ce
  // harnais qui l'a trouvé, trois jours après la traduction.
  await retirerLaLigne(page, 1);                                    // CURL BICEPS
  await expect.poll(async () => {
    const lignes = (await arbre()).macros[0]?.blocks[0]?.weeks[0]?.sessions?.[0]?.exercises ?? [];
    return lignes.map(l => ({ nom: l.name, groupe: l.groupId || '' }));
  }, { timeout: 10_000 }).toEqual([
    { nom: 'SQUAT', groupe: '' },
    { nom: 'TRICEPS EXTENSION', groupe: '' },                       // délié
  ]);

  // 2. Jusqu'à la DERNIÈRE ligne : une séance vide est un état légitime.
  await retirerLaLigne(page, 1);
  await retirerLaLigne(page, 0);
  await expect.poll(async () => {
    const s = (await arbre()).macros[0]?.blocks[0]?.weeks[0]?.sessions?.[0];
    return s?.exercises?.length;
  }, { timeout: 10_000 }).toBe(0);

  // 3. La DERNIÈRE séance, puis la semaine : plus rien, et rien d'orphelin
  //    visible par l'API — la cascade SQL est éprouvée côté brokkr.
  await page.getByTitle('Supprimer la séance').first().click();
  await confirmer(page);
  await expect.poll(async () => {
    const w = (await arbre()).macros[0]?.blocks[0]?.weeks[0];
    return w?.sessions?.length ?? 0;
  }, { timeout: 10_000 }).toBe(0);

  // ⚠️ SUPPRIMER EST PASSÉ SOUS « GÉRER » le 24/08, quand l'arbre en rail est
  // devenu une barre d'onglets. Renommer et supprimer s'ouvrent quelques fois
  // par mois : ils n'occupent plus en permanence la hauteur rendue à la séance.
  // Les AJOUTS, eux, sont restés visibles — ajouter une semaine est
  // hebdomadaire, et dix specs de ce harnais l'ont rappelé d'un coup.
  await page.getByRole('button', { name: /Gérer|Manage/ }).click();
  await page.getByTitle('Supprimer le semaine').click();            // sic — l'accord est au code
  await confirmer(page);
  await expect.poll(async () => (await arbre()).macros[0]?.blocks[0]?.weeks?.length ?? 0,
                    { timeout: 10_000 }).toBe(0);

  // 4. ET LE BLOC — mais il en faut DEUX pour en supprimer un.
  //
  //    ⚠️ UN MACRO GARDE TOUJOURS AU MOINS UN BLOC : brokkr refuse le dernier en
  //    409 (`dernier_bloc`). Première version de cette étape écrite sans le
  //    savoir — elle attendait 0 bloc et a échoué sur 1, ce qui est le refus du
  //    serveur et non un défaut. La règle est juste ; c'est la spec qui la
  //    découvrait.
  //
  //    ⚠️ ET CE NIVEAU A CHANGÉ DE MÉCANIQUE (FRE-45) : les trois suppressions
  //    passent désormais par un helper commun, qui resynchronise sur échec — la
  //    règle que les créations appliquaient déjà et que celles-ci avaient
  //    oubliée. Le chemin nominal doit rester intact, et c'est ce qu'on vérifie
  //    ici ; le chemin d'ÉCHEC, lui, ne se provoque qu'en unitaire.
  //    ⚠️ ON LE CRÉE PAR DUPLICATION, et pas vide : c'est le geste réel d'un
  //    coach qui prolonge un programme, et `addBlock` avec source n'était couvert
  //    nulle part en pile réelle. « + Bloc » ouvre un MENU (`AjouterAvecMenu`,
  //    partagé avec le catalogue des modèles) : « Bloc vide », puis les sources.
  await page.getByRole('button', { name: /^Bloc$/ }).click();
  await page.getByRole('menuitem').last().click();
  await expect.poll(async () => (await arbre()).macros[0]?.blocks?.length ?? 0,
                    { timeout: 10_000 }).toBe(2);

  await page.getByTitle('Supprimer le bloc').click();
  await confirmer(page);
  await expect.poll(async () => (await arbre()).macros[0]?.blocks?.length ?? 0,
                    { timeout: 10_000 }).toBe(1);
});
