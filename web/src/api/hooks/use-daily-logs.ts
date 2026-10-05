import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { clesDuQuotidien, invalider } from '@/api/cles';
import { mockDailyLogs, mockResolve } from '@/api/mock';
import type { DailyLogPatch, DailyLogs } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

/** Logs quotidiens d'un athlète sur une plage (défaut serveur : 30 jours).
 *  `days` élargit la fenêtre (tracker : tendances longues). */
export function useDailyLogs(athleteId: string | null | undefined, days = 30) {
  return useQuery<DailyLogs>({
    queryKey: ['daily-logs', athleteId, days],
    queryFn: () => {
      if (isMock) return mockResolve(mockDailyLogs);
      const to = new Date().toISOString().slice(0, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - (days - 1));
      const from = fromDate.toISOString().slice(0, 10);
      return api.get<DailyLogs>(`/athletes/${athleteId}/daily-logs?from=${from}&to=${to}`);
    },
    enabled: Boolean(athleteId),
    staleTime: 60_000,
  });
}

/** PATCH /daily-logs/{date} — merge des seuls champs fournis (autz owner).
 *
 *  ⚠️ LE CORPS EST `DailyLogPatch`, PAS `DailyLogEntry` (FRE-144). Le second est
 *  le modèle de LECTURE ; il se trouve avoir aujourd'hui la même forme, ce qui
 *  rendait la confusion invisible — et l'aurait laissée invisible jusqu'au jour
 *  où la lecture aurait gagné un champ que l'écriture refuse. */
export function usePatchDailyLog(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, patch }: { date: string; patch: DailyLogPatch }) =>
      isMock ? mockResolve({ ok: true }) : api.patch<unknown, DailyLogPatch>(`/athletes/${athleteId}/daily-logs/${date}`, patch),
    onSuccess: () => invalider(qc, clesDuQuotidien(athleteId)),
  });
}
