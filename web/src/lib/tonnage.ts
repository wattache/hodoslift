import type { ExerciseEditing, SessionEditing } from '@/api/types';
import { isTraining } from "@/lib/exercise-kind";
import { effectiveWeight } from "@/lib/weight";

export function exerciseTonnage(ex: ExerciseEditing): number {
  // Un échauffement ou une ligne de kiné DÉPLACE une charge — un band pull
  // apart à 5 kg, ce sont bien 5 kg. Mais ce n'est pas du volume
  // d'entraînement, et brokkr les exclut déjà de ses agrégats (FRE-10) : les
  // compter ici ferait dire à l'app le contraire du Tracking, exactement le
  // symptôme que FRE-20 a coûté à réparer.
  if (!isTraining(ex)) return 0;
  if (ex.repsUnit === "sec") return 0;
  // ⚠️ `?? ''` : une prescription absente n'est pas un tonnage nul, et
  // `parseInt(null)` rendrait `NaN` — que le `if` plus bas attrape, mais par
  // accident. On dit l'absence explicitement.
  const sets = parseInt(ex.sets ?? '', 10);
  const reps = parseInt(ex.reps ?? '', 10);
  // Tonnage = ce qui a été SOULEVÉ : la charge réelle prime quand elle existe.
  const weight = effectiveWeight(ex);
  if (!sets || !reps || !weight) return 0;
  return sets * reps * weight;
}

export function sessionTonnage(s: SessionEditing): number {
  return s.exercises.reduce((t, ex) => t + exerciseTonnage(ex), 0);
}



export function formatKg(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg)} kg`;
}
