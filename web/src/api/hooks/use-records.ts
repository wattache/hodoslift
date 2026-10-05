import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockRecords, mockResolve } from '@/api/mock';
import type { RecordDeForce } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** LES RECORDS D'UN ATHLÈTE — calculés par brokkr depuis le 26/08 (FRE-71 §9).
 *
 *  ⚠️ CE CALCUL VIVAIT DANS LE NAVIGATEUR : `computeRepPRMatrix` parcourait
 *  l'arbre d'entraînement ENTIER — jusqu'à 838 lignes pour un athlète chargé —
 *  pour remplir une grille de 5 × 10 cases. Un `GROUP BY` déguisé en composant
 *  React, et surtout une SECONDE définition de « réalisé », qui a dérivé.
 *
 *  ⚠️ ET C'EST TOUJOURS INSTANTANÉ. Le serveur lit les tables VIVANTES, pas la
 *  projection analytique : un PR apparaît à la seconde où l'athlète note son
 *  RPE. Mesuré avant de choisir — 33 ms sur le plus gros programme, contre
 *  jusqu'à 24 h de retard si on avait visé `training_sets`. Et 131 lignes de
 *  production portent aujourd'hui un RPE que la projection n'a pas encore vu.
 */
export function useRecords(athleteId: string | null | undefined) {
  return useQuery<RecordDeForce[]>({
    queryKey: ['records', athleteId],
    queryFn: () => (isMock
      ? mockResolve(mockRecords)
      : api.get<RecordDeForce[]>(`/athletes/${athleteId}/records`)),
    enabled: Boolean(athleteId),
    // Un record ne bouge qu'après une séance : inutile de le redemander à chaque
    // montage du tableau de bord.
    staleTime: 60_000,
  });
}
