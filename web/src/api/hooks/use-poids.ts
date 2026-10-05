import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { mockDailyLogs, mockPoidsSemaines, mockResolve } from '@/api/mock';
import type { DailyLogs, PoidsDepartEcrit, PoidsSemaines } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** LE SUIVI DE POIDS PAR SEMAINE (29/09) — calculé par brokkr, lu tel quel.
 *  Il dépend des pesées : `clesDuQuotidien` l'invalide avec elles. */
export function usePoidsSemaines(athleteId: string | null | undefined) {
  return useQuery<PoidsSemaines>({
    queryKey: ['poids-semaines', athleteId],
    queryFn: () => (isMock ? mockResolve(mockPoidsSemaines) : api.get<PoidsSemaines>(`/athletes/${athleteId}/poids/semaines`)),
    enabled: Boolean(athleteId),
    staleTime: 60_000,
  });
}

/** La pesée d'UN jour — pour reprendre le poids saisi à la date choisie comme
 *  départ (William, 29/09 : « ça ne reprend pas le poids rentré à cette date »).
 *  Une lecture par date, pas la fenêtre du Tracker : un départ peut être plus
 *  vieux que ses 60 jours. */
export function usePeseeDuJour(athleteId: string | null | undefined, date: string) {
  return useQuery<number | null>({
    queryKey: ['pesee-du-jour', athleteId, date],
    queryFn: async () => {
      const logs = isMock ? mockDailyLogs : await api.get<DailyLogs>(`/athletes/${athleteId}/daily-logs?from=${date}&to=${date}`);
      return logs[date]?.weight ?? null;
    },
    enabled: Boolean(athleteId) && /^\d{4}-\d{2}-\d{2}$/.test(date),
    staleTime: 60_000,
  });
}

/** Le point zéro : `PUT` le pose, `DELETE` l'efface (autz owner_or_staff). */
export function usePoserPoidsDepart(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (depart: PoidsDepartEcrit | null) =>
      isMock ? mockResolve({ ok: true })
             : depart ? api.put<unknown, PoidsDepartEcrit>(`/athletes/${athleteId}/poids/depart`, depart)
                      : api.delete<unknown>(`/athletes/${athleteId}/poids/depart`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['poids-semaines', athleteId] }); },
  });
}
