import type { Douleur } from '@/api/types';

/** Toucher une zone l'ajoute à la sélection ; la retoucher la retire. */
export function basculer(selection: string[], code: string): string[] {
  return selection.includes(code) ? selection.filter(z => z !== code) : [...selection, code];
}

/** Les douleurs vivantes qui portent au moins une des zones touchées (FRE-196).
 *  Une zone peut appartenir à plusieurs : c'est à l'athlète de dire laquelle. */
export function douleursTouchees(vivantes: Douleur[], selection: string[]): Douleur[] {
  return vivantes.filter(d => d.zones.some(z => selection.includes(z)));
}

/** L'intensité qu'affiche chaque zone suivie : la plus forte des douleurs qui
 *  la portent — c'est elle qui dit « ici, ça fait mal ». */
export function intensitesParZone(vivantes: Douleur[]): Record<string, number | null> {
  const parZone: Record<string, number | null> = {};
  for (const d of vivantes) {
    const i = d.derniere?.intensite ?? null;
    for (const z of d.zones) {
      const avant = parZone[z];
      parZone[z] = avant == null ? i : (i == null ? avant : Math.max(avant, i));
    }
  }
  return parZone;
}
