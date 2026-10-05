import { expect, test } from '@playwright/test';
import { BROKKR, jeton } from './aides';
import { mockWeightCategories } from '../src/api/mock';

/** LA MAQUETTE DIT-ELLE LES MÊMES CATÉGORIES QUE LA VRAIE BASE ? — FRE-140.
 *
 *  ⚠️ ELLE NE LES DISAIT PAS. Mesuré le 08/09 : TROIS codes en commun sur treize.
 *  La maquette servait `-59, -66, -74, -83, -93, -105, +105` là où la base porte
 *  `-66, -73, -80, -87, -94, -101, +101`.
 *
 *  Ce que ça produit : une spec écrite sur la maquette choisit une catégorie que
 *  la production REFUSE — `competition_participants` porte une clé étrangère
 *  COMPOSITE `(gender, weight_category)` vers `weight_categories`. Le test passe,
 *  le geste réel échoue. C'est le pire mode d'échec d'un harnais : il atteste.
 *
 *  ⚠️ ET SEUL CE HARNAIS-CI PEUT LE VOIR. La maquette n'a pas de serveur à
 *  interroger, et le serveur ne connaît pas la maquette : c'est le seul endroit
 *  du projet où les deux existent en même temps. D'où une spec qui ne teste
 *  aucun écran — elle compare deux sources qui doivent dire la même chose.
 */
test('la maquette sert exactement les catégories de la base', async () => {
  const r = await fetch(`${BROKKR}/weight-categories`, {
    headers: { Authorization: `Bearer ${await jeton()}` },
  });
  expect(r.status, 'GET /weight-categories').toBe(200);
  const serveur = await r.json();

  // ⚠️ L'ORDRE COMPTE AUTANT QUE LE CONTENU. La route trie par `position`, et
  // c'est cet ordre-là que l'écran présente au coach : une liste juste mais
  // désordonnée serait un autre défaut, tout aussi invisible.
  expect(serveur).toEqual(mockWeightCategories);
});
