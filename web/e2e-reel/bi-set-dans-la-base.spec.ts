import { expect, test } from '@playwright/test';
import { arbre, colonne, modeCoach, nettoyer, poserUnMacro, poserUneBase, seConnecter } from './aides';

/** LIER DEUX ACCESSOIRES DANS LA BASE ÉCRIT AUSSI LEUR NATURE (FRE-145).
 *
 *  ⚠️ CE CHEMIN-CI FABRIQUAIT DES GROUPES SANS NATURE, et son jumeau non. La
 *  SEMAINE pose `groupKind` en même temps que `groupId` depuis FRE-36 — la BASE
 *  ne posait que l'identifiant. Onze lignes en production, toutes postérieures à
 *  la reprise du 29/08 : le chemin d'écriture était donc encore ouvert.
 *
 *  ⚠️ ET LE DÉFAUT ÉTAIT INVISIBLE À TOUT CE QUI LIT PAR L'API. `_sortie` rend
 *  « biset » pour toute colonne NULL portant un groupe : à l'écran, deux groupes
 *  identiques ; en base, deux encodages. C'est ce filet qui a laissé le défaut
 *  vivre, et c'est lui qui a rendu ma PREMIÈRE version de cette spec inutile —
 *  elle interrogeait `GET /training` et restait verte avec les deux moitiés du
 *  correctif retirées. D'où `colonne()`, qui lit `group_kind` là où il est.
 *
 *  ⚠️ CE QU'ELLE GARDE, ET DE QUEL CÔTÉ. Les deux moitiés du correctif suffisent
 *  chacune à la faire passer — le front pose la nature, le serveur la pose aussi
 *  pour tout groupe qui arrive nu (`normaliser_groupes`). Cette spec garde donc
 *  le RÉSULTAT, pas une implémentation : elle rougit le jour où les deux
 *  tombent, ce qui est exactement ce qu'on veut d'un filet de sécurité doublé.
 *  La moitié SERVEUR, elle, est gardée seule par
 *  `test_un_groupe_SANS_nature_en_recoit_une_PAR_DEFAUT`.
 */
test.afterEach(nettoyer);

const DEUX_ACCESSOIRES = [
  { name: 'LEG RAISE', day: 'J1', variant: [], sets: '3', reps: '12' },
  { name: 'CURL BICEPS', day: 'J1', variant: [], sets: '3', reps: '12' },
];

/** L'état de la colonne pour les accessoires du programme de test, dans l'ordre
 *  d'insertion. `NULL` se lit comme tel, et pas comme la chaîne vide : c'est
 *  toute la distinction que la lecture efface. */
const naturesEnBase = () => colonne(`
  SELECT coalesce(a.group_kind, '⌀') || ':' || coalesce(nullif(a.group_id, ''), '⌀')
  FROM training_base_accessories a
  JOIN training_blocks b ON b.id = a.block_id
  JOIN training_macros m ON m.id = b.macro_id
  WHERE m.program_id = 'e2e-program'
  ORDER BY a.position`).split('\n').filter(Boolean);

test('lier deux accessoires de la BASE leur donne une nature, la défaire la reprend', async ({ page }) => {
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    daySplit: [], selectedPrincipaux: null, principles: [], accessories: DEUX_ACCESSOIRES,
  });

  // Le décor est bien celui du défaut : deux lignes libres, aucune nature.
  expect(naturesEnBase()).toEqual(['⌀:⌀', '⌀:⌀']);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();

  // Le connecteur vit ENTRE les deux lignes, et il n'existe que si elles sont du
  // même jour et libres de tout groupe : le voir, c'est déjà vérifier le décor.
  const lier = page.getByRole('button', { name: /Lier au suivant|Link to the next one/ });
  await expect(lier).toBeVisible({ timeout: 15_000 });
  await lier.click();

  // ⚠️ LES DEUX LIGNES, MÊME GROUPE, MÊME NATURE. Une nature posée sur deux
  // lignes qui ne se rejoignent pas ne vaudrait rien — d'où l'identifiant dans
  // la même lecture, plutôt que deux assertions qu'on pourrait croire liées.
  await expect.poll(naturesEnBase,
    { timeout: 10_000, message: 'le groupe créé depuis la BASE n’a pas reçu sa nature' })
    .toEqual([expect.stringMatching(/^biset:.+/), expect.stringMatching(/^biset:.+/)]);
  const [a, b] = naturesEnBase();
  expect(a).toBe(b);

  // Défaire : la nature part avec le groupe. Une ligne seule n'est ni bi-set ni
  // dropset, et la laisser derrière soi recréerait l'incohérence à l'envers —
  // une nature sans groupe, que plus aucun écran ne montrerait.
  await page.getByRole('button', { name: /Défaire le bi-set|Unlink the superset/ }).click();

  await expect.poll(naturesEnBase,
    { timeout: 10_000, message: 'la nature a survécu au groupe qui la portait' })
    .toEqual(['⌀:⌀', '⌀:⌀']);
});

/** LA BASE PROPOSE LE DROPSET (FRE-149).
 *
 *  Zéro dropset sur quinze groupes de BASE en production le 08/09 : pas faute
 *  d'en vouloir, faute de pouvoir le dire. Le geste est celui de la semaine —
 *  l'en-tête du groupe se clique. Le serveur n'avait rien à apprendre ; la
 *  génération reporte déjà la nature (`test_un_DROPSET_de_la_BASE_reste_un_dropset_dans_la_semaine`).
 *
 *  ⚠️ ET UN DROPSET N'A QU'UN EXERCICE : les deux lignes portent le PREMIER nom
 *  en base, pas seulement à l'écran où la descente se lit « ↑ ».
 *
 *  MUTATION QUI ROUGIT : `choisirNatureDuGroupe` qui garde `groupKind` tel quel. */
test('l’en-tête d’un groupe de la BASE bascule bi-set ↔ dropset, et c’est ce qui est écrit', async ({ page }) => {
  await poserUnMacro([], { sansSemaine: true });
  const bloc = (await arbre()).macros[0].blocks[0];
  await poserUneBase(bloc.id, {
    daySplit: [], selectedPrincipaux: null, principles: [], accessories: DEUX_ACCESSOIRES,
  });
  const lignesEnBase = () => colonne(`
    SELECT coalesce(a.group_kind, '⌀') || ':' || a.name
    FROM training_base_accessories a
    JOIN training_blocks b ON b.id = a.block_id
    JOIN training_macros m ON m.id = b.macro_id
    WHERE m.program_id = 'e2e-program'
    ORDER BY a.position`).split('\n').filter(Boolean);

  await seConnecter(page);
  await page.goto('/training');
  await modeCoach(page);
  await page.getByRole('button', { name: /Éditer la BASE|Edit the block template/ }).click();
  await page.getByRole('button', { name: /Lier au suivant|Link to the next one/ }).click({ timeout: 15_000 });
  await expect.poll(lignesEnBase, { timeout: 10_000 }).toEqual(['biset:LEG RAISE', 'biset:CURL BICEPS']);

  // Une LISTE depuis FRE-116 : six natures ne se basculent plus d'un clic.
  const nature = page.getByRole('combobox', { name: /Nature du groupe|Group type/ });
  await nature.selectOption('dropset');
  await expect.poll(lignesEnBase, { timeout: 10_000, message: 'la bascule n’a pas écrit de dropset' })
    .toEqual(['dropset:LEG RAISE', 'dropset:LEG RAISE']);

  // Réversible : on rechoisit, on ne délie pas pour relier autrement.
  await nature.selectOption('biset');
  await expect.poll(lignesEnBase, { timeout: 10_000 }).toEqual(['biset:LEG RAISE', 'biset:LEG RAISE']);
});
