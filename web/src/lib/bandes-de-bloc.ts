/** LES BANDES DE BLOC — tranches contiguës de semaines partageant le même
 *  (macro, bloc). Une nuance sur deux, un libellé M/B, trait doré plein au
 *  changement de MACRO, pointillé au changement de BLOC.
 *
 *  ⚠️ UNE SEULE DÉFINITION : le graphe Charge & RPE, son bandeau RPE et les six
 *  cartes de progression dessinent les MÊMES bandes depuis cette fonction. Deux
 *  découpages dans la même vue, et les bandes d'une carte ne seraient plus
 *  alignées avec celles de la voisine.
 *
 *  Dans `lib/` et non dans un composant : un module qui exporte autre chose
 *  qu'un composant casse le rafraîchissement à chaud de Vite (FRE-114). */

export interface BandeDeBloc {
  from: number;
  to: number;
  macro: number | null;
  block: number | null;
}

export function bandesDeBloc(
  weeks: { macroNumber: number | null; blockNumber: number | null }[],
): BandeDeBloc[] {
  const bands: BandeDeBloc[] = [];
  weeks.forEach((w, i) => {
    const last = bands[bands.length - 1];
    if (last && last.macro === w.macroNumber && last.block === w.blockNumber) {
      last.to = i;
    } else {
      bands.push({ from: i, to: i, macro: w.macroNumber, block: w.blockNumber });
    }
  });
  return bands;
}

/** « M3B2 », ou `''` sans macro. */
export function libelleDeBande(b: BandeDeBloc): string {
  return b.macro != null ? `M${b.macro}${b.block != null ? `B${b.block}` : ''}` : '';
}
