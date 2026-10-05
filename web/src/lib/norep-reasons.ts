import i18n from '@/i18n';

// Raisons d'invalidation d'une répétition en compétition, basées sur le
// règlement FNSL (sections 10.1 "Validation" et 11.1-11.4 "Critères de
// jugement / validation").
//
// Chaque mouvement a sa liste : on commence par "Ne sait pas" (= juges n'ont
// pas encore tranché, ou coach n'a pas la réponse). Ensuite les raisons
// spécifiques au mouvement, puis les raisons communes (timing, ordres,
// position finale), et enfin "Autre" en fallback.
//
// `auto: true` marque les fautes qui invalident automatiquement (3 cartons
// rouges) selon section 10.1 du règlement — affiché avec un ⚠ dans l'UI.

export interface NorepReason {
  id: string;
  auto?: boolean;
}

/** Libellé traduit d'un motif. L'ID est la CLÉ — c'est lui qui est stocké en
 *  base et validé par brokkr (table `norep_reasons`) ; seul l'affichage change
 *  de langue. Ne jamais persister le libellé. */
export function norepLabel(id: string): string {
  return i18n.t(`norep.${id}`);
}

const UNKNOWN: NorepReason = { id: 'unknown' };
// Échec physique — l'athlète n'a pas pu compléter le mouvement. C'est le cas
// le plus fréquent sur un essai max, donc placé en tête de liste après UNKNOWN.
const TOO_HEAVY: NorepReason = { id: 'too_heavy' };
const OTHER: NorepReason = { id: 'other' };

// Raisons communes à tous les mouvements (timing, signal, ordres).
const COMMON_REASONS: NorepReason[] = [
  { id: 'early_start' },
  { id: 'time_exceeded' },
  { id: 'order_violation', auto: true },
  { id: 'no_box_signal' },
];

// Spécifique Muscle-Up (FNSL 11.1)
const MUSCLE_UP_REASONS: NorepReason[] = [
  { id: 'mu_elbows_not_simultaneous', auto: true },
  { id: 'mu_elbow_drop' },
  { id: 'mu_kipping' },
  { id: 'mu_false_grip' },
  { id: 'mu_no_full_lock' },
  { id: 'mu_grip_width_changed' },
];

// Spécifique Traction / Pull-up / Chin-up (FNSL 11.2)
const TRACTION_REASONS: NorepReason[] = [
  { id: 'pu_chin_below_bar', auto: true },
  { id: 'pu_mixed_grip' },
  { id: 'pu_rebound' },
  { id: 'pu_concentric_descent' },
  { id: 'pu_kipping' },
];

// Spécifique Dips (FNSL 11.3)
const DIPS_REASONS: NorepReason[] = [
  { id: 'd_amplitude_shoulder' },
  { id: 'd_amplitude_hip' },
  { id: 'd_concentric_descent' },
  { id: 'd_no_leg_contact' },
  { id: 'd_final_not_locked' },
  { id: 'd_final_unstable' },
];

// Spécifique Squat (FNSL 11.4)
const SQUAT_REASONS: NorepReason[] = [
  { id: 's_depth' },
  { id: 's_concentric_descent' },
  { id: 's_foot_displacement' },
  { id: 's_knees_not_locked' },
  { id: 's_torso_break' },
  { id: 's_low_bar_exaggerated' },
  { id: 's_descent_pause' },
  { id: 's_final_unstable' },
];

const REASONS_BY_MOVEMENT: Record<string, NorepReason[]> = {
  'MUSCLE UP': [UNKNOWN, TOO_HEAVY, ...MUSCLE_UP_REASONS, ...COMMON_REASONS, OTHER],
  'PULL UP':   [UNKNOWN, TOO_HEAVY, ...TRACTION_REASONS, ...COMMON_REASONS, OTHER],
  'CHIN UP':   [UNKNOWN, TOO_HEAVY, ...TRACTION_REASONS, ...COMMON_REASONS, OTHER],
  'DIPS':      [UNKNOWN, TOO_HEAVY, ...DIPS_REASONS, ...COMMON_REASONS, OTHER],
  'SQUAT':     [UNKNOWN, TOO_HEAVY, ...SQUAT_REASONS, ...COMMON_REASONS, OTHER],
};

const FALLBACK_REASONS: NorepReason[] = [UNKNOWN, TOO_HEAVY, ...COMMON_REASONS, OTHER];

/** Liste des raisons d'invalidation pour un mouvement donné. Fallback générique
 *  si le mouvement n'est pas dans la liste FNSL (ex: mouvement custom). */
export function getNorepReasons(movementName: string): NorepReason[] {
  return REASONS_BY_MOVEMENT[movementName.toUpperCase()] || FALLBACK_REASONS;
}

/** Libellé human-readable d'une raison (utile pour affichage hors dropdown). */

