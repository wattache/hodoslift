import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockPalmares, mockResolve } from '@/api/mock';
import type { Palmares } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

/** LE PALMARÈS D'UN ATHLÈTE — meilleurs singles, compétitions, et le 1RM de la
 *  table, calculés par brokkr (`app/suivi/metier_palmares.py`). Le front ne
 *  porte pas de seconde définition de « son meilleur single ». */
export function usePalmares(athleteId: string | null | undefined) {
  return useQuery<Palmares>({
    queryKey: ['palmares', athleteId],
    queryFn: () => (isFirebaseConfigured
      ? api.get<Palmares>(`/athletes/${athleteId}/palmares`)
      : mockResolve(mockPalmares)),
    enabled: Boolean(athleteId),
    staleTime: 60_000,
  });
}
