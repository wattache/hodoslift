import type { SessionEditing, WeekEditing, ExerciseEditing } from "@/api/types";
import { rpeToNumber, verdictDesSemainesRPE, type VerdictRPE } from "@/lib/rpe";
import { afficherVariantes, cleVariantes } from "@/lib/variantes";
import { effectiveWeight, parseWeight } from "@/lib/weight";

export interface ProgressionPoint {
  label: string;
  sets: string;
  reps: string;
  repsDone: string;
  repsUnit: string;
  /** Charge PRESCRITE. */
  kg: number | null;
  /** Charge RÉELLEMENT soulevée, si l'athlète l'a saisie et qu'elle diffère.
   *  Séparée de `kg` pour pouvoir afficher « prescrit → réel », comme la ligne
   *  Reps le fait déjà avec repsDone. */
  kgDone: number | null;
  /** Réel sinon prescrit — ce que suivent la courbe et le delta du bloc : ils
   *  décrivent ce qui a été FAIT, pas ce qui était prévu. */
  kgEffective: number | null;
  /** Assistance (élastique, ex. « RB15 ») quand l'exercice n'est pas chargé —
   *  l'info de charge du jour est LÀ, pas dans `kg`. */
  assistance: string;
  /** Le repos PRESCRIT — sans lui, la ligne « Repos » ne peut montrer que le
   *  réel, jamais l'écart. C'est ce qui manquait : le tableau affichait
   *  « 1'45" » là où la consigne était « 2' », et l'information utile — avoir
   *  pris 15 s de moins — n'apparaissait nulle part (FRE-42). */
  rest: string;
  restActual: string;
  /** Variante et tempo de la semaine — ce qui, avec le nom, DÉSIGNE l'exercice.
   *  Un squat NEUTRE en 3010 et un squat en 10X0 ne se comparent pas, et
   *  l'historique de la BASE les montrait sous le même intitulé. Portés par le
   *  point et non par le créneau parce qu'ils peuvent changer d'une semaine à
   *  l'autre — rarement (0,1 % des créneaux de production, mesuré le 11/09),
   *  mais l'afficher au singulier inventerait une constance. */
  variante: string;
  tempo: string;
  rpe: number | null;   // numérique pour la courbe (Sub5→4.5, FAIL→10)
  rpeRaw: string;        // RPE réel (feltRPE) — libellé original (ex. "Sub5")
  aimedRpeRaw: string;   // RPE cible (aimedRPE) de la semaine, si précisé
  feedback: string;      // retour athlète de la semaine (pour afficher le plus récent)
}

/** Le verdict RPE d'un créneau (FRE-167) — la règle vit dans `@/lib/rpe`, que le
 *  tableau du bloc interroge aussi. Ici on ne fait que dire comment un
 *  `ProgressionPoint` se lit en semaine visée / ressentie. */
export function verdictRPE(points: ProgressionPoint[]): VerdictRPE {
  return verdictDesSemainesRPE(
    points.map(p => ({ cible: rpeToNumber(p.aimedRpeRaw), ressenti: p.rpe })),
  );
}

// Identité d'un exercice (nom + variante + tier) — pour le retrouver d'une
// semaine à l'autre PAR IDENTITÉ et non par position. Sinon, réordonner les
// exercices d'une semaine décale tout l'historique (l'exo en position i récupère
// l'historique de ce qui était en position i dans les autres semaines).
// `cleVariantes` et non l'affichage : la clé est TRIÉE, donc « DS + PAUSE » et
// « PAUSE + DS » désignent bien le même exercice (FRE-33).
const exKey = (e: ExerciseEditing | undefined): string =>
  `${(e?.name ?? "").trim().toLowerCase()}|${cleVariantes(e?.variant).toLowerCase()}|${e?.tier ?? ""}`;

export function buildExerciseProgressionPoints(session: SessionEditing, exerciseIndex: number, blockWeeks: WeekEditing[]): ProgressionPoint[] {
  const targetName = (session.name ?? "").trim().toLowerCase();
  const targetId = session.id ?? "";
  const targetEx = session.exercises[exerciseIndex];
  const targetKey = exKey(targetEx);
  // Sans nom, l'identité n'a pas de sens → on garde le repli par position.
  const hasIdentity = (targetEx?.name ?? "").trim() !== "";
  // Rang de cet exo parmi ceux de MÊME identité dans la séance (gère les doublons).
  const targetOcc = hasIdentity
    ? session.exercises.slice(0, exerciseIndex).filter((e) => exKey(e) === targetKey).length
    : 0;

  return blockWeeks.map((w) => {
    // Retrouve la séance équivalente : par nom (stable), sinon par id.
    const match =
      (w.sessions ?? []).find((s) => (s.name ?? "").trim().toLowerCase() === targetName && targetName !== "") ??
      (w.sessions ?? []).find((s) => (s.id ?? "") === targetId);
    // Puis l'exercice PAR IDENTITÉ (n-ième de même nom/variante/tier), pas par index.
    let ex: ExerciseEditing | undefined;
    if (match) {
      if (hasIdentity) {
        let seen = 0;
        ex = match.exercises.find((e) => exKey(e) === targetKey && seen++ === targetOcc);
      } else {
        ex = match.exercises[exerciseIndex];
      }
    }
    return {
      label: `S${w.weekNumber}`,
      sets: ex?.sets ?? "",
      reps: ex?.reps ?? "",
      repsDone: ex?.repsDone ?? "",
      repsUnit: ex?.repsUnit ?? "count",
      // `|| null` : absence de charge = trou dans la courbe, PAS un point à 0.
      kg: (ex && parseWeight(ex.weight)) || null,
      kgDone: (ex && parseWeight(ex.weightDone)) || null,
      kgEffective: (ex && effectiveWeight(ex)) || null,
      assistance: ex?.assistance ?? "",
      rest: ex?.rest ?? "",
      restActual: ex?.restActual ?? "",
      variante: afficherVariantes(ex?.variant),
      tempo: (ex?.tempo ?? "").trim(),
      rpe: rpeToNumber(ex?.feltRPE ?? ""),
      rpeRaw: ex?.feltRPE ?? "",
      aimedRpeRaw: ex?.aimedRPE ?? "",
      feedback: ex?.athleteFeedback ?? "",
    };
  });
}
