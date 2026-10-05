/** LE VERDICT D'UN ESSAI, ET CE QUI TOMBE AVEC LUI (FRE-139).
 *
 *  ⚠️ LE SCÉNARIO EST RÉEL ET IL SE JOUE EN DIRECT. Le juge dit NO REP, le coach
 *  choisit un motif, la VAR renverse, le coach re-clique. Le résultat partait,
 *  `norepReason` RESTAIT — le `<select>` se contentait de se cacher. Le serveur
 *  refuse alors le PUT ENTIER de la compétition en 422 (`motif_exige_un_echec`,
 *  et la base a le même `CHECK`), donc plus rien ne s'enregistre pour cette
 *  compétition tant que le motif fantôme n'est pas retiré — et l'écran ne le
 *  montre plus. Un jour de compétition, ça veut dire que la feuille de match
 *  cesse d'être sauvegardée sans que personne ne comprenne pourquoi.
 *
 *  ⚠️ ET LE BOUTON **REP** AVAIT LE MÊME DÉFAUT, que le ticket n'avait pas vu :
 *  passer de `norep` à `rep` conservait le motif tout autant, et déclenche le
 *  même refus. Quatre boutons portaient la faute — REP et NO REP, dans la grille
 *  et dans le mode live —, ce qui est précisément la raison d'écrire la règle
 *  UNE fois ici plutôt que quatre fois dans le JSX.
 *
 *  ⚠️ MAIS `varUsed` NE SUIT PAS LA MÊME RÈGLE, et c'est vérifié côté serveur :
 *  `norep_reason` porte un `CHECK`, `var_used` n'en a AUCUN. La case reste
 *  d'ailleurs affichée sur un `rep` — « la VAR a été consultée, et elle a validé »
 *  est un fait vrai, et le plus intéressant des deux. On ne l'efface donc que
 *  lorsque l'essai redevient NON JUGÉ, où plus rien ne s'affiche.
 */

export interface EssaiJuge {
  result: 'rep' | 'norep' | '';
  norepReason?: string;
  varUsed?: boolean;
}

/** L'essai après un clic sur REP ou NO REP — bascule comprise.
 *
 *  Re-cliquer le verdict courant l'efface : c'est la façon de dire « je me suis
 *  trompé, cet essai n'a pas encore été jugé ». */
export function verdictBascule<T extends EssaiJuge>(essai: T, verdict: 'rep' | 'norep'): T {
  return appliquerVerdict(essai, essai.result === verdict ? '' : verdict);
}

/** L'essai porté à ce verdict, débarrassé de ce qui n'a plus de sens.
 *
 *  ⚠️ `undefined` ET NON UNE CHAÎNE VIDE pour le motif : la colonne est
 *  `norep_reason text REFERENCES norep_reasons(id)`, et `''` n'est pas un id de
 *  motif — il partirait en violation de clé étrangère au lieu de dire « aucun ».
 *  C'est la distinction vide/NULL du projet, à la frontière de l'écriture. */
export function appliquerVerdict<T extends EssaiJuge>(
  essai: T, verdict: 'rep' | 'norep' | '',
): T {
  return {
    ...essai,
    result: verdict,
    norepReason: verdict === 'norep' ? essai.norepReason : undefined,
    varUsed: verdict === '' ? undefined : essai.varUsed,
  };
}
