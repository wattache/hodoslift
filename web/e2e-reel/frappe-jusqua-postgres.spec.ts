import { expect, test } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserUnMacro, seConnecter } from './aides';

/** UNE CHARGE TAPÉE ARRIVE EN BASE — le geste le plus fréquent du produit.
 *
 *  ⚠️ CE CHEMIN N'ÉTAIT COUVERT NULLE PART EN PILE RÉELLE, et c'est le plus
 *  emprunté : un coach passe ses soirées à taper des charges. La seule frappe
 *  vérifiée de bout en bout l'était dans l'éditeur de BASE, qui passe par
 *  `PUT /base` — pas par la file de patchs.
 *
 *  Or c'est cette file qui a perdu des frappes à quatre reprises (FRE-86), et
 *  elle vient de changer de fichier (FRE-45). Ses 19 specs unitaires tournent
 *  avec des TIMERS SIMULÉS : elles prouvent la logique, pas que le debounce se
 *  déclenche dans un vrai navigateur, ni que le PATCH atteint Postgres.
 *
 *  ⚠️ CE QU'ELLE TRAVERSE, ET QU'AUCUN AUTRE TEST NE TRAVERSE ENSEMBLE : la
 *  cellule qui ne valide qu'au BLUR, les 400 ms de debounce en temps réel, le
 *  `PATCH /exercises/{id}`, et la colonne. Si l'un des quatre lâche, une frappe
 *  de coach disparaît en silence — le pire défaut de ce produit, et le plus
 *  difficile à croire sur parole.
 */
test.afterEach(nettoyer);

test('taper une charge dans la séance l’écrit en base', async ({ page }) => {
  await poserUnMacro([{ name: 'SQUAT', sets: '5', reps: '3' }]);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  // ⚠️ IL FAUT CHOISIR LA SEMAINE : le panneau reste sur « Sélectionne une
  // semaine » tant qu'aucune ne l'est, et la table n'existe donc pas.
  await page.getByRole('button', { name: 'Semaine 1' }).first().click();

  // ⚠️ PAR SON NOM ACCESSIBLE. Les en-têtes de cette table sont des `div`, pas
  // des `label` : rien ne relie le texte au champ. Le nom vient d'un
  // `aria-label`, qui MANQUAIT sur cette cellule — un lecteur d'écran
  // n'annonçait rien sur le champ le plus important de la table.
  const charge = page.getByRole('textbox', { name: 'Charge' }).first();
  await expect(charge).toBeVisible({ timeout: 15_000 });

  await charge.fill('102.5');
  // ⚠️ LA CELLULE NE VALIDE QU'AU BLUR, pas à chaque frappe — c'est ce qui évite
  // un PATCH par caractère. Sans ce geste, rien ne part et la spec attendrait
  // pour toujours une écriture que personne n'a demandée.
  await charge.blur();

  // ⚠️ ON INTERROGE LA BASE, PAS L'ÉCRAN. L'écran affiche la valeur dès la
  // frappe — c'est le principe de l'édition optimiste — donc le lire ne
  // prouverait rien du tout. La seule question qui compte est : le serveur l'a-t-il ?
  await expect.poll(async () => {
    const lignes = (await arbre()).macros[0].blocks[0].weeks[0].sessions?.[0].exercises ?? [];
    return lignes[0]?.weight;
  }, { timeout: 10_000, message: 'la charge tapée n’est jamais arrivée en base' }).toBe('102.5');
});
