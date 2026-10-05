import type { Exercise, ExerciseKind } from '@/api/types';

/** La NATURE d'une ligne, en un seul endroit (FRE-10).
 *
 *  Trois règles tiennent dans ce fichier plutôt que d'être répétées partout :
 *  ce qui compte comme entraînement, ce qu'on écrit dans le contrat, et
 *  comment l'afficher. Les dupliquer, c'est prendre le risque qu'elles
 *  divergent — le tonnage de l'app finirait par contredire le Tracking, ce que
 *  FRE-20 a précisément coûté à réparer. */

/** Une ligne SANS `kind` est de l'entraînement : les 9 145 lignes d'avant le
 *  champ n'en portent pas, et elles ne seront jamais rétro-écrites. C'est le
 *  pendant exact du `IS DISTINCT FROM` côté SQL. */
export function isTraining(ex: Pick<Exercise, 'kind'>): boolean {
  return !ex.kind || ex.kind === 'training';
}

/** Ce qu'on ENVOIE à brokkr. `training` s'écrit comme une ABSENCE : le contrat
 *  accepte les deux, mais ne rien écrire évite de gonfler 9 000 documents avec
 *  une valeur qui se déduit.
 *
 *  ⚠️ Renvoie `undefined`, JAMAIS `''` : `kind: ''` est hors du Literal côté
 *  serveur, et un champ rejeté fait tomber la semaine ENTIÈRE (le 422 du
 *  2026-08-11 sur `repsUnit`).
 *
 *  ⚠️ ACCEPTE `null` AUTANT QU'`undefined`, parce que les deux arrivent vraiment :
 *  le serveur envoie `null` pour une ligne d'entraînement, tandis qu'un objet en
 *  cours de construction n'a pas encore la clé. Le contrat écrit à la main
 *  n'admettait que le second et masquait le premier — il rendait donc au front
 *  une valeur que le front se déclarait incapable de recevoir. */
export function kindToWrite(kind: ExerciseKind | null | undefined): ExerciseKind | undefined {
  return !kind || kind === 'training' ? undefined : kind;
}

/** ⚠️ DES FONCTIONS ET NON DES TABLES, depuis la traduction (FRE-113). Une
 *  `Record<ExerciseKind, string>` se fige à l'import : elle aurait gardé la
 *  langue du chargement de la page, et un changement de langue en cours de
 *  session aurait laissé « Échauffement » sous une interface anglaise. La
 *  fonction, elle, se rejoue à chaque rendu.
 *
 *  La `cle` reste le contrat — `warmup`, `rehab` partent tels quels à brokkr,
 *  quelle que soit la langue affichée. */
export function libelleKind(kind: ExerciseKind, t: (k: string) => string): string {
  return t(`session.kind.${kind}`);
}

/** Pastille affichée sur une ligne qui n'est PAS de l'entraînement. Rien pour
 *  l'entraînement : c'est le cas courant, le signaler serait du bruit sur
 *  toutes les lignes. */
export function badgeKind(kind: Exclude<ExerciseKind, 'training'>, t: (k: string) => string): string {
  return t(`session.kindBadge.${kind}`);
}

/** L'ordre du CYCLE, quand la nature se règle par un bouton qui tourne plutôt
 *  que par une liste déroulante. Entraînement d'abord : c'est l'état de départ
 *  et celui vers lequel on revient. */
export const KIND_CYCLE: ExerciseKind[] = ['training', 'warmup', 'rehab'];

export function kindSuivant(kind: ExerciseKind | null | undefined): ExerciseKind {
  const i = KIND_CYCLE.indexOf(kind && kind !== 'training' ? kind : 'training');
  return KIND_CYCLE[(i + 1) % KIND_CYCLE.length];
}


/** Le TIER d'un principe, borné au vocabulaire (FRE-29).
 *
 *  ⚠️ RESTÉ CÔTÉ FRONT quand la génération est partie chez brokkr (26/08), et ce
 *  n'est pas un oubli : ce n'est pas du calcul, c'est une FRONTIÈRE — la valeur
 *  vient d'un `<select>`, donc d'une chaîne, et il faut bien qu'un endroit la
 *  transforme en `1 | 2 | 3` avant de l'envoyer. Le serveur la refuserait
 *  autrement (`CHECK tier BETWEEN 1 AND 3`), mais après coup et pour toute la
 *  BASE. */
export function parseTier(v: unknown): 1 | 2 | 3 {
  return v === 2 || v === 3 ? v : 1;
}
