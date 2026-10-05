import { expect, test } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** DUPLIQUER UNE BASE EMPORTE SES PRINCIPES — le geste, pas seulement l'API.
 *
 *  Signalé en production le 17/08 : un coach duplique un macro depuis un autre
 *  et retrouve une trame sans aucun principe. `_creer_bloc` écrivait la
 *  configuration du bloc (grille des jours, sélection de mouvements,
 *  granularité) et laissait tomber les LIGNES — sans erreur ni journal.
 *
 *  ⚠️ LA PERTE ÉTAIT DIFFÉRÉE, ce qui la rendait déroutante : le front affiche
 *  d'abord son clone optimiste, principes compris, puis le refetch le remplace
 *  par la vérité du serveur, qui n'en a pas. D'où un défaut systématique qui
 *  passait pour intermittent — ce qu'on voit dépend du moment où l'on regarde.
 *
 *  Ce test regarde donc le SERVEUR, et après coup. Les tests brokkr couvrent
 *  déjà les deux portes d'entrée ; celui-ci couvre le maillon qui manquait :
 *  que le CLIENT envoie bien la base complète en dupliquant.
 */
test.afterEach(nettoyer);

test('dupliquer un macro emporte les principes de la BASE source', async ({ page }) => {
  await poserUnMacro([], { sessions: [] });
  const source = (await arbre()).macros[0].blocks[0];
  await poserUneBase(source.id, {
    daySplit: [{ day: 'J1', tiers: { SQUAT: 1 } }],
    selectedPrincipaux: ['SQUAT'],
    principles: [{ name: 'SQUAT', tier: 1, variant: [], sets: '5', reps: '5',
                   repsUnit: 'count', weight: '100' }],
    accessories: [{ name: 'LEG RAISE', day: 'J1', variant: [], sets: '3', reps: '12' }],
  });

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  // Le geste : « + Macro » → « Dupliquer une base » → le bloc source.
  //
  // ⚠️ `menuitem` ET NON `button` DEPUIS LE 25/08. Le menu a été extrait dans
  // `AjouterAvecMenu` (partagé avec le catalogue des modèles de bilan) et
  // s'annonce désormais `role="menu"` — ce qui REMPLACE le rôle implicite
  // `button` de ses entrées. L'ancien sélecteur ne trouvait plus rien, et cette
  // spec l'a dit tout de suite : c'est exactement ce qu'on lui demande.
  await page.getByRole('button', { name: /^Macro$/ }).click();
  await page.getByRole('menuitem', { name: /Bloc 1|Macro 1/ }).last().click();

  // ⚠️ D'ABORD : UN MACRO A BIEN ÉTÉ CRÉÉ.
  //
  // Sans cette étape, la spec MENT. Première version : elle lisait
  // `macros[macros.length - 1]` sans vérifier qu'il y en avait un nouveau — si
  // le clic dans le menu rate, ce dernier macro est le macro SOURCE, qui porte
  // évidemment ses principes. Elle est restée VERTE avec le défaut serveur
  // réintroduit, c'est-à-dire qu'elle ne testait rien.
  await expect.poll(async () => (await arbre()).macros.length,
                    { timeout: 10_000 }).toBe(2);

  // La VÉRITÉ DU SERVEUR, pas l'écran : le clone optimiste afficherait les
  // principes même quand rien n'est écrit — c'est précisément le piège.
  await expect.poll(async () => {
    const macros = (await arbre()).macros;
    const neuf = macros[macros.length - 1]?.blocks[0];
    return {
      principes: neuf?.base?.principles?.map(p => p.name) ?? null,
      accessoires: neuf?.base?.accessories?.map(a => a.name) ?? null,
    };
  }, { timeout: 10_000 }).toEqual({ principes: ['SQUAT'], accessoires: ['LEG RAISE'] });
});
