import type { TFunction } from 'i18next';
import type { Flight } from '@/api/types';

/** Le libellé d'un groupe. Un nom court se lit « Groupe A » ; un nom qui se
 *  suffit, « Flight 10 », se lit tel quel. `null` : ceux d'aucun groupe. */
export function nomDuGroupe(t: TFunction, flight: string | null): string {
  if (flight === null) return t('competition.horsGroupeCourt');
  return /^[\p{L}\d]{1,3}$/u.test(flight) ? `${t('competition.groupe')} ${flight}` : flight;
}

/** Le prochain nom libre dans la suite A, B, C… */
export function nomSuivant(flights: Flight[]): string {
  const pris = new Set(flights.map(f => f.name.toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const nom = String.fromCharCode(65 + i);
    if (!pris.has(nom)) return nom;
  }
  return String(flights.length + 1);
}
