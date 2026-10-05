import i18n from '@/i18n';

/** YYYY-MM-DD → Date (UTC) */
export function parseISODate(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

/** Date → YYYY-MM-DD (UTC) */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export function daysBetween(a: string, b: string): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime();
  return Math.round(ms / 86_400_000);
}

// Formatage piloté par la LANGUE COURANTE plutôt que par des tableaux de mois
// français en dur : sans ça, une interface en anglais affichait « lun. 8 juin ».
// `timeZone: UTC` parce que les dates sont des jours calendaires parsés en UTC —
// formater en heure locale les décalerait d'un jour en fuseau négatif.
const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(i18n.language || 'fr', { ...options, timeZone: 'UTC' });

/** Un INSTANT, et non un jour calendaire : date et heure, à l'heure LOCALE.
 *  Pour une échéance comme la fin d'une assistance (FRE-202). */
export function formatMoment(iso: string): string {
  return new Intl.DateTimeFormat(i18n.language || 'fr', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export function formatShort(iso: string): string {
  return fmt({ day: 'numeric', month: 'short' }).format(parseISODate(iso));
}

export function formatLong(iso: string): string {
  return fmt({ weekday: 'short', day: 'numeric', month: 'long' }).format(parseISODate(iso));
}

/** Plage de dates d'une compétition : un seul jour → date complète ; deux jours
 *  du même mois → « 28–29 mars » ; à cheval → les deux dates entières. */
export function formatRange(startIso: string, endIso?: string): string {
  if (!endIso || endIso === startIso) return formatLong(startIso);
  const a = parseISODate(startIso);
  const b = parseISODate(endIso);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const jourMois = fmt({ day: 'numeric', month: 'long' });
  return sameMonth
    ? `${a.getUTCDate()}–${jourMois.format(b)}`
    : `${jourMois.format(a)} – ${jourMois.format(b)}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}
