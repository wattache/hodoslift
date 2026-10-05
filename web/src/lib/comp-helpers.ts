import type { CompAttempt, AttemptTier } from '@/api/types';

// Stratégie de feuille de match : 3 charges candidates par essai. Ordre
// d'affichage = du plus safe au plus ambitieux (P → R → O).
export const TIER_DEFS: { id: AttemptTier; label: string; full: string }[] = [
  { id: 'pessimistic', label: 'P', full: 'Pessimiste — opener safe' },
  { id: 'realistic',   label: 'R', full: 'Réaliste — cible visée' },
  { id: 'optimistic',  label: 'O', full: 'Optimiste — stretch' },
];

// Incrément standard pour la barre ± d'ajustement par tier. Le coach cumule
// les clics pour atteindre la charge voulue.
export const BUMP_STEP = 1.25;

export type EffectiveTiers = { pessimistic: number; realistic: number; optimistic: number };

/** Extrait les 3 charges effectives d'un essai (avec fallback legacy si seul
 *  `weight` est défini). Retourne null si l'essai est "non initialisé". */
export function effectiveTiers(att: CompAttempt | undefined): EffectiveTiers | null {
  if (!att) return null;
  if (att.weights) {
    const w = att.weights;
    if (w.pessimistic > 0 || w.realistic > 0 || w.optimistic > 0) return w;
    return null;
  }
  if (att.weight > 0) return { pessimistic: 0, realistic: att.weight, optimistic: 0 };
  return null;
}

/** Pour chaque tier (P/R/O) d'un essai donné, remonte la chaîne des essais
 *  précédents pour récupérer la dernière valeur non nulle. */
export function chainedInheritedTiers(attempts: CompAttempt[], aIdx: number): EffectiveTiers | null {
  let p = 0, r = 0, o = 0;
  for (let i = 0; i < aIdx; i++) {
    const t = effectiveTiers(attempts[i]);
    if (!t) continue;
    if (t.pessimistic > 0) p = t.pessimistic;
    if (t.realistic   > 0) r = t.realistic;
    if (t.optimistic  > 0) o = t.optimistic;
  }
  if (p === 0 && r === 0 && o === 0) return null;
  return { pessimistic: p, realistic: r, optimistic: o };
}

/* ----- Score & participants (portés de useCompetitions v1) ----- */

import type { CompMovement, CompParticipant } from '@/api/types';

export function emptyAttempts(n: number): CompAttempt[] {
  return Array.from({ length: n }, () => ({ weight: 0, result: '' as const }));
}

export function createEmptyParticipant(movementNames: string[], maxAttempts: number): CompParticipant {
  return {
    name: '',
    // ⚠️ TOUJOURS PRÉSENT, nul tant que le coach n'a rien saisi — c'est la forme
    // que le serveur rend, et le tableau de bord le lit pour son J−x. L'omettre
    // ici faisait diverger un participant neuf de celui qu'un rechargement donne.
    competesOn: null,
    movements: movementNames.map(m => ({ name: m, attempts: emptyAttempts(maxAttempts) })),
    // ⚠️ DÉRIVÉS : le serveur les recalcule à chaque écriture. Ils sont ici pour
    // que la forme locale d'un participant neuf soit celle qu'un rechargement
    // rendra — la même raison que `competesOn` ci-dessus.
    // `ris` est NULL et non 0 : personne n'a encore soulevé, donc personne n'est
    // classable — ce qui n'est pas être dernier.
    risTotal: 0,
    ris: null,
    score: 0,
    // Dérivée aussi (FRE-203) : rien de planifié, rien de réussi, zéro partout.
    projection: { pessimistic: 0, realistic: 0, optimistic: 0 },
  };
}

/** Score = somme, par mouvement, de la meilleure charge validée. */
export function computeScore(movements: CompMovement[]): number {
  return movements.reduce((total, mov) => {
    const maxRep = mov.attempts
      .filter(a => a.result === 'rep')
      .reduce((max, a) => Math.max(max, a.weight), 0);
    return total + maxRep;
  }, 0);
}

/* ----- Flights et ordre de barre (FRE-204) ----- */

/** La charge qu'un essai montre et fait passer : celle ANNONCÉE (le tier
 *  choisi) ; tant que rien n'est annoncé, le R du plan — le sien, sinon celui
 *  hérité des essais précédents. Une charge saisie sans plan vaut telle quelle. */
export function chargeAnnoncee(attempts: CompAttempt[], attIdx: number): number {
  const a = attempts[attIdx];
  if (!a) return 0;
  if (a.selectedTier && a.weight > 0) return a.weight;
  const propre = effectiveTiers(a)?.realistic ?? 0;
  if (propre > 0) return propre;
  return chainedInheritedTiers(attempts, attIdx)?.realistic ?? 0;
}

export type EntreeDuTour = {
  /** L'index du participant dans la compétition — l'identité de cette vue. */
  index: number;
  charge: number;
  /** L'essai a reçu son verdict : il est sorti de la file. */
  juge: boolean;
};

type Passant = Pick<CompParticipant, 'movements'> & { flight?: string | null };

/** L'ORDRE DE BARRE D'UN TOUR (un flight × un mouvement × un essai).
 *
 *  Ceux dont l'essai est jugé sortent de la file et restent en tête ; les autres
 *  passent de la charge annoncée la plus légère à la plus lourde, pour la
 *  logistique des disques. À charge égale, l'essai précédent départage : le
 *  plus léger passe d'abord (William, 24/09) ; au premier essai, l'ordre
 *  d'inscription. Changer une annonce réordonne la file.
 *
 *  Un participant sans ce mouvement ne passe pas ce tour. `flight` nul désigne
 *  ceux dont la catégorie n'est dans aucun flight. */
export function ordreDuTour(participants: Passant[], flight: string | null, mouvement: string, attIdx: number): EntreeDuTour[] {
  return participants
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => (p.flight ?? null) === flight)
    .flatMap(({ p, index }) => {
      const attempts = p.movements.find(m => m.name === mouvement)?.attempts;
      if (!attempts || !attempts[attIdx]) return [];
      const precedent = attIdx > 0 ? chargeAnnoncee(attempts, attIdx - 1) : 0;
      return [{ index, charge: chargeAnnoncee(attempts, attIdx), juge: attempts[attIdx].result !== '', precedent }];
    })
    .sort((a, b) => (Number(b.juge) - Number(a.juge)) || (a.charge - b.charge) || (a.precedent - b.precedent) || (a.index - b.index))
    .map(({ index, charge, juge }) => ({ index, charge, juge }));
}

export type Tour = { flight: string | null; mouvement: string; essai: number };

/** La SÉQUENCE DES TOURS de la compétition : un flight fait tous ses tours
 *  (chaque mouvement, chaque essai), puis le suivant (William, 24/09).
 *
 *  Les flights dans l'ordre de la compétition, pas l'alphabet : « Flight 10 »
 *  passe après « Flight 9 ». Un flight où personne ne concourt n'a pas de tour ;
 *  ceux dont la catégorie n'est dans aucun flight passent en dernier. */
export function sequenceDesTours(participants: Passant[], flights: string[], mouvements: string[], essais: number): Tour[] {
  return flightsEnLice(participants, flights).flatMap(flight => mouvements.flatMap(mouvement =>
    Array.from({ length: essais }, (_, essai) => ({ flight, mouvement, essai }))));
}

/** Les flights où quelqu'un concourt, dans l'ordre de la compétition ; `null`
 *  en dernier pour ceux dont la catégorie n'est dans aucun flight. */
export function flightsEnLice(participants: Passant[], flights: string[]): (string | null)[] {
  const occupes = flights.filter(f => participants.some(p => p.flight === f));
  return participants.some(p => !p.flight) ? [...occupes, null] : occupes;
}

/** Le premier tour d'un flight où quelqu'un attend encore son verdict : là où
 *  reprend le plateau quand on passe à ce flight. Le premier tour s'il a fini. */
export function premierTourOuvert(participants: Passant[], flight: string | null, mouvements: string[], essais: number): { mouvement: number; essai: number } {
  for (let mouvement = 0; mouvement < mouvements.length; mouvement++) {
    for (let essai = 0; essai < essais; essai++) {
      if (ordreDuTour(participants, flight, mouvements[mouvement], essai).some(e => !e.juge)) return { mouvement, essai };
    }
  }
  return { mouvement: 0, essai: 0 };
}

/** LE PLANCHER D'UNE ANNONCE : la plus lourde charge annoncée aux essais
 *  précédents du même mouvement. On ne baisse pas (William, 24/09) — brokkr
 *  refuse en 422 `annonce_en_baisse` ; l'écran ne propose donc pas la charge. */
export function plancherDAnnonce(attempts: Pick<CompAttempt, 'weight'>[], attIdx: number): number {
  return attempts.slice(0, attIdx).reduce((max, a) => Math.max(max, a.weight || 0), 0);
}

type Classable = { score: number; ris?: number | null; flight?: string | null };

/** LE CLASSEMENT D'UN GROUPE, AU TOTAL (William, 24/09) : les athlètes d'un
 *  groupe se comparent en kilos, ils concourent dans des catégories voisines.
 *  `flight` nul désigne ceux qui ne sont dans aucun groupe. À total égal,
 *  l'ordre d'inscription. Rend les index dans l'ordre du classement. */
export function classementDuGroupe<P extends Classable>(participants: P[], flight: string | null): { p: P; i: number }[] {
  return participants.map((p, i) => ({ p, i }))
    .filter(({ p }) => (p.flight ?? null) === flight)
    .sort((a, b) => (b.p.score - a.p.score) || (a.i - b.i));
}

/** LE CLASSEMENT GÉNÉRAL, AU RIS (William, 24/09) : lui seul compare des
 *  catégories différentes. Le RIS est servi par brokkr (FRE-141). Un athlète
 *  sans RIS n'est pas dernier : il n'est pas classable, et vient après les
 *  classés, dans l'ordre d'inscription. */
export function classementAuRis<P extends Classable>(participants: P[]): { p: P; i: number }[] {
  const risOuRien = (p: P) => p.ris ?? Number.NEGATIVE_INFINITY;
  return participants.map((p, i) => ({ p, i }))
    .sort((a, b) => (risOuRien(b.p) - risOuRien(a.p)) || (a.i - b.i));
}
