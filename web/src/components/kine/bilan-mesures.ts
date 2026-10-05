/** Le vocabulaire et les conversions de la saisie d'un bilan.
 *
 *  ⚠️ HORS DU FICHIER DE COMPOSANT, ET C'EST LA RÈGLE DU PROJET. Un module qui
 *  exporte à la fois des composants et des fonctions casse le rafraîchissement à
 *  chaud de Vite (`react-refresh/only-export-components`) : à chaque édition,
 *  c'est la page entière qui se recharge au lieu du seul composant — et un bilan
 *  à moitié rempli perd sa saisie en cours.
 */

import type { BilanResultat } from '@/api/types';

/** ⚠️ LA CLÉ, PAS LE LIBELLÉ. Une liste de libellés se fige à l'import : elle
 *  garderait la langue du chargement de la page. `valeur` est ce qui part à
 *  brokkr et ne bouge pas ; `cle` dit où l'écran va chercher le mot. */
export const RESSENTIS = [
  { valeur: 'ras', cle: 'suiviKine.ressentiRas' },
  { valeur: 'douleur', cle: 'suiviKine.ressentiDouleur' },
  { valeur: 'gene', cle: 'suiviKine.ressentiGene' },
] as const;

/** ⚠️ `''` → `null` ET NON `0`. Un champ vidé veut dire « test non réalisé », pas
 *  « échec complet » : la distinction est clinique, et c'est tout ce que la base
 *  s'échine à préserver. `Number('')` vaut 0 — le piège est là, à un caractère. */
export function versNombre(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** ⚠️ « RENSEIGNÉ » = PORTE QUELQUE CHOSE, et c'est la MÊME règle que le serveur
 *  (`_PORTE_QUELQUE_CHOSE`, `routers/bilans.py`). Elle est ici parce que l'écran
 *  doit marquer chaque test AVANT tout aller-retour ; elle n'est pas une seconde
 *  définition, elle en est le miroir — et les deux compteurs qu'elle alimente
 *  (« 12 / 32 » du serveur, « 3 / 15 » par rubrique) doivent s'accorder à l'œil.
 *
 *  ⚠️ AVOIR UNE LIGNE NE SUFFIT PAS. La ligne naît au premier geste et ne repart
 *  plus ; vider ensuite tous ses champs — ce que la dé-sélection permet — laisserait
 *  un test marqué fait alors qu'il ne porte plus rien.
 *
 *  ⚠️ ET `0` COMPTE : un échec constaté est un résultat. C'est `null` qui veut dire
 *  « pas fait », jamais le zéro. */
export function estRenseigne(r: BilanResultat | undefined): boolean {
  if (!r) return false;
  return r.ressenti != null || r.detail != null
    || r.mesureGauche != null || r.mesureDroite != null || r.chargeKg != null;
}

/** L'inverse : `null` s'affiche vide, `0` s'affiche zéro. */
export function versTexte(v: number | null | undefined): string {
  return v == null ? '' : String(v);
}
