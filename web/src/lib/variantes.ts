/** Variantes d'une ligne d'exercice (FRE-33).
 *
 *  Une ligne peut porter PLUSIEURS variantes cumulées — « DS » + « PAUSE ».
 *  Avant, il fallait créer une entrée `DS PAUSE` de plus au référentiel : une
 *  entrée par croisement de qualificatifs, et 26 des 72 valeurs y étaient déjà
 *  passées. Deux d'entre elles ne différaient que d'une lettre (`NO DIP` /
 *  `NO DIPS`) sans que personne ne le voie.
 *
 *  DEUX FORMES COEXISTENT DANS LA DONNÉE : la chaîne (les ~9 200 lignes
 *  historiques, les BASE d'anciens blocs) et la liste (ce qu'Eitri écrit). Tout
 *  passe par `lireVariantes` — c'est la leçon de `lib/groupe.ts` : une règle
 *  recopiée dans trois rendus est une règle oubliée dans l'un des trois. */

/** Séparateur d'affichage. Le « · » sert déjà à séparer le nom de l'exercice de
 *  sa variante (« PULL UP · DS ») ; le réutiliser rendrait « PULL UP · DS ·
 *  PAUSE » ambigu. Le « + » dit explicitement le cumul. */
const LIANT = ' + ';

/** Nombre maximum de variantes sur une ligne. Trois qualificatifs décrivent déjà
 *  une exécution très précise, et la ligne d'un tableau doit rester lisible.
 *  Le contrat brokkr, lui, tolère jusqu'à 10 : un garde-fou anti-dégénérescence
 *  ne doit jamais rejeter une semaine entière pour une règle d'ergonomie. */
export const MAX_VARIANTES = 3;

/** Forme stockée (chaîne héritée, liste, absence) → liste propre.
 *  Volontairement `unknown` : cette fonction est le seul endroit du front qui a
 *  le droit de ne pas savoir ce qu'il lit. */
export function lireVariantes(valeur: unknown): string[] {
  const brut = typeof valeur === 'string' ? [valeur] : valeur;
  if (!Array.isArray(brut)) return [];
  return brut.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map(v => v.trim());
}

/** Libellé lisible, vide si aucune variante. L'ORDRE est celui de la saisie du
 *  coach : « PAUSE FRONT » et « FRONT PAUSE » désignent la même exécution, mais
 *  on relit ce qu'on a écrit. */
export function afficherVariantes(valeur: unknown): string {
  return lireVariantes(valeur).join(LIANT);
}

/** Clé d'IDENTITÉ — celle qui dit « c'est le même exercice ».
 *
 *  Triée et en majuscules, à l'inverse de l'affichage : deux lignes qui portent
 *  les mêmes qualificatifs dans un ordre différent sont le même exercice, et
 *  doivent partager leur historique, leur progression et leurs records. Sans le
 *  tri, un coach qui ressaisit « PAUSE, DS » au lieu de « DS, PAUSE » couperait
 *  la courbe en deux sans le savoir. */
export function cleVariantes(valeur: unknown): string {
  return lireVariantes(valeur).map(v => v.toUpperCase()).sort().join(LIANT);
}

/** Ajoute ou retire une variante — le geste du sélecteur multiple.
 *  Ajout EN FIN de liste : l'ordre reste celui de la saisie. */
export function basculerVariante(valeur: unknown, variante: string): string[] {
  const actuelles = lireVariantes(valeur);
  const i = actuelles.findIndex(v => v.toUpperCase() === variante.trim().toUpperCase());
  if (i >= 0) return actuelles.filter((_, j) => j !== i);
  if (actuelles.length >= MAX_VARIANTES) return actuelles;
  return [...actuelles, variante.trim()];
}
