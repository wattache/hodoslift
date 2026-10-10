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

/** Le règlement sous lequel une compétition se juge : il choisit la liste des
 *  motifs. La valeur est celle de `competitions.reglement` côté brokkr. */
export type Reglement = 'fnsl' | 'finalrep';
export const REGLEMENTS: Reglement[] = ['fnsl', 'finalrep'];
export function reglementLabel(r: Reglement): string {
  return i18n.t(`reglement.${r}`);
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

// FINALREP (rulebook VI 26.2, § 6.2-6.6 « Reasons for an invalid … »). Pas de
// carton automatique : tout motif vaut `no rep` au 3:0 (sauf profondeur épaule
// aux dips, genoux fléchis et profondeur au squat, jugés à la majorité). Les
// identifiants portent `fr_` et vivent dans `norep_reasons` comme les autres.
const FR = (id: string): NorepReason => ({ id: `fr_${id}` });
const FR_FAIL = FR('fail');
const FR_SIGNAL = FR('signal');
// Bar et ring muscle up confondus : nos compétitions ne distinguent pas l'agrès.
const FR_MUSCLE_UP: NorepReason[] = [FR('false_grip'), FR('bent_arms'), FR('kipping'), FR('loss_of_control'),
  FR('downward_motion'), FR('downward_motion_ssc'), FR('lockout'), FR('chicken_wing')];
const FR_PULL: NorepReason[] = [FR('bent_arms'), FR('kipping'), FR('downward_motion'), FR('downward_motion_ssc')];
const FR_DIP: NorepReason[] = [FR('bent_arms'), FR('depth_shoulder'), FR('depth_hip'), FR('kipping'),
  FR('loss_of_control'), FR('downward_motion')];
const FR_SQUAT: NorepReason[] = [FR('bent_knees'), FR('downward_motion'), FR('depth'), FR('foot_movement'),
  FR('spotter_contact'), FR('support'), FR('dropping_bar')];
const FR_BY_MOVEMENT: Record<string, NorepReason[]> = {
  'MUSCLE UP': [UNKNOWN, FR_FAIL, ...FR_MUSCLE_UP, FR_SIGNAL, OTHER],
  'PULL UP':   [UNKNOWN, FR_FAIL, ...FR_PULL, FR_SIGNAL, OTHER],
  'CHIN UP':   [UNKNOWN, FR_FAIL, ...FR_PULL, FR_SIGNAL, OTHER],
  'DIPS':      [UNKNOWN, FR_FAIL, ...FR_DIP, FR_SIGNAL, OTHER],
  'SQUAT':     [UNKNOWN, FR_FAIL, ...FR_SQUAT, FR_SIGNAL, OTHER],
};
const FR_FALLBACK: NorepReason[] = [UNKNOWN, FR_FAIL, FR_SIGNAL, OTHER];

/** Les motifs d'invalidation d'un mouvement, sous un règlement. Repli générique
 *  si le mouvement n'est pas dans la liste (ex : mouvement libre). */
export function getNorepReasons(movementName: string, reglement: Reglement = 'fnsl'): NorepReason[] {
  const nom = movementName.toUpperCase();
  if (reglement === 'finalrep') return FR_BY_MOVEMENT[nom] || FR_FALLBACK;
  return REASONS_BY_MOVEMENT[nom] || FALLBACK_REASONS;
}

/** Libellé human-readable d'une raison (utile pour affichage hors dropdown). */

