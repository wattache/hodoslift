import { valeurChiffree, type RangeeDuTableau } from '@/lib/bloc-tableau';
import { rpeToNumber, type SemaineRPE } from '@/lib/rpe';

/** LA GÉOMÉTRIE DES PISTES DU TABLEAU DU BLOC — FRE-114.
 *
 *  ⚠️ UN MODULE À PART, ET PAS PAR GOÛT DU RANGEMENT. Ces quatre fonctions
 *  vivaient dans la vue, d'où il fallait les exporter pour les éprouver — ce que
 *  le lint refuse à juste titre (un fichier de composants qui exporte autre chose
 *  casse le rafraîchissement à chaud). Elles ne touchent ni au DOM ni à React :
 *  leur place est ici, où une spec les atteint sans monter quoi que ce soit.
 *
 *  ⚠️ ET PAS DANS `bloc-tableau.ts`, qui porte la DÉRIVATION — ce que le bloc
 *  dit. Ici c'est la projection — où le dire à l'écran. Les mélanger rendrait la
 *  dérivation dépendante d'une décision d'affichage.
 */

/** ⚠️ LA CHARGE SE TRACE MÊME QUAND LA RANGÉE EST « PILOTÉE AU RPE ». C'est ce
 *  que `courbeDeRangee` ne pouvait pas rendre : elle choisit UNE grandeur, et sur
 *  ROWING — trois semaines à RPE visé, quatre charges saisies — elle rendait le
 *  RPE, si bien que les 80/85/85/80 affichés dans les cases n'avaient aucun
 *  tracé. Les deux pistes existent maintenant séparément ; la question « quelle
 *  grandeur pilote » ne se pose plus à l'affichage. */
export function chargesDeRangee(rangee: RangeeDuTableau): (number | null)[] {
  return rangee.cellules.map(({ ligne }) => {
    if (!ligne) return null;
    // ⚠️ `valeurChiffree` ET NON `parseWeight`, ET C'EST UN DÉFAUT QUE J'AI
    // ÉCRIT AVANT DE LE VOIR À L'ÉCRAN. `parseWeight` replie `''` et `'0'` sur
    // le même 0, si bien que `|| null` effaçait de la piste les 461 lignes de
    // production portant une charge à zéro — le défaut que ce dépôt nomme en
    // premier, `''` contre `NULL`, commis sur l'écran qui prétend rendre les
    // absences visibles.
    // Réel sinon prescrit : la courbe décrit ce qui a été FAIT.
    return valeurChiffree(ligne.weightDone) ?? valeurChiffree(ligne.weight);
  });
}

/** Les deux séries du couloir : ce qui était visé, ce qui a été ressenti. */
export function rpeDeRangee(rangee: RangeeDuTableau): SemaineRPE[] {
  return rangee.cellules.map(({ ligne }) => ({
    cible: ligne ? rpeToNumber((ligne.aimedRPE ?? '').trim()) : null,
    ressenti: ligne ? rpeToNumber((ligne.feltRPE ?? '').trim()) : null,
  }));
}

/** ⚠️ LES POINTS TOMBENT AU CENTRE DES COLONNES, PAS À LEURS BORDS. La piste
 *  couvre exactement les n colonnes de valeurs, dont le contenu est centré : un
 *  premier point à x=0 se retrouverait sous la marge gauche de S1, et la ligne
 *  décrirait des semaines décalées d'une demi-colonne. */
export const cx = (i: number, n: number): number => ((i + 0.5) / n) * 100;

/** ⚠️ UN PLANCHER DE HAUTEUR, ET C'EST UN CHOIX ASSUMÉ. À l'échelle strictement
 *  proportionnelle, 6,25 → 13,75 kg sur une rangée et 27,5 → 42,5 sur une autre
 *  ne seraient plus comparables d'un coup d'œil. La piste dit le RAPPORT ;
 *  l'amplitude écrite sous le nom du mouvement dit la VALEUR. Supprimer l'une ou
 *  l'autre rend le tracé menteur. */
export const yLocal = (v: number, min: number, max: number): number =>
  max === min ? 50 : 88 - ((v - min) / (max - min)) * 76;

/** Les suites CONTIGUËS de valeurs connues. Une semaine sans valeur ne relie pas
 *  ses voisines : le trou est l'information (FRE-150), le combler en tirant un
 *  segment par-dessus l'effacerait. Une suite d'un seul point ne donne pas de
 *  polyligne — seulement sa pastille. */
export function suitesContigues(points: (number | null)[]): number[][] {
  const out: number[][] = [];
  let courante: number[] = [];
  points.forEach((v, i) => {
    if (v === null) {
      if (courante.length) out.push(courante);
      courante = [];
    } else courante.push(i);
  });
  if (courante.length) out.push(courante);
  return out;
}

/** LES QUADRILATÈRES DE DÉPASSEMENT — l'aplat entre la cible et le ressenti,
 *  intervalle par intervalle, COUPÉ au point de croisement exact.
 *
 *  ⚠️ EXPORTÉE POUR ÊTRE ÉPROUVÉE, et c'est la seule raison. C'est le calcul le
 *  plus subtil de l'écran, et le seul dont une erreur se voit mal : un aplat qui
 *  déborde de quelques pixels sur la partie tenue ressemble à un aplat correct,
 *  et il affirme pourtant un dépassement qui n'a pas eu lieu — la même invention
 *  qu'un « PDC » posé sur une charge vide.
 *
 *  ⚠️ LE CROISEMENT SE CALCULE SUR L'ÉCART, PAS SUR LES ORDONNÉES. `t` est le
 *  paramètre où `r - c` s'annule ; l'interpoler sur des `y` déjà projetés
 *  donnerait le même point tant que la projection est affine, mais cesserait
 *  d'être vrai à la première échelle non linéaire. On tranche donc dans les
 *  valeurs, et on projette après. */
export function aplatsDeDepassement(
  cibles: (number | null)[],
  reels: (number | null)[],
  y: (v: number) => number,
): string[] {
  const n = cibles.length;
  const quads: string[] = [];
  for (let i = 0; i < n - 1; i++) {
    const c0 = cibles[i], c1 = cibles[i + 1], r0 = reels[i], r1 = reels[i + 1];
    if (c0 == null || c1 == null || r0 == null || r1 == null) continue;
    const d0 = r0 - c0, d1 = r1 - c1;
    // ⚠️ `<= 0` DES DEUX CÔTÉS : un ressenti ÉGAL à la cible n'est pas un
    // dépassement, et un aplat d'épaisseur nulle laisserait tout de même un
    // trait dans le rendu.
    if (d0 <= 0 && d1 <= 0) continue;
    let x0 = cx(i, n), x1 = cx(i + 1, n);
    let yc0 = y(c0), yc1 = y(c1), yr0 = y(r0), yr1 = y(r1);
    if (d0 < 0 || d1 < 0) {
      const t = d0 / (d0 - d1);
      const xi = x0 + (x1 - x0) * t;
      const yi = yc0 + (yc1 - yc0) * t;
      // Du côté tenu, les deux bords se rejoignent : l'aplat part d'une pointe.
      if (d0 < 0) { x0 = xi; yc0 = yi; yr0 = yi; }
      else { x1 = xi; yc1 = yi; yr1 = yi; }
    }
    quads.push(`${x0},${yc0} ${x1},${yc1} ${x1},${yr1} ${x0},${yr0}`);
  }
  return quads;
}
