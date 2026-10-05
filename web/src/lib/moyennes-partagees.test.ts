import { describe, expect, it } from 'vitest';

import table from '@/lib/__fixtures__/moyennes-par-serie.json';
import { moyenneDesSeries } from '@/lib/par-serie';
import { feltRPEFromSets } from '@/lib/rpe-scale';

/** LA MÊME TABLE QUE BROKKR, LUE ICI (FRE-136).
 *
 *  ⚠️ CE FICHIER NE TESTE PAS LA RÈGLE, IL TESTE SON ACCORD. Le « pourquoi » de
 *  chaque cas vit dans `par-serie.test.ts`, qui reste la spécification du front.
 *  Celui-ci répond à une autre question : la moyenne que le NAVIGATEUR affiche
 *  pendant la frappe est-elle celle que le SERVEUR écrira ?
 *
 *  La règle vit aux deux endroits, et c'est délibéré : en SQL parce que le
 *  serveur DÉRIVE la colonne (`ff_moyenne_serie`, `ff_moyenne_rpe`), ici parce
 *  que le chiffre doit suivre la frappe sans réseau et survivre hors ligne. Deux
 *  moments réels, dont aucun ne peut disparaître.
 *
 *  ⚠️ ET LEUR ACCORD ÉTAIT PROUVÉ UNE FOIS, PUIS FIGÉ DANS DEUX TABLES. Changer
 *  la règle d'un côté et sa table dans la foulée ne faisait rien rougir. La
 *  table est désormais unique : elle vit chez brokkr, `npm run fixtures:brokkr`
 *  en recopie une version commitée — même motif que `brokkr.gen.ts`, parce que
 *  chaque CI ne fait que son propre checkout.
 *
 *  ⚠️ LA COPIE PEUT DONC SE PÉRIMER, comme les types générés. Le filet est le
 *  harnais RÉEL (`e2e-reel/moyennes-par-serie.spec.ts`), où les deux règles
 *  s'exécutent ensemble : il saisit par série et compare ce que brokkr a STOCKÉ
 *  à ce que le front AFFICHE.
 */

describe('la moyenne d’un réalisé — table partagée avec brokkr', () => {
  it.each(table.moyenneDesSeries)('$series → $attendu', ({ series, attendu }) => {
    expect(moyenneDesSeries(series)).toBe(attendu);
  });
});

describe('la moyenne d’un RPE — table partagée avec brokkr', () => {
  it.each(table.feltRPEFromSets)('$series → $attendu', ({ series, attendu }) => {
    expect(feltRPEFromSets(series)).toBe(attendu);
  });
});

/** ⚠️ LA TABLE DOIT RESTER PEUPLÉE. Une copie tronquée — un `cp` interrompu, un
 *  fichier vidé par mégarde — ferait passer `it.each` sur ZÉRO cas, et les deux
 *  blocs ci-dessus seraient verts sans rien avoir vérifié. */
it('porte bien les deux familles de cas', () => {
  expect(table.moyenneDesSeries.length).toBeGreaterThan(8);
  expect(table.feltRPEFromSets.length).toBeGreaterThan(8);
});
