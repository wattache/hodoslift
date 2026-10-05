import { rpeToNumber } from '@/lib/rpe';

export { rpeToNumber };

/** ⚠️ LES LISTES D'OPTIONS ONT DÉMÉNAGÉ DANS `@/lib/rpe` (FRE-91).
 *
 *  Ce module en portait sa propre copie, et les deux avaient DIVERGÉ : celle-ci
 *  omettait la valeur `"5"` du RPE ressenti. Personne ne l'importait, donc rien
 *  ne le montrait — mais la liste plus courte avait l'air de la plus propre, et
 *  c'est elle qu'on aurait gardée en « consolidant » à vue.
 *
 *  La production a tranché : **293 séries portent un RPE de `"5"`**. Retenir
 *  cette liste-ci aurait retiré de l'écran une valeur que des athlètes utilisent,
 *  sans casser un seul test. `rpe.test.ts` garde désormais l'inventaire.
 *
 *  `rpeToNumber` était dupliqué à l'identique dans les deux fichiers : réexporté
 *  ici pour ne pas casser les imports existants, mais défini une seule fois.
 */

/** RPE ressenti global d'un exercice à partir des RPE par série.
 *  Règles (voir docs/rpe-par-serie.md) :
 *   1. un seul "FAIL" → "FAIL" (absorbant : format raté)
 *   2. sinon moyenne (Sub5=4) ; si < 5 → "Sub5" ; sinon arrondi 0,5 supérieur.
 *  Renvoie "" si aucune valeur. Une valeur unique = sa propre "moyenne". */
export function feltRPEFromSets(bySet: readonly string[]): string {
  const vals = bySet.map((v) => v.trim()).filter(Boolean);
  if (vals.length === 0) return '';
  if (vals.some((v) => v === 'FAIL')) return 'FAIL';
  const nums = vals
    .map((v) => (v === 'Sub5' ? 4 : parseFloat(v.replace(',', '.'))))
    .filter((n) => !isNaN(n));
  if (nums.length === 0) return '';
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (avg < 5) return 'Sub5';
  return String(Math.ceil(avg * 2) / 2);
}
