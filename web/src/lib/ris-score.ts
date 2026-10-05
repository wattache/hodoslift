// RIS — Relative Index for Streetlifting
//
// ⚠️ LE RIS EST SERVI PAR BROKKR, ET IL N'EST PLUS CALCULÉ ICI DU TOUT
// (FRE-92, puis FRE-141). `athlete.ris`, `participant.ris` : on lit, on affiche.
//
// ⚠️ CE FICHIER PORTAIT LE BARÈME EN DOUBLE, et sa raison d'être a disparu. Le
// second exemplaire servait à la PROJECTION LIVE — pendant une compétition, le
// classement suivait les essais avant enregistrement. Décision de William le
// 08/09 : « calculer le RIS pendant n'a pas de sens, il est connu seulement
// après le dernier squat ». Un classement qui frémit à chaque essai jugé
// n'informe personne.
//
// Sont partis avec : `computeRis`, ses constantes par genre, `totalDuBareme`, et
// la spec miroir de `brokkr/tests/test_ris.py`. Ce miroir n'avait de sens que
// tant qu'il y avait deux copies à tenir alignées ; il n'en reste qu'une, côté
// serveur, avec ses propres specs.
//
// Mesuré avant de retirer : 24 participants sur 8 compétitions, ZÉRO écart entre
// les deux calculs.

export type RisGender = 'M' | 'F';

/** Le RIS tel qu'il s'affiche — deux décimales, ou un tiret quand il n'existe
 *  pas.
 *
 *  ⚠️ `null` N'EST PAS ZÉRO, et c'est tout l'objet de cette fonction. Un athlète
 *  qu'on ne sait pas classer — poids ou genre manquant, aucun essai valide —
 *  n'est pas dernier du classement : il n'y figure pas. Afficher `0.00` le
 *  placerait en queue de peloton, ce qui est une information fausse. */
export function formatRis(ris: number | null): string {
  if (ris === null || !Number.isFinite(ris)) return '-';
  return ris.toFixed(2);
}
