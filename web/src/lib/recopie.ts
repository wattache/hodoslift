import type { Exercise } from '@/api/types';
import { isTraining } from '@/lib/exercise-kind';
import { leReposSeSaisit, lesSeriesSeSaisissent, natureDe as natureDuGroupeDe } from '@/lib/groupe';

/** RECOPIER UNE COLONNE VERS LE BAS (Passe 3, constat 05).
 *
 *  Le geste du tableur : la poignée d'une case de prescription, tirée vers le
 *  bas, écrit sa valeur dans les lignes qu'elle traverse. Ce module dit
 *  LESQUELLES — la grille ne fait que dessiner et écrire.
 *
 *  ⚠️ LA COLONNE DU RÉALISÉ N'EN EST PAS. On ne recopie pas ce qu'un athlète a
 *  ressenti : le type ci-dessous ne le permet même pas. */
export type ChampRecopiable = 'sets' | 'reps' | 'weight' | 'rest' | 'aimedRPE';

type Ligne = Pick<Exercise, 'kind' | 'groupId' | 'groupKind'>;

/** La ligne est-elle la 2e, 3e… d'un groupe ? Ses séries et son repos sont alors
 *  ceux du groupe, saisis sur la première ligne (FRE-31). */
export function estSuiteDuGroupe(lignes: readonly Ligne[], i: number): boolean {
  const ex = lignes[i];
  if (!ex?.groupId) return false;
  const membres = lignes.filter(o => o.groupId === ex.groupId).length;
  return membres > 1 && lignes[i - 1]?.groupId === ex.groupId;
}

/** La case `champ` de la ligne `i` se saisit-elle ? C'est la même règle que la
 *  grille applique pour dessiner un champ ou un « ↑ ». */
export function caseSaisissable(lignes: readonly Ligne[], champ: ChampRecopiable, i: number): boolean {
  const ex = lignes[i];
  if (!ex) return false;
  // Un AMRAP de groupe n'a pas de séries prescrites : ses tours sont le résultat.
  if (champ === 'sets') return !estSuiteDuGroupe(lignes, i) && (!ex.groupId || lesSeriesSeSaisissent(natureDuGroupeDe(ex)));
  if (champ === 'rest') {
    const nature = natureDuGroupeDe(ex);
    return (!ex.groupId || leReposSeSaisit(nature)) && !estSuiteDuGroupe(lignes, i);
  }
  return true;
}

const natureDe = (ex: Ligne) => (isTraining(ex) ? 'training' : ex.kind);

/** Les lignes que la recopie de `depuis` jusqu'à `jusqua` écrira.
 *
 *  ⚠️ ELLE NE FRANCHIT PAS UNE LIGNE D'UNE AUTRE NATURE. Tirer la charge d'un
 *  échauffement jusqu'au travail, c'est écrire 40 kg sur la série lourde : la
 *  recopie s'arrête AVANT la première ligne qui change de nature, même si le
 *  pointeur va plus loin.
 *
 *  ⚠️ ELLE SAUTE UNE CASE « ↑ », SANS S'ARRÊTER. Les séries d'un bi-set vivent
 *  sur sa première ligne : l'écrire là l'étend déjà au groupe. */
export function ciblesDeRecopie(
  lignes: readonly Ligne[], champ: ChampRecopiable, depuis: number, jusqua: number,
): number[] {
  const source = lignes[depuis];
  if (!source) return [];
  const cibles: number[] = [];
  for (let j = depuis + 1; j <= jusqua && j < lignes.length; j++) {
    if (natureDe(lignes[j]) !== natureDe(source)) break;
    if (caseSaisissable(lignes, champ, j)) cibles.push(j);
  }
  return cibles;
}
