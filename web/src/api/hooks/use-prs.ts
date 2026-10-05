import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockPrs, mockResolve } from '@/api/mock';
import type { ManualPr, PrInput } from '@/api/types';
import { isFirebaseConfigured } from '@/firebase';

const isMock = !isFirebaseConfigured;

export function useManualPrs(athleteId: string | null | undefined) {
  return useQuery<ManualPr[]>({
    queryKey: ['prs', athleteId],
    queryFn: () => (isMock ? mockResolve(mockPrs) : api.get<ManualPr[]>(`/athletes/${athleteId}/prs`)),
    enabled: Boolean(athleteId),
    staleTime: 60_000,
  });
}

/** POST — ajoute OU met à jour un PR (identité = tuple complet). Coach only. */
export function useUpsertPr(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pr: PrInput) =>
      isMock ? mockResolve({ ...pr, id: 'mock-pr' } as ManualPr) : api.post<ManualPr, PrInput>(`/athletes/${athleteId}/prs`, pr),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['prs', athleteId] }),
  });
}

export function useDeletePr(athleteId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) =>
      isMock ? mockResolve({ ok: true }) : api.delete(`/athletes/${athleteId}/prs/${prId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['prs', athleteId] }),
  });
}
