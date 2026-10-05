/** LE CHRONO — la logique de temps, sans React.
 *
 *  ⚠️ IL GARDE DES INSTANTS, PAS UN COMPTEUR. Un `setInterval` qui ajoute une
 *  seconde s'arrête quand l'application passe en arrière-plan — téléphone posé,
 *  écran verrouillé, autre application ouverte — et repart de zéro au
 *  rechargement. Des instants se relisent : le temps écoulé est toujours
 *  `maintenant − départ`, juste quoi qu'il se soit passé entre deux rendus. C'est
 *  ce qui le fait « continuer de tourner quand on quitte l'app » (William, 14/09). */

export interface Chrono {
  /** Instant (ms) où il a été lancé ou relancé ; `null` quand il est en pause. */
  enMarcheDepuis: number | null;
  /** Le temps déjà compté avant la dernière relance. */
  cumulMs: number;
}

export function demarrerLeChrono(maintenant: number): Chrono {
  return { enMarcheDepuis: maintenant, cumulMs: 0 };
}

export function ecouleMs(c: Chrono, maintenant: number): number {
  return c.cumulMs + (c.enMarcheDepuis === null ? 0 : Math.max(0, maintenant - c.enMarcheDepuis));
}

export function mettreEnPause(c: Chrono, maintenant: number): Chrono {
  return c.enMarcheDepuis === null ? c : { enMarcheDepuis: null, cumulMs: ecouleMs(c, maintenant) };
}

export function reprendre(c: Chrono, maintenant: number): Chrono {
  return c.enMarcheDepuis === null ? { ...c, enMarcheDepuis: maintenant } : c;
}

/** « 1:07 », puis « 1:02:07 » passé une heure. */
export function formatChrono(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
