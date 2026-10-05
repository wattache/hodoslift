/** LA MOYENNE D'UN RÉALISÉ SAISI SÉRIE PAR SÉRIE — répétitions et charge.
 *
 *  ⚠️ SÉPARÉE DE `feltRPEFromSets`, ET CE N'EST PAS UNE DUPLICATION. Le RPE a
 *  deux règles qui n'appartiennent qu'à lui : `FAIL` est ABSORBANT (une série
 *  ratée rate le format entier), et la moyenne s'arrondit au demi-point
 *  SUPÉRIEUR parce que l'échelle ne connaît que les demis. Des répétitions et
 *  des kilos n'ont ni l'un ni l'autre — les faire passer par la fonction du RPE
 *  aurait transformé « 10, 11, 12 » en « 11 » par un arrondi qui n'a pas lieu
 *  d'être, et pire, aurait plafonné toute charge au-dessus de 10.
 *
 *  ⚠️ ET ELLE NE SERT QU'À L'AFFICHAGE. Le TONNAGE se calcule côté serveur comme
 *  une somme de produits, jamais comme un produit de moyennes — dès que la
 *  charge varie d'une série à l'autre les deux divergent :
 *
 *      2 séries : 10 reps @ 100 kg, puis 5 @ 50 kg
 *      somme des produits   10×100 + 5×50 = 1 250 kg   ← le vrai
 *      produit des moyennes  2 × 7,5 × 75 = 1 125 kg   ← faux de 10 %
 *
 *  La moyenne d'ici remplit `repsDone` / `weightDone`, qui restent ce que TOUT
 *  le reste de l'app affiche : le tableau du coach, l'Aperçu, les images de
 *  partage. C'est ce qui permet d'ajouter la saisie par série sans toucher à un
 *  seul écran de lecture.
 */

/** Les entrées réellement notées, dans l'ordre. Une série laissée vide au milieu
 *  n'est pas une série à zéro : elle n'a simplement pas été renseignée, et ne
 *  doit peser sur aucune moyenne. */
function notees(bySet: readonly string[]): number[] {
  return bySet
    .map(v => (v ?? '').trim())
    .filter(Boolean)
    // ⚠️ LA VIRGULE DÉCIMALE EST LA NORME DE SAISIE ICI. La production porte
    // « 20,4 », « 17,5 », « 12,5 » — `parseFloat('20,4')` rend 20, et le poids
    // se serait perdu en silence à chaque demi-kilo.
    .map(v => parseFloat(v.replace(',', '.')))
    .filter(n => !Number.isNaN(n));
}

/** La moyenne des séries notées, prête à afficher.
 *
 *  Rend `''` quand rien n'est noté — et pas `'0'`, qui se lirait « il a fait
 *  zéro » là où il faut lire « il n'a rien dit ». C'est le [[vide_contre_null]]
 *  du projet, à la frontière de l'affichage.
 *
 *  ⚠️ AU PLUS UNE DÉCIMALE, ET SANS ZÉRO INUTILE. « 10, 11, 12 » rend « 11 » et
 *  non « 11.0 » ; « 10, 11 » rend « 10.5 ». Trois séries à 10, 11 et 11 donnent
 *  10,666… : l'afficher entier mentirait sur l'écart, l'afficher en entier de
 *  flottant remplirait la cellule. */
export function moyenneDesSeries(bySet: readonly string[] | null | undefined): string {
  const nums = notees(bySet ?? []);
  if (nums.length === 0) return '';
  const moyenne = nums.reduce((a, b) => a + b, 0) / nums.length;
  return String(Math.round(moyenne * 10) / 10);
}

/** Le tableau d'une ligne, en tenant compte de l'ancienne saisie scalaire.
 *
 *  ⚠️ LE SCALAIRE HÉRITÉ EST LA SÉRIE 1, exactement comme pour le RPE. Sans ça,
 *  ouvrir « par série » sur une ligne déjà remplie effacerait visuellement ce
 *  que l'athlète avait saisi — il le retaperait, ou pire, croirait l'avoir
 *  perdu. */
export function seriesDeLaLigne(
  bySet: readonly string[] | null | undefined,
  scalaire: string | null | undefined,
): string[] {
  if (Array.isArray(bySet) && bySet.length > 0) return [...bySet];
  const seul = (scalaire ?? '').trim();
  return seul ? [seul] : [];
}

/** COMBIEN DE SÉRIES SONT VRAIMENT NOTÉES, sur celles que la ligne prescrit.
 *
 *  ⚠️ CE COMPTEUR EXISTE PARCE QUE LE TROU EST MUET (FRE-156). Une ligne passée
 *  « par série » et remplie à moitié ne dit rien à personne : avant, la série
 *  manquante empruntait la MOYENNE des autres et fabriquait un record qui n'a
 *  pas eu lieu ; depuis FRE-156 elle ne produit plus rien du tout. Dans les deux
 *  cas l'athlète ignore qu'il lui manque une case. Sept lignes de production
 *  sont dans cet état.
 *
 *  ⚠️ ET UNE VALEUR GLOBALE N'EST PAS UN TROU — c'est la moitié délicate. Un
 *  athlète qui note « 8 répétitions » une fois pour trois séries à charges
 *  différentes a tout dit : 24 lignes de production font exactement ça, et le
 *  serveur les lit correctement (`records.py`). On ne regarde donc QUE les
 *  tableaux réellement ouverts par série, jamais un scalaire promu en tableau
 *  d'un élément par `seriesDeLaLigne`.
 *
 *  La règle est celle du serveur, énoncée par William le 09/09 : « soit
 *  l'athlète remplit au global et on prend ces infos, soit il commence à remplir
 *  par série et seules les séries remplies comptent ». Une série compte donc si
 *  CHAQUE tableau ouvert porte une valeur à sa position.
 *
 *  Rend `null` quand aucun tableau n'est ouvert : il n'y a alors rien à
 *  compléter, et afficher « 0/4 » à l'ouverture du pli serait un reproche fait à
 *  quelqu'un qui n'a pas encore commencé. */
export function seriesRenseignees(
  tableaux: readonly (readonly string[] | null | undefined)[],
  nbSeries: number,
): { notees: number; attendues: number } | null {
  const ouverts = tableaux.filter(
    (t): t is readonly string[] => Array.isArray(t) && t.some(v => (v ?? '').trim() !== ''));
  if (ouverts.length === 0 || !Number.isFinite(nbSeries) || nbSeries < 1) return null;
  let notees = 0;
  for (let i = 0; i < nbSeries; i++) {
    if (ouverts.every(t => ((t[i] ?? '').trim() !== ''))) notees += 1;
  }
  return { notees, attendues: nbSeries };
}
