import type { IdsSemaine, WeekEditing } from '@/api/types';

export type { IdsSemaine };

/** Recolle les ids du serveur sur la semaine que le client vient d'envoyer.
 *
 *  Sans ça, la semaine s'affiche avec ses séances et ses lignes DÉPOURVUES
 *  d'identité jusqu'au prochain refetch — et `schedulePatch` ne sait rien
 *  persister d'un objet sans id : chaque frappe dans cet intervalle est perdue,
 *  en silence.
 *
 *  ⚠️ L'alignement vient du serveur, qui rend une liste de MÊME LONGUEUR que
 *  celle reçue, avec `null` là où il a écarté une ligne sans nom. On ne
 *  recalcule donc aucun décalage ici — on zippe, et c'est tout.
 *
 *  ⚠️ LES LIGNES ÉCARTÉES RESSORTENT D'ICI SANS ID, d'où `WeekEditing` et non
 *  `Week` : c'est `materialiserLignesVides` qui les crée une à une juste après.
 *  Le reste arrive DÉJÀ complet : ce qui entre ici sort de `createEmptyWeek` ou
 *  de `buildNextWeek`, qui rendent une semaine entière — seule l'identité manque.
 *  Il n'y a donc aucune méta à compléter au passage. */
export function adopterLesIds(semaine: WeekEditing, ids: IdsSemaine): WeekEditing {
  const rendues = ids.sessions ?? [];
  return {
    ...semaine,
    id: ids.week,
    sessions: (semaine.sessions ?? []).map((s, i) => ({
      ...s,
      id: rendues[i]?.id ?? s.id,
      exercises: s.exercises.map((ex, j) => {
        const id = rendues[i]?.exercises[j];
        return id ? { ...ex, id } : ex;
      }),
    })),
  };
}
