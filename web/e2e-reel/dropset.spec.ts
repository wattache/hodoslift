import { expect, test } from '@playwright/test';
import { arbre, modeCoach, nettoyer, poserUnMacro, seConnecter } from './aides';

/** LA NATURE D'UN GROUPE ARRIVE EN BASE, ET ELLE Y ARRIVE POUR TOUT LE GROUPE.
 *
 *  ⚠️ CE QU'AUCUN AUTRE HARNAIS NE PROUVE. Les 36 specs unitaires de `groupe.ts`
 *  éprouvent la règle sans écran ; les 5 specs e2e sur maquette éprouvent l'écran
 *  sans écriture — leurs writers sont des no-op. Entre les deux, personne ne
 *  vérifie que `groupKind` traverse le `PATCH`, la colonne et le `CHECK`.
 *
 *  ⚠️ ELLE DISTINGUE MAINTENANT QUI PROPAGE, et elle ne le faisait pas avant. Le
 *  front envoyait un `PATCH` par membre du groupe : neutraliser la règle serveur
 *  laissait donc cette spec VERTE, parce que le client compensait. Depuis que la
 *  propagation appartient au serveur seul, le front n'écrit plus qu'UNE ligne —
 *  et ce que la base contient sur les AUTRES ne vient plus que de brokkr.
 *
 *  C'est le sens de l'opération : une règle qui ne tient qu'au client ne vaut que
 *  pour le client qui l'applique.
 */
test.afterEach(nettoyer);

test('basculer un groupe en dropset l’écrit en base, sur TOUS ses membres', async ({ page }) => {
  await poserUnMacro([
    { name: 'BACK EXTENSION', sets: '3', reps: '30' },
    { name: 'BACK EXTENSION', sets: '3', reps: '8' },
  ]);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);

  // ⚠️ IL FAUT CHOISIR LA SEMAINE : le panneau reste sur « Sélectionne une
  // semaine » tant qu'aucune ne l'est, et la table n'existe donc pas.
  await page.getByRole('button', { name: 'Semaine 1' }).first().click();

  // Lier les deux lignes : le connecteur vit entre elles.
  const lier = page.getByRole('button', { name: /Créer un bi-set|Superset with/ });
  await expect(lier.first()).toBeVisible({ timeout: 15_000 });
  await lier.first().click();

  // Un groupe neuf naît « enchaînement » — et il le DIT en base, il ne le laisse
  // pas déduire : deux groupes identiques à l'écran ne doivent pas être
  // différents en base.
  await expect.poll(async () => {
    const l = (await arbre()).macros[0].blocks[0].weeks[0].sessions?.[0].exercises ?? [];
    return l.map(e => e.groupKind);
  }, { timeout: 10_000, message: 'le groupe créé n’a pas reçu sa nature' }).toEqual(['biset', 'biset']);

  // Une LISTE depuis FRE-116 : six natures ne se basculent plus d'un clic.
  await page.getByRole('combobox', { name: /Nature du groupe|Group type/ }).selectOption('dropset');

  // ⚠️ ON N'A CHOISI QUE SUR L'EN-TÊTE, donc sur la PREMIÈRE ligne. Les DEUX
  // doivent basculer : un groupe mi-bi-set mi-dropset n'a aucune lecture
  // possible — l'en-tête afficherait l'une, les champs proposeraient l'autre.
  await expect.poll(async () => {
    const l = (await arbre()).macros[0].blocks[0].weeks[0].sessions?.[0].exercises ?? [];
    return l.map(e => e.groupKind);
  }, { timeout: 10_000, message: 'la nature n’a pas gagné tout le groupe en base' })
    .toEqual(['dropset', 'dropset']);
});
