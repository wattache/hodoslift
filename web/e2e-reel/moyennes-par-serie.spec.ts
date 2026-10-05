import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { moyenneDesSeries } from '@/lib/par-serie';
import { feltRPEFromSets } from '@/lib/rpe-scale';

import { arbre, nettoyer, poserDuRealise, poserUnMacro } from './aides';

/** ⚠️ LUE, PAS IMPORTÉE. Playwright tourne en ESM natif, qui exige
 *  `with { type: 'json' }` — une syntaxe que la configuration TypeScript du
 *  projet ne sert pas. Lire le fichier évite la question, et c'est la MÊME
 *  copie que `moyennes-partagees.test.ts` importe côté vitest. */
const table = JSON.parse(readFileSync(fileURLToPath(
  new URL('../src/lib/__fixtures__/moyennes-par-serie.json', import.meta.url)), 'utf-8')) as {
    moyenneDesSeries: { series: string[]; attendu: string }[];
    feltRPEFromSets: { series: string[]; attendu: string }[];
  };

/** LES DEUX RÈGLES DE MOYENNE S'EXÉCUTENT ENSEMBLE (FRE-136).
 *
 *  ⚠️ C'EST LE FILET DE LA TABLE PARTAGÉE, ET IL RATTRAPE CE QU'ELLE NE PEUT PAS.
 *  La règle vit en SQL (le serveur DÉRIVE la colonne) et en TypeScript (le
 *  chiffre suit la frappe sans réseau). `docs/moyennes-par-serie.json` les tient
 *  d'accord — mais eitri en lit une COPIE commitée, parce que chaque CI ne fait
 *  que son propre checkout. Cette copie peut donc se périmer, exactement comme
 *  les types générés depuis l'OpenAPI.
 *
 *  Ici, personne ne lit de table : on ÉCRIT par série contre un vrai brokkr, et
 *  on compare ce qu'il a STOCKÉ à ce que la règle du front aurait calculé. Une
 *  divergence entre les deux implémentations rougit ici, même si les deux tables
 *  sont d'accord entre elles.
 */

test.afterEach(nettoyer);

test('ce que brokkr STOCKE est ce que le front AURAIT calculé', async () => {
  await poserUnMacro([{ name: 'SQUAT', sets: '3', reps: '5', weight: '100' }]);

  // ⚠️ DES CAS PRIS DANS LA TABLE, pas inventés ici : si elle change, ce test
  // suit. On garde ceux qui exercent les trois formes qui divergent le plus
  // facilement — l'arrondi, la virgule décimale, et le FAIL absorbant.
  const reps = table.moyenneDesSeries.find(c => c.attendu === '10.7')!.series;
  const charges = table.moyenneDesSeries.find(c => c.attendu === '17.5')!.series;
  const rpe = table.feltRPEFromSets.find(c => c.attendu === 'FAIL')!.series;

  await poserDuRealise({
    SQUAT: { repsDoneBySet: reps, weightDoneBySet: charges, feltRPEBySet: rpe },
  });

  const ligne = (await arbre()).macros[0].blocks[0].weeks[0].sessions![0].exercises[0];

  // ⚠️ ON COMPARE AU CALCUL DU FRONT, PAS À UNE CONSTANTE. Écrire « 10.7 » ici
  // ferait une TROISIÈME copie de la règle — celle que ce lot vient de réduire
  // à une seule table.
  expect(ligne.repsDone).toBe(moyenneDesSeries(reps));
  expect(ligne.weightDone).toBe(moyenneDesSeries(charges));
  expect(ligne.feltRPE).toBe(feltRPEFromSets(rpe));
});

test('le serveur IGNORE le scalaire que l’ancien front envoie encore', async () => {
  // ⚠️ LA FILE HORS-LIGNE EN DÉPEND (FRE-118) : les patchs en attente vivent sur
  // le disque de l'athlète et survivent aux déploiements. Un patch écrit par
  // l'ancien front porte `{tableau, scalaire}` — le refuser au rejeu perdrait
  // une séance saisie hors ligne. Éprouvé ici sur le VRAI chemin d'écriture,
  // parce que c'est là que le rejeu passera.
  await poserUnMacro([{ name: 'SQUAT', sets: '3', reps: '5', weight: '100' }]);

  await poserDuRealise({
    SQUAT: { repsDoneBySet: ['10', '12'], repsDone: '999' },
  });

  const ligne = (await arbre()).macros[0].blocks[0].weeks[0].sessions![0].exercises[0];
  expect(ligne.repsDone).toBe('11');
});
