import { describe, expect, it } from "vitest";

import { verdictRPE, type ProgressionPoint } from "./exercise-progression-data";
import { rpeToNumber } from "@/lib/rpe";

/** Le verdict RPE de l'historique replié (FRE-167).
 *
 *  ⚠️ CE QUE CES SPECS GARDENT, c'est le TROISIÈME rendu. Deux états — tenu /
 *  dépassé — se seraient écrits naturellement, et auraient répondu « RPE tenu »
 *  sur un bloc où AUCUNE semaine ne porte de cible : une affirmation que la
 *  donnée ne fait pas. Vues rouges en repliant `cible: false` sur
 *  `{ cible: true, depassements: 0 }`. */

const point = (aimedRPE: string, feltRPE: string): ProgressionPoint => ({
  label: "S1", sets: "", reps: "", repsDone: "", repsUnit: "count",
  kg: null, kgDone: null, kgEffective: null, assistance: "",
  rest: "", restActual: "", variante: "", tempo: "",
  rpe: rpeToNumber(feltRPE), rpeRaw: feltRPE, aimedRpeRaw: aimedRPE, feedback: "",
});

describe("verdictRPE", () => {
  it("ne conclut rien quand aucune semaine ne porte de cible", () => {
    expect(verdictRPE([point("", "8"), point("", "9")])).toEqual({ cible: false });
  });

  it("ne conclut rien non plus quand il n'y a aucune semaine", () => {
    expect(verdictRPE([])).toEqual({ cible: false });
  });

  // Le ressenti sans cible ne peut pas être « dépassé » : il n'y a rien à dépasser.
  it("ignore les semaines sans cible dans le compte", () => {
    expect(verdictRPE([point("8", "8"), point("", "10"), point("8", "9")]))
      .toEqual({ cible: true, depassements: 1 });
  });

  it("compte tenu quand le ressenti reste sous la cible ou l'égale", () => {
    expect(verdictRPE([point("8", "7"), point("8", "8")]))
      .toEqual({ cible: true, depassements: 0 });
  });

  // Une cible posée mais aucun ressenti saisi : le bloc a une cible, donc on ne
  // répond pas « sans cible » — et rien ne la dépasse.
  it("reste à zéro dépassement quand le ressenti manque", () => {
    expect(verdictRPE([point("8", ""), point("8", "")]))
      .toEqual({ cible: true, depassements: 0 });
  });

  // `rpe` porte FAIL→10 (cf. rpeToNumber) : un échec dépasse toute cible < 10.
  it("compte un FAIL comme un dépassement", () => {
    expect(verdictRPE([point("8", "FAIL")])).toEqual({ cible: true, depassements: 1 });
  });
});
