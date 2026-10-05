/** LES ZONES DU CORPS, ET DE QUEL CÔTÉ ELLES SONT (FRE-195).
 *
 *  Une douleur se désigne en touchant le corps. Ce module tient le vocabulaire
 *  de ce geste : quelles zones existent, comment elles s'appellent, et surtout
 *  à quel côté DE L'ATHLÈTE correspond ce qu'on vient de toucher à l'écran.
 */

import { bodyFront } from './trace-homme-face';
import { bodyBack } from './trace-homme-dos';
import { faisceauDe } from './faisceaux';
import { rangDuTrace } from './faisceaux-rangs';

/** Un tracé livré par la planche : des `d` de `<path>`, rangés par côté D'ÉCRAN.
 *
 *  ⚠️ `common` EST UN TROISIÈME CAS, ET IL N'A PAS DE CÔTÉ. La nuque en porte
 *  un : sa partie centrale n'est ni gauche ni droite. L'oublier laisserait un
 *  trou dans la figure, sur une zone par ailleurs cliquable de chaque côté. */
export type TraceDeZone = {
  slug: string;
  path: { left?: string[]; right?: string[]; common?: string[] };
};

/** Les trois façons dont la planche range un tracé. */
export const COTES_DU_TRACE = ['left', 'right', 'common'] as const;
export type CoteDeTrace = (typeof COTES_DU_TRACE)[number];

export type Vue = 'face' | 'dos';

/** Le côté DE L'ATHLÈTE — jamais celui de l'écran. C'est ce qu'il dit à son
 *  kiné, et c'est ce qui part en base. */
export type Cote = 'gauche' | 'droite';

/** ⚠️ LA GAUCHE DE L'ÉCRAN N'EST PAS LA GAUCHE DE L'ATHLÈTE, et c'est la seule
 *  règle de ce fichier qui mérite d'être lue deux fois.
 *
 *  De FACE, on regarde quelqu'un : sa main droite est à notre gauche. De DOS, on
 *  regarde dans le même sens que lui : sa main gauche est à notre gauche.
 *
 *  La planche d'origine range ses tracés par côté d'écran (`left` commence à
 *  x≈272 sur un viewBox large de 724, `right` à x≈416). Elle ne fait pas cette
 *  conversion : son issue #88, ouverte depuis octobre 2025, dit exactement que
 *  basculer face↔dos ne miroite pas la sélection. On la fait ici, une fois. */
export function coteDuCorps(vue: Vue, coteEcran: CoteDeTrace): Cote | null {
  // Un tracé central n'appartient à aucun côté : la nuque, au milieu.
  if (coteEcran === 'common') return null;
  if (vue === 'face') return coteEcran === 'left' ? 'droite' : 'gauche';
  return coteEcran === 'left' ? 'gauche' : 'droite';
}

/** L'inverse : de quel côté de l'écran dessiner le côté du corps qu'on veut
 *  mettre en avant. Une douleur relue doit se rallumer au bon endroit, dans les
 *  deux vues. */
export function coteDeLEcran(vue: Vue, cote: Cote): 'left' | 'right' {
  if (vue === 'face') return cote === 'droite' ? 'left' : 'right';
  return cote === 'gauche' ? 'left' : 'right';
}

/** ⚠️ CE QUI SE DESSINE N'EST PAS CE QUI SE TOUCHE. La planche porte la tête et
 *  les cheveux pour faire une silhouette : les retirer donnerait un corps
 *  décapité, les rendre cliquables proposerait à l'athlète une réponse qui n'en
 *  est pas une. On les dessine, on ne les propose pas. La nuque, elle, est une
 *  vraie zone de douleur et reste touchable. */
const DECOR = new Set(['hair', 'head']);

export function estTouchable(zone: TraceDeZone): boolean {
  return !DECOR.has(zone.slug);
}

/** Toutes les zones DESSINABLES d'une vue, décor compris.
 *
 *  ⚠️ UNE ZONE SANS TRACÉ EST ÉCARTÉE PAR RÈGLE, PAS PAR LISTE — la planche en
 *  déclare. Filtrer sur la donnée plutôt que sur des noms vaudra aussi pour la
 *  planche suivante. */
export function zonesDeLaVue(vue: Vue): TraceDeZone[] {
  return (vue === 'face' ? bodyFront : bodyBack).filter(z => nombreDeTraces(z) > 0);
}

/** Celles que l'athlète peut désigner — c'est le vocabulaire des douleurs. */
export function zonesTouchables(vue: Vue): TraceDeZone[] {
  return zonesDeLaVue(vue).filter(estTouchable);
}

/** LE SLUG D'UN TRACÉ : celui de son FAISCEAU quand il en porte un, celui de la
 *  zone sinon.
 *
 *  ⚠️ C'EST ICI QUE LE GRAIN SE JOUE, et nulle part ailleurs. Un athlète a
 *  écrit « Brachial et brachio radial, dips » : la zone répondait
 *  « Avant-bras » pour ses trois tracés, dont le brachio-radial. Les zones que
 *  `FAISCEAUX` ne détaille pas gardent leur nom d'ensemble — les huit stries
 *  des obliques sont un muscle, pas huit. */
export function slugDuTrace(vue: Vue, zone: TraceDeZone, cote: CoteDeTrace, index: number): string {
  return faisceauDe(vue, zone.slug, rangDuTrace(vue, zone.slug, cote, index)) ?? zone.slug;
}

/** ⚠️ LE VIEWBOX DU DOS EST DÉCALÉ DE 724 EN X, parce que les deux silhouettes
 *  sont dessinées côte à côte dans le même espace. Le cadrage suffit à montrer
 *  l'une ou l'autre — il n'y a pas deux systèmes de coordonnées. */
export const CADRE: Record<Vue, string> = {
  face: '0 0 724 1448',
  dos: '724 0 724 1448',
};

/** Ce qu'une douleur porte en base : la zone, et le côté quand il y en a un.
 *
 *  ⚠️ UN CODE, PAS UN LIBELLÉ. Une des huit saisies de production est déjà en
 *  anglais (« left elbow close to forearm ») : stocker le mot affiché rendrait
 *  la donnée illisible d'une langue à l'autre, et impossible à regrouper. */
export function codeDeZone(slug: string, cote: Cote | null): string {
  return cote ? `${slug}:${cote}` : slug;
}

export function litLeCode(code: string): { slug: string; cote: Cote | null } {
  const [slug, cote] = code.split(':');
  return { slug, cote: cote === 'gauche' || cote === 'droite' ? cote : null };
}

/** Les zones que la planche ne latéralise pas : un seul tracé, pas de côté. */
export function estLateralisee(zone: TraceDeZone): boolean {
  return Boolean(zone.path.left) && Boolean(zone.path.right);
}

/** Combien de chemins une zone porte, tous côtés confondus. Zéro veut dire
 *  qu'elle est déclarée mais pas dessinée — la planche le fait pour `head`. */
export function nombreDeTraces(zone: TraceDeZone): number {
  return COTES_DU_TRACE.reduce((n, c) => n + (zone.path[c]?.length ?? 0), 0);
}

/** La clé i18n du nom d'une zone — `anatomie.chest`, `anatomie.upper-back`… */
export function cleDuNom(slug: string): string {
  return `anatomie.${slug}`;
}

/** Tous les slugs TOUCHABLES des quatre planches. Sert à garder les traductions
 *  complètes : une zone sans nom s'afficherait par son code. */
export function tousLesSlugs(): string[] {
  const vus = new Set<string>();
  for (const v of ['face', 'dos'] as Vue[]) {
    for (const z of zonesTouchables(v)) {
      for (const c of COTES_DU_TRACE) {
        (z.path[c] ?? []).forEach((_, i) => vus.add(slugDuTrace(v, z, c, i)));
      }
    }
  }
  return [...vus].sort();
}
