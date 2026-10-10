import type { Flight } from '@/api/types';
import type { Reglement } from '@/lib/norep-reasons';
import type { RisGender } from '@/lib/ris-score';

export type Tier = 'pessimistic' | 'realistic' | 'optimistic';

export interface Attempt {
  weight: number;
  result: 'rep' | 'norep' | '';
  weights?: { pessimistic: number; realistic: number; optimistic: number };
  selectedTier?: Tier | null;
  norepReason?: string;
  varUsed?: boolean;
}

export interface Movement { name: string; attempts: Attempt[] }

export interface Participant {
  name: string; uid?: string; bodyweight?: number; gender?: RisGender;
  weightCategory?: string; movements: Movement[]; score: number;
  /** ⚠️ SERVI PAR BROKKR (FRE-141). `null` quand il ne peut pas l'être — poids
   *  ou genre manquant, aucun essai valide. */
  ris?: number | null;
  /** ⚠️ SERVIE PAR BROKKR (FRE-203) : les totaux vers lesquels l'athlète se
   *  dirige selon les trois hypothèses du plan. Absente d'un participant qui
   *  vient d'être ajouté, le temps que la feuille s'enregistre. */
  projection?: { pessimistic: number; realistic: number; optimistic: number };
  /** Jour de passage — utile seulement sur une compét multi-jours. */
  competesOn?: string;
  /** Le groupe de passage (FRE-204), DÉDUIT par brokkr de la catégorie : il ne
   *  se saisit pas et ne repart pas à l'écriture. */
  flight?: string;
}

export interface Comp {
  id: string; name: string; location?: string;
  /** `date` = compat (égal à startDate) ; startDate/endDate font foi. */
  date: string; startDate?: string; endDate?: string;
  maxAttempts: number; movementNames: string[]; participants: Participant[];
  flights?: Flight[];
  /** Le règlement qui juge (FNSL par défaut) : il choisit les motifs de « no rep ». */
  reglement?: Reglement;
}

/** Un essai repéré par ses index : participant, mouvement CHEZ l'athlète, essai.
 *  ⚠️ L'index du mouvement est celui de `participant.movements`, pas celui de la
 *  compétition : un athlète n'a que les mouvements où il a des essais. */
export type SetAttempt = (pi: number, mi: number, ai: number, attempt: Attempt) => void;
