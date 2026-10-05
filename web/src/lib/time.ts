/** Parse une durée ("90", "1:30") en secondes. 0 si vide/invalide. */
export function parseSeconds(value: string | null | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const match = trimmed.match(/^(\d+):(\d+)$/);
  if (!match) return 0;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/** Formate des secondes en libellé court (45" / 2' / 1'30"). "" si <= 0. */
export function formatSeconds(totalSec: number): string {
  if (totalSec <= 0) return "";
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes === 0) return `${seconds}"`;
  if (seconds === 0) return `${minutes}'`;
  return `${minutes}'${String(seconds).padStart(2, "0")}"`;
}
