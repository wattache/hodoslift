import type { CyclePhase } from '@/api/types';

/** LES PHASES DU CYCLE — le vocabulaire, une couleur, un libellé (FRE-173).
 *
 *  Une phase est un FAIT DU JOUR, saisi par l'athlète seule dans le Tracker et
 *  lu en FOND du graphe journalier — c'est la seule question que cette donnée
 *  sert à poser : « mon poids, mon sommeil, ma forme, avec la phase derrière ».
 *
 *  ⚠️ `CyclePhase` VIENT DU CONTRAT, jamais recopié : une phase ajoutée côté
 *  serveur casse ce `Record` à la compilation au lieu de disparaître de l'écran.
 *
 *  Les couleurs sont celles que le calendrier utilisait avant le déplacement —
 *  on ne réinvente pas un code que les athlètes ont déjà vu. */
export const PHASES: readonly { value: CyclePhase; labelKey: string; color: string }[] = [
  { value: 'menstruation', labelKey: 'cycle.menstruation', color: '#DC2626' },
  { value: 'follicular',   labelKey: 'cycle.follicular',   color: '#2563EB' },
  { value: 'ovulation',    labelKey: 'cycle.ovulation',    color: '#EAB308' },
  { value: 'luteal',       labelKey: 'cycle.luteal',       color: '#8B5CF6' },
];

const _TOUTES: Record<CyclePhase, true> = { menstruation: true, follicular: true, ovulation: true, luteal: true };
void _TOUTES;

export const couleurDePhase = (phase: CyclePhase): string =>
  PHASES.find(p => p.value === phase)?.color ?? 'transparent';
