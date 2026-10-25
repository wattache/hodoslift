import type { BlockObjective } from '@/api/types';

const cle = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const variantes = (s: string) => s.split(/\s*\+\s*/).map(cle).filter(Boolean).sort().join('+');

/** LES OBJECTIFS DU BLOC QUI PARLENT DE CET EXERCICE (FRE-253) — même mouvement.
 *
 *  Ceux dont la variante est celle de la ligne passent en tête : un MUSCLE UP
 *  « NO DIPS » montre d'abord l'objectif NO DIPS, puis les autres objectifs de
 *  muscle-up du bloc, qui restent utiles à l'athlète. Les variantes se comparent
 *  sans ordre ni casse : « CHEST + DS » et « ds+chest » sont la même. */
export function objectifsDeLExercice(
  objectifs: readonly BlockObjective[] | undefined,
  ex: { name?: string | null; variant?: readonly string[] | null },
): BlockObjective[] {
  const nom = cle(ex.name);
  if (!nom || !objectifs?.length) return [];
  const sienne = variantes((ex.variant ?? []).join('+'));
  const memeMouvement = objectifs.filter(o => cle(o.exercise) === nom);
  const rang = (o: BlockObjective) => (variantes(o.variant ?? '') === sienne ? 0 : 1);
  return [...memeMouvement].sort((a, b) => rang(a) - rang(b));
}
