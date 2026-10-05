// Today's date as ISO (YYYY-MM-DD) in LOCAL time. Use this instead of
// `new Date().toISOString().slice(0,10)` (which is UTC): in positive-offset
// timezones (France UTC+1/+2) the UTC slice can resolve to the wrong calendar
// day near midnight, so "compétition à venir/passée" or "semaine courante"
// would drift by a day. Mirrors useAthleteData's internal todayIsoDate.
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Add days to an ISO date (YYYY-MM-DD); returns same format.
// Manipulates dates in UTC to avoid off-by-one drift in positive-offset timezones.
export function addDays(iso: string, n: number): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

// Nombre de jours entre deux dates ISO (b - a). Négatif si b < a. UTC pour
// éviter les décalages de fuseau (cf. addDays).
export function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}




