import { useSyncExternalStore } from 'react';
import type { Me } from '@/api/types';

/** LA STRUCTURE SÉLECTIONNÉE — FRE-13.
 *
 *  Nico est coach chez SCAPPULIFT et athlète chez French Forge. L'app lui montre
 *  l'un OU l'autre, selon la structure choisie dans le menu de la barre
 *  latérale. Ce qu'il EST dans chacune, c'est brokkr qui le dit
 *  (`me.structures`) ; ici on ne fait que CHOISIR une entrée.
 *
 *  ⚠️ LA CLÉ EST LUE AVANT LE BUNDLE. `index.html` la lit dans son script de tête
 *  pour jouer l'ouverture de la bonne structure — « celle choisie à l'ouverture
 *  d'avant » (William, 18/09). La renommer ici sans la renommer là-bas, et
 *  l'ouverture retomberait sur French Forge sans un mot.
 *
 *  ⚠️ ET LE STOCKAGE PEUT LEVER (navigation privée, données bloquées) : chaque
 *  accès est gardé, et l'app marche sans — elle retombe sur le choix par défaut.
 */
export const CLE_STRUCTURE = 'hodos.structure';

export type StructureDeMoi = Me['structures'][number];

const abonnes = new Set<() => void>();

function lireStockee(): string | null {
  try {
    return localStorage.getItem(CLE_STRUCTURE);
  } catch {
    return null;
  }
}

let stockee = lireStockee();

/** Retient le choix, pour l'app ET pour l'ouverture de la prochaine fois. */
export function choisirStructure(slug: string): void {
  if (slug === stockee) return;
  stockee = slug;
  try {
    localStorage.setItem(CLE_STRUCTURE, slug);
  } catch {
    // Sans stockage, le choix vit le temps de l'onglet — c'est tout.
  }
  abonnes.forEach(f => f());
}

function sAbonner(f: () => void) {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

/** Le slug RETENU sur l'appareil — pas forcément une structure du compte :
 *  `structureCourante` tranche. */
export function useSlugRetenu(): string | null {
  return useSyncExternalStore(sAbonner, () => stockee, () => null);
}

/** La structure où l'on est.
 *
 *  1. celle retenue sur l'appareil, si le compte en fait partie ;
 *  2. sinon la première où il est STAFF — Nico, au premier lancement, arrive
 *     là où il coache, pas là où il s'entraîne (décision du 18/09) ;
 *  3. sinon la première (French Forge vient d'abord, c'est brokkr qui ordonne).
 *
 *  `null` pour un compte sans structure — le gate le refuse déjà. */
export function structureCourante(
  structures: readonly StructureDeMoi[] | undefined, retenue: string | null,
): StructureDeMoi | null {
  if (!structures?.length) return null;
  return structures.find(s => s.slug === retenue)
    ?? structures.find(s => s.isCoach || s.isKine)
    ?? structures[0];
}

/** Le profil VU DEPUIS une structure : ses rôles et sa fiche athlète sont ceux
 *  qu'il a LÀ. C'est ce qui fait qu'aucun écran n'a à connaître les structures —
 *  ils lisent `isCoach`, `athleteId` comme avant.
 *
 *  ⚠️ `isAdmin` NE CHANGE PAS : il est de la plateforme. Et un profil sans
 *  structures (serveur d'avant FRE-13) passe tel quel. */
export function vuDepuis(me: Me, structure: StructureDeMoi | null): Me {
  if (!structure) return me;
  return { ...me, isCoach: structure.isCoach, isKine: structure.isKine, athleteId: structure.athleteId ?? null };
}
