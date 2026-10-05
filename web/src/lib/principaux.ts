import { PRINCIPAL_MOVEMENTS } from '@/lib/constants';

// Canonical BASE order (MU → PU → CU → DIPS → SQUAT) first, extras alphabetically after.
export function orderedPrincipaux(principaux: string[]): string[] {
  const set = new Set(principaux);
  const canonical = PRINCIPAL_MOVEMENTS.filter(m => set.has(m));
  const extras = principaux
    .filter(m => !PRINCIPAL_MOVEMENTS.includes(m as typeof PRINCIPAL_MOVEMENTS[number]))
    .sort();
  return [...canonical, ...extras];
}
