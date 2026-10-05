/** L'ÉCHELLE D'INTENSITÉ D'UNE DOULEUR — couleur et mot, en un seul endroit.
 *
 *  ⚠️ UNE SEULE DÉFINITION, PARCE QUE TROIS ÉCRANS LA LISENT : la figure colore
 *  le muscle, la carte colore sa pastille et sa jauge, le sélecteur colore ses
 *  onze boutons. Trois tables de couleurs finiraient par diverger, et deux
 *  écrans diraient deux choses du même 6/10 — c'est la règle dupliquée que ce
 *  dépôt interdit.
 *
 *  ⚠️ `0` EST UNE VALEUR, PAS UN VIDE. « Pas mal » est une réponse que
 *  l'athlète donne, et elle est verte : la confondre avec « pas noté »
 *  effacerait la seule bonne nouvelle que cet écran sache afficher.
 *
 *  ⚠️ ET IL SE DIT « PAS MAL », PAS « PLUS MAL » : le second suppose qu'on
 *  avait mal avant. C'est faux le jour où l'on déclare une douleur en la
 *  notant 0 — et c'est le cas d'Aghiles, dont la première note est un zéro.
 */

/** Les seuils, du plus bas au plus haut. Le premier dont `max` couvre la valeur
 *  gagne — donc l'ordre compte, et il est croissant. */
const PALIERS = [
  { max: 0, couleur: '#7FA58C', cle: 'pasMal' },
  { max: 3, couleur: '#E6C77A', cle: 'genant' },
  { max: 6, couleur: '#E08A3C', cle: 'limitant' },
  { max: 8, couleur: '#D65A4A', cle: 'fort' },
  { max: 10, couleur: '#D65A4A', cle: 'insupportable' },
] as const;

/** ⚠️ L'OR DE LA SÉLECTION N'EST PAS CELUI DU PALIER 1–3, et c'est la seule
 *  raison pour laquelle ce palier est pâle. Les rapprocher rendrait indécidable,
 *  sur la figure, ce qu'on vient de toucher et ce qui fait un peu mal. */
export const OR_SELECTION = '#D4A843';

/** Le gris d'un muscle qu'aucune douleur ne concerne. */
export const GRIS_LIBRE = '#B4B3B8';

export function couleurDIntensite(valeur: number): string {
  return (PALIERS.find(p => valeur <= p.max) ?? PALIERS[PALIERS.length - 1]).couleur;
}

/** La clé i18n du mot qui accompagne le chiffre — « 3/10 · gênant ».
 *
 *  ⚠️ UNE CLÉ, PAS LE MOT. L'app est bilingue, et une des huit saisies reprises
 *  de production était déjà en anglais. */
export function cleDIntensite(valeur: number): string {
  const palier = PALIERS.find(p => valeur <= p.max) ?? PALIERS[PALIERS.length - 1];
  return `douleurs.intensite.${palier.cle}`;
}

/** Les onze valeurs saisissables, de « plus mal » à « insupportable ». */
export const VALEURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
