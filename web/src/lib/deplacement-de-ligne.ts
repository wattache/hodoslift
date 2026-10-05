import type { ExerciseEditing } from '@/api/types';
import { blocDe } from '@/lib/groupe';

/** DÉPLACER UNE LIGNE D'UNE SÉANCE À L'AUTRE, dans la même semaine (FRE-188).
 *
 *  Le BLOC part, pas la ligne (FRE-31, décision William) : un bi-set ou un
 *  dropset reste consécutif, avec son identifiant et sa nature. Et on ne se pose
 *  jamais À L'INTÉRIEUR d'un groupe de la séance cible : on se range après lui.
 *
 *  C'est le miroir local de `PUT /exercises/{id}/seance`, qui fait la même chose
 *  en base ; ici pour que l'écran réponde tout de suite, là pour que ce soit
 *  vrai. Rend la position effectivement occupée, celle que le serveur reçoit. */
export function deplacerEntreSeances(
  source: ExerciseEditing[], index: number, cible: ExerciseEditing[], position: number,
): number {
  const bloc = blocDe(source, index);
  const extraits = source.splice(bloc.debut, bloc.fin - bloc.debut + 1);
  let rang = Math.max(0, Math.min(position, cible.length));
  if (rang < cible.length) {
    const voisin = blocDe(cible, rang);
    // Un rang au milieu d'un groupe le couperait : on se range après lui.
    if (voisin.debut !== rang) rang = voisin.fin + 1;
  }
  cible.splice(rang, 0, ...extraits);
  return rang;
}

/** Ce qu'un glissement de ligne transporte d'une séance à l'autre : les
 *  `dragIdx` sont locaux à chaque tableau, seul `dataTransfer` traverse. */
export const TYPE_LIGNE_GLISSEE = 'application/x-hodos-ligne';

export type LigneGlissee = { sessionId: string; index: number };

export function poserLaLigneGlissee(dt: DataTransfer, ligne: LigneGlissee): void {
  dt.setData(TYPE_LIGNE_GLISSEE, JSON.stringify(ligne));
  dt.effectAllowed = 'move';
}

export function porteUneLigne(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(TYPE_LIGNE_GLISSEE);
}

/** La ligne glissée, ou `null` : un glissement d'autre chose (une séance, un
 *  fichier) ne doit jamais passer pour une ligne. */
export function ligneGlissee(dt: DataTransfer): LigneGlissee | null {
  const brut = dt.getData(TYPE_LIGNE_GLISSEE);
  if (!brut) return null;
  try {
    const v = JSON.parse(brut) as Partial<LigneGlissee>;
    return typeof v.sessionId === 'string' && typeof v.index === 'number' ? { sessionId: v.sessionId, index: v.index } : null;
  } catch {
    return null;
  }
}
