/** LES RECORDS DE COMPÉTITION — ce qui reste de l'ancien fichier de sélecteurs.
 *
 *  ⚠️ `computeRepPRMatrix` A QUITTÉ CE FICHIER LE 26/08 pour brokkr
 *  (`app/records.py`, FRE-71 §9). Il parcourait l'arbre d'entraînement entier
 *  dans le navigateur — jusqu'à 838 lignes — pour remplir une grille de 50
 *  cases, et il portait avec lui une SECONDE définition de « réalisé ».
 *  `estRealise` a disparu avec lui : la règle n'existe plus qu'une fois, en SQL.
 *
 *  ⚠️ ET DEUX EXPORTS MORTS SONT PARTIS AU PASSAGE : `computeAvgFeltRPE` et
 *  `effectiveOneRM` n'avaient AUCUN appelant dans tout le front. Ils n'ont pas
 *  été déplacés, ils ont été supprimés — c'est le genre de chose qu'on découvre
 *  en cherchant ce qui dépend de quoi avant de déménager.
 *
 *  Ce qui reste lit les COMPÉTITIONS, pas l'entraînement : un autre gisement,
 *  qui n'a pas de projection analytique et se lit très bien ici. */
import type { Competition } from "@/api/types";
import type { PrincipalMovement } from "@/lib/constants";
import { PRINCIPAL_MOVEMENTS } from "@/lib/constants";

export interface CompetitionPR {
  weight: number;
  reps: 1;
  movement: PrincipalMovement;
  compName: string;
  location: string;
  date?: string;
}


/** For each movement × reps (1-10), find the heaviest successful lift. */
function normalized(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Best 1-rep PRs per movement from a selected athlete's competition results. */
export function computeCompetitionPRs(
  competitions: Competition[],
  athleteUids: Array<string | null | undefined> = [],
  athleteName?: string,
): Partial<Record<PrincipalMovement, CompetitionPR>> {
  const out: Partial<Record<PrincipalMovement, CompetitionPR>> = {};
  const uidSet = new Set(athleteUids.filter((uid): uid is string => !!uid));
  const normalizedName = normalized(athleteName);

  for (const comp of competitions) {
    const participant = comp.participants.find((p) => {
      if (p.uid && uidSet.has(p.uid)) return true;
      return !!normalizedName && normalized(p.name) === normalizedName;
    });
    if (!participant) continue;

    for (const movementResult of participant.movements) {
      if (!(PRINCIPAL_MOVEMENTS as readonly string[]).includes(movementResult.name)) continue;
      const movement = movementResult.name as PrincipalMovement;
      const bestWeight = movementResult.attempts
        .filter((attempt) => attempt.result === "rep")
        .reduce((max, attempt) => Math.max(max, attempt.weight), 0);
      if (bestWeight <= 0) continue;

      const existing = out[movement];
      if (!existing || bestWeight > existing.weight) {
        out[movement] = {
          weight: bestWeight,
          reps: 1,
          movement,
          compName: comp.name,
          location: comp.name,
          date: comp.date,
        };
      }
    }
  }

  return out;
}




