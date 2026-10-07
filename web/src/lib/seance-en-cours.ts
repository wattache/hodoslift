/** LA SÉANCE EN COURS, retenue sur l'appareil le temps d'une séance.
 *
 *  ⚠️ SANS ELLE, QUITTER L'APPLI EN PLEINE SÉANCE FAIT PERDRE SA PLACE. Le
 *  téléphone recharge la page au retour (Spotify, un message), et la règle
 *  d'arrivée (`seanceAOuvrir`) ouvre la première séance SANS trace — or celle
 *  qu'on est en train de faire en porte une dès le premier exercice noté.
 *
 *  ⚠️ ELLE EXPIRE. Retenue pour toujours, elle ramènerait chaque jour sur une
 *  séance laissée à moitié, ce que la règle d'arrivée garde justement. Chaque
 *  geste (trace notée, séance choisie) repousse l'échéance. */

const CLE = 'eitri-seance-en-cours';
/** Le temps d'une séance, repos et détours compris. */
export const DUREE_SEANCE_EN_COURS_MS = 3 * 60 * 60 * 1000;

interface Retenue { semaine: string; seance: string; le: number }

export function noterSeanceEnCours(semaine: string | null | undefined, seance: string, maintenant = Date.now()): void {
  if (!semaine || !seance) return;
  try {
    localStorage.setItem(CLE, JSON.stringify({ semaine, seance, le: maintenant } satisfies Retenue));
  } catch {
    // Commodité d'affichage : sans stockage, la règle d'arrivée décide seule.
  }
}

/** L'id de la séance en cours dans CETTE semaine, ou `null` si rien de récent. */
export function lireSeanceEnCours(semaine: string | null | undefined, maintenant = Date.now()): string | null {
  if (!semaine) return null;
  try {
    const r = JSON.parse(localStorage.getItem(CLE) ?? 'null') as Retenue | null;
    if (!r || r.semaine !== semaine) return null;
    return maintenant - r.le <= DUREE_SEANCE_EN_COURS_MS ? r.seance : null;
  } catch {
    return null;
  }
}
